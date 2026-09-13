import { afterEach, describe, expect, it, vi } from "vitest";
import { DevGeocoder, GoogleGeocoder } from "@/lib/geo/geocoder";
import { isApiError } from "@/lib/api/errors";

const ADDR = {
  line1: "123 Main St",
  city: "Salt Lake City",
  region: "UT",
  postal_code: "84101",
  country: "US",
};

function mockFetch(status: string, results: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status, results }), { status: 200 })),
  );
}

describe("GoogleGeocoder failure handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns coordinates for a clean single ROOFTOP match", async () => {
    mockFetch("OK", [
      {
        formatted_address: "123 Main St, Salt Lake City, UT 84101",
        geometry: { location: { lat: 40.76, lng: -111.89 }, location_type: "ROOFTOP" },
      },
    ]);
    const g = new GoogleGeocoder("key");
    const r = await g.geocode(ADDR);
    expect(r).toMatchObject({ lat: 40.76, lng: -111.89, location_type: "ROOFTOP" });
  });

  it("rejects ZERO_RESULTS with VALIDATION_ERROR, never a coordinate", async () => {
    mockFetch("ZERO_RESULTS", []);
    const g = new GoogleGeocoder("key");
    await expect(g.geocode(ADDR)).rejects.toSatisfy(
      (e: unknown) => isApiError(e) && e.code === "VALIDATION_ERROR",
    );
  });

  it("rejects an ambiguous multi-result match", async () => {
    mockFetch("OK", [
      { formatted_address: "A", geometry: { location: { lat: 1, lng: 1 }, location_type: "ROOFTOP" } },
      { formatted_address: "B", geometry: { location: { lat: 2, lng: 2 }, location_type: "ROOFTOP" } },
    ]);
    const g = new GoogleGeocoder("key");
    await expect(g.geocode(ADDR)).rejects.toSatisfy(
      (e: unknown) => isApiError(e) && e.code === "VALIDATION_ERROR",
    );
  });

  it("rejects a partial match (the wrong-street-number failure)", async () => {
    mockFetch("OK", [
      {
        partial_match: true,
        formatted_address: "Main St, Salt Lake City, UT",
        geometry: { location: { lat: 40.7, lng: -111.9 }, location_type: "GEOMETRIC_CENTER" },
      },
    ]);
    const g = new GoogleGeocoder("key");
    let caught: unknown;
    try {
      await g.geocode(ADDR);
    } catch (e) {
      caught = e;
    }
    expect(isApiError(caught) && caught.code).toBe("VALIDATION_ERROR");
    expect(isApiError(caught) && (caught.details.address as { status: string }).status).toBe("PARTIAL_MATCH");
  });

  it("raises (not rejects) on a real service error like REQUEST_DENIED", async () => {
    mockFetch("REQUEST_DENIED", []);
    const g = new GoogleGeocoder("key");
    await expect(g.geocode(ADDR)).rejects.toThrow(/REQUEST_DENIED/);
  });
});

describe("DevGeocoder", () => {
  it("maps known launch cities to their real centers", async () => {
    const g = new DevGeocoder();
    const slc = await g.geocode(ADDR);
    expect(slc.lat).toBeCloseTo(40.76, 1);
    expect(slc.lng).toBeCloseTo(-111.89, 1);
    const provo = await g.geocode({ ...ADDR, city: "Provo", postal_code: "84601" });
    expect(provo.lat).toBeCloseTo(40.23, 1);
    expect(provo.lng).toBeCloseTo(-111.66, 1);
  });

  it("is deterministic for the same address", async () => {
    const g = new DevGeocoder();
    const a = await g.geocode(ADDR);
    const b = await g.geocode(ADDR);
    expect(a).toEqual(b);
  });
});
