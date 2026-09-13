import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { listAddresses } from "@/lib/addresses";
import { distanceMiles } from "@/lib/geo/distance";

/**
 * API-CONTRACT §3 / PRD §8.3: advisory drift suggestion.
 *
 * Given the current GPS position, if the active address is far away and a
 * different saved address is materially closer, suggest the switch. ADVISORY
 * ONLY: this route reads and compares, and NEVER mutates the active address.
 * The switch is always the user's explicit action via PUT active-address.
 *
 * The current position is passed by the client for this read; that is not a
 * spoofed market (the suggestion changes nothing), and it is unrelated to the
 * redemption geofence, which uses its own live fix.
 */

const DRIFT_THRESHOLD_MILES = 50; // active address this far from "here"
const IMPROVEMENT_MILES = 25; // and another saved address at least this much closer

const route = defineRoute(
  {
    method: "get",
    path: "/v1/users/me/location-drift",
    operationId: "getLocationDrift",
    summary: "Advisory active-address drift suggestion",
    description: "Never switches the active address; suggestion only.",
    tags: ["Users"],
    auth: "user",
    request: {
      query: z.object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
      }),
    },
    response: {
      data: z.object({
        drift_detected: z.boolean(),
        current_active_address_id: z.string().nullable(),
        suggested_address_id: z.string().nullable(),
        suggested_label: z.string().nullable(),
        active_distance_miles: z.number().nullable(),
        suggested_distance_miles: z.number().nullable(),
        message: z.string().nullable(),
      }),
    },
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");

    const none = {
      drift_detected: false,
      current_active_address_id: user.active_address_id,
      suggested_address_id: null,
      suggested_label: null,
      active_distance_miles: null,
      suggested_distance_miles: null,
      message: null,
    };

    if (query.lat === undefined || query.lng === undefined) {
      return { data: none };
    }
    const here = { lat: query.lat, lng: query.lng };

    const addresses = await listAddresses(user.id);
    const located = addresses.filter(
      (a): a is typeof a & { lat: number; lng: number } => a.lat !== null && a.lng !== null,
    );
    const active = located.find((a) => a.id === user.active_address_id) ?? null;
    if (!active) return { data: none };

    const activeDist = distanceMiles(here, { lat: active.lat, lng: active.lng });

    let closest: (typeof located)[number] | null = null;
    let closestDist = Infinity;
    for (const a of located) {
      if (a.id === active.id) continue;
      const d = distanceMiles(here, { lat: a.lat, lng: a.lng });
      if (d < closestDist) {
        closestDist = d;
        closest = a;
      }
    }

    const drift =
      activeDist >= DRIFT_THRESHOLD_MILES &&
      closest !== null &&
      activeDist - closestDist >= IMPROVEMENT_MILES;

    if (!drift || !closest) {
      return {
        data: { ...none, active_distance_miles: Math.round(activeDist) },
      };
    }

    return {
      data: {
        drift_detected: true,
        current_active_address_id: user.active_address_id,
        suggested_address_id: closest.id,
        suggested_label: closest.label,
        active_distance_miles: Math.round(activeDist),
        suggested_distance_miles: Math.round(closestDist),
        message: `You seem to be near ${closest.label}. Switch your active address?`,
      },
    };
  },
);

export const GET = route.handler;
