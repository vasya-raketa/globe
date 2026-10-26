import { geoArea } from "d3-geo"
import { GlyphGlobe } from "@/components/ui/glyph-globe"

type Ring = [number, number][] // [lng, lat]

// d3 picks the polygon interior from winding order; make each ring the
// smaller of its two sides.
const polygon = (ring: Ring): GeoJSON.Polygon => {
  const p: GeoJSON.Polygon = { type: "Polygon", coordinates: [[...ring, ring[0]]] }
  if (geoArea(p) > 2 * Math.PI) p.coordinates[0].reverse()
  return p
}

// Rough outlines (mostly through open sea) of the continents that are NOT
// highlighted. All other land — North America, Europe and Asia — is green.
const SOUTH_AMERICA: Ring = [
  [-77.8, 7.2], [-77.2, 8.7], [-76, 12], [-71.5, 13], [-62, 11.5], [-60, 11],
  [-30, 0], [-30, -60], [-90, -60], [-90, 0], [-79, 5],
]
const AFRICA: Ring = [
  [-5.6, 35.95], [-2, 35.9], [8, 37.4], [11.3, 37.3], [12, 35.5], [20, 33],
  [25, 33], [32.3, 31.6], [32.5, 29.9], [33.8, 27.7], [36, 24], [38.5, 20],
  [41, 16], [43.3, 12.6], [44, 12], [52.5, 12], [60, -5], [60, -40],
  [-25, -40], [-25, 20], [-14, 34], [-10, 35.5],
]
const OCEANIA: Ring = [
  [110, -11], [129, -10.5], [130.5, -9.5], [130, -1], [131, 1], [180, 10],
  [180, -55], [110, -55],
]
// Cap below 58°S; dense points so the great-circle edges hug the parallel
const ANTARCTICA: Ring = Array.from({ length: 18 }, (_, i) => [-180 + i * 20, -58])

const highlight = {
  exclude: {
    type: "GeometryCollection",
    geometries: [SOUTH_AMERICA, AFRICA, OCEANIA, ANTARCTICA].map(polygon),
  } satisfies GeoJSON.GeometryCollection,
}

// One label per region, placed near its middle.
const markers = [
  { id: "north-america", location: [45, -100] as [number, number], label: "North America" },
  { id: "europe", location: [52, 15] as [number, number], label: "Europe" },
  { id: "asia", location: [45, 95] as [number, number], label: "Asia" },
]

const center: [number, number] = [25, -30]

export default function GlobeDemo() {
  return (
    <div className="flex items-center justify-center w-full min-h-screen bg-white p-8 overflow-hidden">
      <div className="w-full max-w-lg">
        <GlyphGlobe
          markers={markers}
          highlight={highlight}
          center={center}
          highlightColor="#0AB574"
          color="#a3a3a3"
          glyphSize={1.6}
        />
      </div>
    </div>
  )
}
