import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubValidEnv } from "./helpers/env";

const set = vi.fn();
const decr = vi.fn();
const get = vi.fn();
const ping = vi.fn();
const expire = vi.fn();
const incr = vi.fn();
const eval_ = vi.fn();
const constructed: unknown[] = [];

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(opts: unknown) {
      constructed.push(opts);
    }
    set = set;
    decr = decr;
    get = get;
    ping = ping;
    expire = expire;
    incr = incr;
    eval = eval_;
  },
}));

import {
  claimIdempotencyKey,
  decrementInventory,
  getIdempotencyResult,
  pingRedis,
  resetRedisClient,
  seedInventory,
  storeIdempotencyResult,
} from "@/lib/redis";

describe("lib/redis (Upstash, the two hard requirements)", () => {
  beforeEach(() => {
    stubValidEnv();
    resetRedisClient();
    constructed.length = 0;
  });

  it("constructs the REST client from the validated env, once", async () => {
    ping.mockResolvedValue("PONG");
    await pingRedis();
    await pingRedis();
    expect(constructed).toEqual([
      { url: "https://placeholder.upstash.io", token: "token-placeholder" },
    ]);
  });

  it("decrementInventory is a single DECR: no read, no script, no re-increment", async () => {
    decr.mockResolvedValue(41);
    const remaining = await decrementInventory("drop-1");
    expect(remaining).toBe(41);
    expect(decr).toHaveBeenCalledTimes(1);
    expect(decr).toHaveBeenCalledWith("drop:drop-1:inventory");
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(incr).not.toHaveBeenCalled();
    expect(eval_).not.toHaveBeenCalled();
  });

  it("passes a negative DECR result through untouched (Gone is the caller's decision)", async () => {
    decr.mockResolvedValue(-1);
    expect(await decrementInventory("drop-1")).toBe(-1);
    expect(incr).not.toHaveBeenCalled();
  });

  it("claimIdempotencyKey is one SET with NX and EX 86400, never SETNX then EXPIRE", async () => {
    set.mockResolvedValue("OK");
    expect(await claimIdempotencyKey("k1")).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("idem:k1", "__pending__", { nx: true, ex: 86400 });
    expect(expire).not.toHaveBeenCalled();
  });

  it("claimIdempotencyKey returns false on a replay", async () => {
    set.mockResolvedValue(null);
    expect(await claimIdempotencyKey("k1")).toBe(false);
  });

  it("storeIdempotencyResult keeps the original TTL and only overwrites a claimed key", async () => {
    set.mockResolvedValue("OK");
    await storeIdempotencyResult("k1", { position: 7 });
    expect(set).toHaveBeenCalledWith("idem:k1", { position: 7 }, { xx: true, keepTtl: true });
    expect(expire).not.toHaveBeenCalled();
  });

  it("getIdempotencyResult distinguishes unknown, pending, and stored", async () => {
    get.mockResolvedValueOnce(null);
    expect(await getIdempotencyResult("k1")).toBeNull();
    get.mockResolvedValueOnce("__pending__");
    expect(await getIdempotencyResult("k1")).toBe("pending");
    get.mockResolvedValueOnce({ position: 7 });
    expect(await getIdempotencyResult("k1")).toEqual({ position: 7 });
  });

  it("seedInventory uses SET NX and reports whether it seeded", async () => {
    set.mockResolvedValueOnce("OK");
    expect(await seedInventory("drop-1", 100)).toBe(true);
    expect(set).toHaveBeenCalledWith("drop:drop-1:inventory", 100, { nx: true });
    set.mockResolvedValueOnce(null);
    expect(await seedInventory("drop-1", 100)).toBe(false);
  });

  it("pingRedis throws when the reply is not PONG", async () => {
    ping.mockResolvedValue(undefined);
    await expect(pingRedis()).rejects.toThrow("Redis PING returned undefined");
  });
});
