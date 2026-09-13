import { ApiError } from "@/lib/api/errors";
import { getEnv } from "@/lib/env";

/**
 * The only module that talks to a geocoding provider (same pattern as
 * lib/redis.ts). No route handler calls Google directly; if the provider ever
 * changes, this file changes and nothing else does.
 *
 * Geocoding is server-authoritative: the client never supplies lat/lng, so a
 * spoofed coordinate cannot place a buyer in a market they are not in
 * (invariant #10). It runs only on address create or on an edit that changes a
 * line of the address; an unchanged address is never re-fetched.
 *
 * Failure handling is explicit. Zero results, an ambiguous match, or a partial
 * match (the classic "nonexistent street number silently snapped to the block")
 * are rejected with VALIDATION_ERROR carrying what the provider returned —
 * never stored as a wrong coordinate.
 */

export interface AddressParts {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
  country?: string | null;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  location_type: string; // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE | DEV
}

export interface Geocoder {
  readonly kind: "dev" | "google";
  geocode(address: AddressParts): Promise<GeocodeResult>;
}

function oneLine(a: AddressParts): string {
  return [a.line1, a.line2, a.city, a.region, a.postal_code, a.country ?? "US"]
    .filter(Boolean)
    .join(", ");
}

function rejectGeocode(message: string, details: Record<string, unknown>): never {
  throw new ApiError("VALIDATION_ERROR", message, { address: details });
}

/**
 * Deterministic dev geocoder: no network, no key. Known launch cities resolve
 * to their real centers so market logic behaves; everything else gets a stable
 * pseudo-coordinate derived from the postal code. Never partial, never fails.
 */
export class DevGeocoder implements Geocoder {
  readonly kind = "dev" as const;

  private static readonly CITIES: Record<string, [number, number]> = {
    "salt lake city": [40.7608, -111.891],
    provo: [40.2338, -111.6585],
    ogden: [41.223, -111.9738],
    "new york": [40.758, -73.9855],
    manhattan: [40.758, -73.9855],
  };

  async geocode(address: AddressParts): Promise<GeocodeResult> {
    const city = address.city.trim().toLowerCase();
    const known = DevGeocoder.CITIES[city];
    if (known) {
      // Small deterministic jitter from the postal code so distinct addresses
      // in a city are not identical points, but stay well within its radius.
      const seed = [...address.postal_code].reduce((a, c) => a + c.charCodeAt(0), 0);
      const dx = ((seed % 20) - 10) / 1000; // ±0.01°, ~1km
      return {
        lat: known[0] + dx,
        lng: known[1] - dx,
        formatted_address: oneLine(address),
        location_type: "DEV",
      };
    }
    const seed = [...oneLine(address)].reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      lat: 39 + (seed % 1000) / 1000,
      lng: -111 - (seed % 1000) / 1000,
      formatted_address: oneLine(address),
      location_type: "DEV",
    };
  }
}

/**
 * Google Geocoding API. Reached only when GOOGLE_GEOCODING_API_KEY is present.
 * Rejects zero-result, ambiguous, and partial matches rather than storing a
 * wrong coordinate.
 */
export class GoogleGeocoder implements Geocoder {
  readonly kind = "google" as const;
  constructor(private readonly apiKey: string) {}

  async geocode(address: AddressParts): Promise<GeocodeResult> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", oneLine(address));
    url.searchParams.set("components", `country:${address.country ?? "US"}`);
    url.searchParams.set("key", this.apiKey);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Google geocoding HTTP ${res.status}`);
    const json = (await res.json()) as {
      status: string;
      error_message?: string;
      results: {
        partial_match?: boolean;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number }; location_type: string };
      }[];
    };

    if (json.status === "ZERO_RESULTS") {
      rejectGeocode("Address could not be found.", { status: "ZERO_RESULTS" });
    }
    if (json.status !== "OK") {
      // Real service failure (OVER_QUERY_LIMIT, REQUEST_DENIED, etc.) — throw,
      // don't reject: it is our problem, not the user's address.
      throw new Error(`Google geocoding status ${json.status}: ${json.error_message ?? ""}`);
    }
    if (json.results.length === 0) {
      rejectGeocode("Address could not be found.", { status: "ZERO_RESULTS" });
    }
    if (json.results.length > 1) {
      rejectGeocode("Address is ambiguous; be more specific.", {
        status: "AMBIGUOUS",
        candidates: json.results.slice(0, 3).map((r) => r.formatted_address),
      });
    }
    const best = json.results[0];
    if (best.partial_match) {
      rejectGeocode("Address is only a partial match; check the street number.", {
        status: "PARTIAL_MATCH",
        matched: best.formatted_address,
      });
    }
    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      formatted_address: best.formatted_address,
      location_type: best.geometry.location_type,
    };
  }
}

let geocoder: Geocoder | undefined;

export function getGeocoder(): Geocoder {
  if (!geocoder) {
    const env = getEnv();
    if (env.GOOGLE_GEOCODING_API_KEY) {
      geocoder = new GoogleGeocoder(env.GOOGLE_GEOCODING_API_KEY);
    } else {
      // Boot validation already forbids this in production; this is a second,
      // local guard so the dev geocoder can never silently serve production.
      if (env.APP_ENV === "production") {
        throw new Error("Refusing the dev geocoder in production: set GOOGLE_GEOCODING_API_KEY.");
      }
      geocoder = new DevGeocoder();
    }
  }
  return geocoder;
}

/** Test hook only. */
export function resetGeocoder(): void {
  geocoder = undefined;
}
