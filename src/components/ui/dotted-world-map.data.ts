// All locations here are representative, not real customer data. Swap in real
// data by editing this file only — the component reads everything from here.

export interface LatLng {
  lat: number
  lng: number
}

export interface Box {
  lat: [min: number, max: number]
  lng: [min: number, max: number]
}

export type RegionId = "northAmerica" | "europe" | "asia"
export type RegionKey = RegionId | "rest"

/**
 * Rough lat/lng boxes per region. A land dot belongs to the first region
 * (in this order) with a box containing it; anything else is "rest".
 */
export const REGION_BOXES: Record<RegionId, Box[]> = {
  europe: [
    { lat: [36, 72], lng: [-25, 40] },
    { lat: [45, 72], lng: [40, 60] },
  ],
  northAmerica: [
    { lat: [15, 84], lng: [-170, -52] },
    { lat: [7, 15], lng: [-93, -77] }, // Central America
    { lat: [59, 84], lng: [-52, -20] }, // Greenland
  ],
  asia: [
    { lat: [12, 45], lng: [39, 180] },
    { lat: [28, 45], lng: [34, 39] }, // Levant
    { lat: [45, 78], lng: [60, 180] },
    { lat: [5, 12], lng: [72, 92] }, // South India
    { lat: [-11, 12], lng: [92, 141] }, // South-East Asia
  ],
}

/** Share of active dots per region; values should sum to 1 */
export type RegionWeights = Record<RegionKey, number>

/** Flag 001 — twinkling "desktops" */
export const DESKTOPS = {
  seed: 40_000,
  count: 280,
  weights: { northAmerica: 0.5, europe: 0.3, asia: 0.15, rest: 0.05 } satisfies RegionWeights,
  /** Each dot twinkles on a loop between these durations */
  durationMs: [2000, 4000] as [number, number],
}

export interface MapMarker extends LatLng {
  id: string
  /** Short generic label (regions, never client or city names) */
  label?: string
}

/** Flag 002 — hub and spokes from the HQ */
export const CUSTOMERS = {
  hq: { id: "hq", lat: 39.9, lng: -83, label: "HQ · USA" } satisfies MapMarker,
  destinations: [
    { id: "canada-east", lat: 45.5, lng: -75 },
    { id: "canada-west", lat: 51, lng: -114 },
    { id: "latam-north", lat: 19.4, lng: -99.1 },
    { id: "latam-andes", lat: 4.7, lng: -74.1 },
    { id: "latam-south", lat: -23.5, lng: -46.6, label: "LATAM" },
    { id: "europe-west", lat: 51.5, lng: -0.1, label: "Europe" },
    { id: "europe-central", lat: 50.1, lng: 8.7 },
    { id: "europe-north", lat: 59.3, lng: 18.1 },
    { id: "europe-south", lat: 40.4, lng: -3.7 },
    { id: "middle-east", lat: 25.2, lng: 55.3, label: "Middle East" },
    { id: "south-asia", lat: 19.1, lng: 72.9 },
    { id: "apac-south-east", lat: 1.35, lng: 103.8, label: "APAC" },
    { id: "apac-east", lat: 35.7, lng: 139.7 },
    { id: "oceania", lat: -33.9, lng: 151.2 },
  ] satisfies MapMarker[],
  staggerMs: 250,
  drawMs: 800,
  holdMs: 3000,
  fadeMs: 600,
}

/** Flag 003 — three connected delivery regions */
export const REGIONS = {
  hubs: [
    { id: "northAmerica", lat: 46, lng: -100, label: "North America" },
    { id: "europe", lat: 50, lng: 12, label: "Europe" },
    { id: "asia", lat: 40, lng: 95, label: "Asia" },
  ] satisfies (MapMarker & { id: RegionId })[],
  /** `lift` bends the arc up (positive) or down (negative), relative to its length */
  links: [
    { from: "northAmerica", to: "europe", lift: 0.25 },
    { from: "europe", to: "asia", lift: 0.25 },
    // Bows under Europe so the three arcs read as a triangle
    { from: "asia", to: "northAmerica", lift: -0.2 },
  ] satisfies { from: RegionId; to: RegionId; lift: number }[],
  /** One trip of the travelling dot along each arc */
  tripMs: 6000,
}

export interface TimelinePhase {
  region: RegionKey
  /** Dots light up spreading outward from here */
  origin: LatLng
  /** Nearest dot lights at the first year, farthest at the second */
  years: [number, number]
}

/** Flag 004 — growth over time */
export const TIMELINE = {
  seed: 2011,
  count: 520,
  from: 2011,
  to: 2026,
  durationMs: 5000,
  weights: { northAmerica: 0.4, europe: 0.25, asia: 0.25, rest: 0.1 } satisfies RegionWeights,
  phases: [
    { region: "northAmerica", origin: { lat: 39.9, lng: -83 }, years: [2011, 2016] },
    { region: "europe", origin: { lat: 51.5, lng: -0.1 }, years: [2015, 2019] },
    { region: "asia", origin: { lat: 25.2, lng: 55.3 }, years: [2018, 2023] },
    { region: "rest", origin: { lat: 39.9, lng: -83 }, years: [2021, 2025.5] },
  ] satisfies TimelinePhase[],
  finalLabel: "15 years",
}
