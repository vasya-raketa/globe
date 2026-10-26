import { useEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useInView } from "@/hooks/use-in-view"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
import { MAP_BOUNDS, MAP_HEIGHT, MAP_POINTS, MAP_WIDTH } from "./dotted-world-map.points"
import {
  CUSTOMERS,
  DESKTOPS,
  REGION_BOXES,
  REGIONS,
  TIMELINE,
} from "./dotted-world-map.data"
import type { LatLng, RegionId, RegionKey, RegionWeights } from "./dotted-world-map.data"

type Variant = "desktops" | "customers" | "regions" | "timeline"

interface DottedWorldMapProps {
  variant: Variant
  className?: string
  /** Defaults to the brand green (`--map-highlight`) */
  highlightColor?: string
  /** Defaults to light gray (`--map-dot`) */
  baseColor?: string
}

/**
 * idle   — not scrolled into view yet; animated elements are hidden
 * play   — animating (paused via `data-paused` while off-screen)
 * static — prefers-reduced-motion: final state, no animation
 */
type MapState = "idle" | "play" | "static"

interface OverlayProps {
  state: MapState
  /** Playing and on-screen — JS-driven animation should run */
  active: boolean
}

// ---------------------------------------------------------------------------
// Geometry — computed once at module load
// ---------------------------------------------------------------------------

const DOT_R = 0.3

interface Point {
  x: number
  y: number
}

interface Dot extends Point, LatLng {
  region: RegionKey
}

const REGION_ORDER = Object.keys(REGION_BOXES) as RegionId[]

function regionOf({ lat, lng }: LatLng): RegionKey {
  for (const id of REGION_ORDER) {
    for (const box of REGION_BOXES[id]) {
      if (lat >= box.lat[0] && lat <= box.lat[1] && lng >= box.lng[0] && lng <= box.lng[1]) {
        return id
      }
    }
  }
  return "rest"
}

const DOTS: Dot[] = []
for (let i = 0; i < MAP_POINTS.length; i += 4) {
  const [x, y, lat, lng] = MAP_POINTS.slice(i, i + 4)
  DOTS.push({ x, y, lat, lng, region: regionOf({ lat, lng }) })
}

/** Many circles as a single path — one DOM node instead of thousands */
function circlesPath(points: Point[], r = DOT_R) {
  return points
    .map(({ x, y }) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`)
    .join("")
}

const BASE_PATH = circlesPath(DOTS)

// Ellipsoidal Mercator, matching dotted-map's proj4 projection
const WGS84_A = 6378137
const WGS84_E = 0.0818191908426215

/** lat/lng → map coordinates (unsnapped, unlike dotted-map's getPin) */
function project({ lat, lng }: LatLng): Point {
  const phi = (lat * Math.PI) / 180
  const es = WGS84_E * Math.sin(phi)
  const mx = (WGS84_A * lng * Math.PI) / 180
  const my =
    WGS84_A * Math.log(Math.tan(Math.PI / 4 + phi / 2) * ((1 - es) / (1 + es)) ** (WGS84_E / 2))
  return {
    x: (MAP_WIDTH * (mx - MAP_BOUNDS.xMin)) / MAP_BOUNDS.xRange,
    y: (MAP_HEIGHT * (MAP_BOUNDS.yMax - my)) / MAP_BOUNDS.yRange,
  }
}

interface Arc {
  d: string
  from: Point
  control: Point
  to: Point
}

/** Quadratic arc whose control point is lifted above (or, with negative lift, below) the midpoint */
function arc(from: Point, to: Point, lift = 0.3): Arc {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  // The curve peaks halfway between the midpoint and the control point;
  // keep that peak inside the map.
  const control = { x: mx, y: Math.max(my - dist * lift, 2 - my) }
  return { d: `M${from.x} ${from.y}Q${control.x} ${control.y} ${to.x} ${to.y}`, from, control, to }
}

function pointOnArc({ from, control, to }: Arc, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  }
}

function seededRandom(seed: number) {
  // mulberry32
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic weighted sample of land dots, by region */
function sampleDots(count: number, weights: RegionWeights, rand: () => number) {
  const picked: Dot[] = []
  for (const region of Object.keys(weights) as RegionKey[]) {
    const pool = DOTS.filter((d) => d.region === region)
    const n = Math.min(pool.length, Math.round(count * weights[region]))
    // Partial Fisher–Yates
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rand() * (pool.length - i))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
      picked.push(pool[i])
    }
  }
  return picked
}

/** Great-circle distance in radians */
function distance(a: LatLng, b: LatLng) {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const pct = (p: Point) => ({
  left: `${(p.x / MAP_WIDTH) * 100}%`,
  top: `${(p.y / MAP_HEIGHT) * 100}%`,
})

/** Per-element animation timing, read by the `.dwm-*` classes in index.css */
const timing = (delayMs: number, durationMs?: number) =>
  ({
    "--dwm-delay": `${Math.round(delayMs)}ms`,
    ...(durationMs !== undefined && { "--dwm-dur": `${Math.round(durationMs)}ms` }),
  }) as CSSProperties

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Layer({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="absolute inset-0 size-full overflow-visible"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function MapLabel({
  at,
  className,
  style,
  children,
}: {
  at: Point
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -mt-2 -translate-x-1/2 -translate-y-full whitespace-nowrap bg-map-label px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-white",
        className
      )}
      style={{ ...pct(at), ...style }}
    >
      {children}
      <span className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-px border-[5px] border-transparent border-t-map-label" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. desktops — twinkling, region-weighted active dots
// ---------------------------------------------------------------------------

const DESKTOP_DOTS = (() => {
  const rand = seededRandom(DESKTOPS.seed)
  const [minMs, maxMs] = DESKTOPS.durationMs
  return sampleDots(DESKTOPS.count, DESKTOPS.weights, rand).map((dot) => {
    const durationMs = minMs + rand() * (maxMs - minMs)
    return { ...dot, durationMs, delayMs: rand() * durationMs }
  })
})()

// Purely CSS-driven: twinkling starts/pauses via the root's data attributes
function DesktopsOverlay() {
  return (
    <Layer>
      <g className="dwm-fade fill-map-highlight" style={timing(0, 800)}>
        {DESKTOP_DOTS.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={DOT_R * 1.15}
            className="dwm-twinkle"
            style={timing(d.delayMs, d.durationMs)}
          />
        ))}
      </g>
    </Layer>
  )
}

// ---------------------------------------------------------------------------
// 2. customers — hub and spokes from the HQ
// ---------------------------------------------------------------------------

const HQ = project(CUSTOMERS.hq)
const CUSTOMER_ARCS = CUSTOMERS.destinations.map((dest) => {
  const to = project(dest)
  return { ...dest, to, arc: arc(HQ, to) }
})
const POP_MS = 450
const CYCLE_DRAWN_MS =
  (CUSTOMER_ARCS.length - 1) * CUSTOMERS.staggerMs + CUSTOMERS.drawMs + POP_MS

function CustomersOverlay({ state, active }: OverlayProps) {
  // Each cycle remounts the arcs (via key) so their CSS animations replay.
  const [cycle, setCycle] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (!active) return
    const fade = setTimeout(() => setFading(true), CYCLE_DRAWN_MS + CUSTOMERS.holdMs)
    const restart = setTimeout(
      () => {
        setFading(false)
        setCycle((c) => c + 1)
      },
      CYCLE_DRAWN_MS + CUSTOMERS.holdMs + CUSTOMERS.fadeMs
    )
    return () => {
      clearTimeout(fade)
      clearTimeout(restart)
    }
  }, [active, cycle])

  const fadeStyle: CSSProperties = {
    opacity: fading ? 0 : 1,
    transition: `opacity ${CUSTOMERS.fadeMs}ms ease`,
  }
  const landAt = (i: number) => i * CUSTOMERS.staggerMs + CUSTOMERS.drawMs

  return (
    <>
      <Layer>
        <g key={cycle} style={fadeStyle}>
          <g className="fill-none stroke-map-highlight" strokeWidth={0.22} strokeLinecap="round">
            {CUSTOMER_ARCS.map((a, i) => (
              <path
                key={a.id}
                d={a.arc.d}
                pathLength={1}
                className="dwm-draw"
                style={timing(i * CUSTOMERS.staggerMs, CUSTOMERS.drawMs)}
              />
            ))}
          </g>
          <g className="fill-map-highlight">
            {CUSTOMER_ARCS.map((a, i) => (
              <circle
                key={a.id}
                cx={a.to.x}
                cy={a.to.y}
                r={0.55}
                className="dwm-pop"
                style={timing(landAt(i), POP_MS)}
              />
            ))}
          </g>
        </g>
        <g className="fill-map-highlight">
          {state !== "static" && (
            <circle cx={HQ.x} cy={HQ.y} r={0.9} className="dwm-pulse" opacity={0} />
          )}
          <circle cx={HQ.x} cy={HQ.y} r={0.9} />
        </g>
      </Layer>
      <div key={cycle} style={fadeStyle}>
        {CUSTOMER_ARCS.map(
          (a, i) =>
            a.label && (
              <MapLabel
                key={a.id}
                at={a.to}
                className="dwm-fade hidden sm:block"
                style={timing(landAt(i), 400)}
              >
                {a.label}
              </MapLabel>
            )
        )}
      </div>
      <MapLabel at={HQ}>{CUSTOMERS.hq.label}</MapLabel>
    </>
  )
}

// ---------------------------------------------------------------------------
// 3. regions — three highlighted regions linked by arcs
// ---------------------------------------------------------------------------

const REGION_PATH = circlesPath(DOTS.filter((d) => d.region !== "rest"))
const HUBS = REGIONS.hubs.map((hub) => ({ ...hub, at: project(hub) }))
const hubAt = (id: RegionId) => HUBS.find((h) => h.id === id)!.at
const REGION_ARCS = REGIONS.links.map(({ from, to, lift }) => arc(hubAt(from), hubAt(to), lift))
const REGION_DRAW_MS = 1200
const REGION_STAGGER_MS = 300
const REGION_INTRO_MS = 600 + (REGION_ARCS.length - 1) * REGION_STAGGER_MS + REGION_DRAW_MS

function RegionsOverlay({ active }: OverlayProps) {
  const travellers = useRef<(SVGCircleElement | null)[]>([])
  const elapsed = useRef(0)

  // One dot per arc, looping slowly; only runs while on-screen.
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      elapsed.current += now - last
      last = now
      const t = (elapsed.current - REGION_INTRO_MS) / REGIONS.tripMs
      REGION_ARCS.forEach((a, i) => {
        const el = travellers.current[i]
        if (!el) return
        if (t < 0) return
        const p = (t + i / REGION_ARCS.length) % 1
        const { x, y } = pointOnArc(a, p)
        el.setAttribute("cx", String(x))
        el.setAttribute("cy", String(y))
        el.setAttribute("opacity", String(Math.sin(Math.PI * p)))
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return (
    <>
      <Layer>
        <path d={REGION_PATH} className="dwm-fade fill-map-highlight" style={timing(0, 800)} />
        <g className="fill-none stroke-map-highlight" strokeWidth={0.22} strokeLinecap="round">
          {REGION_ARCS.map((a, i) => (
            <path
              key={i}
              d={a.d}
              pathLength={1}
              className="dwm-draw"
              style={timing(600 + i * REGION_STAGGER_MS, REGION_DRAW_MS)}
            />
          ))}
        </g>
        <g className="fill-map-highlight">
          {HUBS.map((h) => (
            <circle key={h.id} cx={h.at.x} cy={h.at.y} r={0.6} />
          ))}
          {REGION_ARCS.map((a, i) => (
            <circle
              key={i}
              ref={(el) => {
                travellers.current[i] = el
              }}
              cx={a.from.x}
              cy={a.from.y}
              r={0.5}
              opacity={0}
            />
          ))}
        </g>
      </Layer>
      {HUBS.map((h) => (
        <MapLabel key={h.id} at={h.at} className="dwm-fade hidden sm:block" style={timing(400, 600)}>
          {h.label}
        </MapLabel>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// 4. timeline — dots light up year by year
// ---------------------------------------------------------------------------

const TIMELINE_DOTS = (() => {
  const dots = sampleDots(TIMELINE.count, TIMELINE.weights, seededRandom(TIMELINE.seed))
  const span = TIMELINE.to - TIMELINE.from
  return TIMELINE.phases.flatMap(({ region, origin, years: [first, last] }) => {
    const inPhase = dots.filter((d) => d.region === region)
    const dists = inPhase.map((d) => distance(origin, d))
    const maxDist = Math.max(...dists, 1e-6)
    return inPhase.map((d, i) => {
      const startYear = first + ((last - first) * dists[i]) / maxDist
      return { ...d, delayMs: ((startYear - TIMELINE.from) / span) * TIMELINE.durationMs }
    })
  })
})()

function TimelineOverlay({ state, active }: OverlayProps) {
  const [year, setYear] = useState(TIMELINE.from)
  const elapsed = useRef(0)

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      elapsed.current = Math.min(TIMELINE.durationMs, elapsed.current + now - last)
      last = now
      const progress = elapsed.current / TIMELINE.durationMs
      setYear(TIMELINE.from + Math.floor((TIMELINE.to - TIMELINE.from) * progress))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  const shownYear = state === "static" ? TIMELINE.to : year
  const done = shownYear === TIMELINE.to

  return (
    <>
      <Layer>
        <g className="fill-map-highlight">
          {TIMELINE_DOTS.map((d, i) => (
            <circle
              key={i}
              cx={d.x}
              cy={d.y}
              r={DOT_R * 1.15}
              className="dwm-light"
              style={timing(d.delayMs, 500)}
            />
          ))}
        </g>
      </Layer>
      <div className="pointer-events-none absolute bottom-0 left-0 flex items-center gap-1.5 font-mono uppercase tracking-[0.08em] text-white">
        <span className="bg-map-label px-2 py-1 text-sm tabular-nums">{shownYear}</span>
        <span
          className={cn(
            "bg-map-highlight px-1.5 py-0.5 text-[0.6rem] transition-opacity duration-500",
            !done && "opacity-0"
          )}
        >
          {TIMELINE.finalLabel}
        </span>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

const OVERLAYS: Record<Variant, (props: OverlayProps) => ReactNode> = {
  desktops: DesktopsOverlay,
  customers: CustomersOverlay,
  regions: RegionsOverlay,
  timeline: TimelineOverlay,
}

const DESCRIPTIONS: Record<Variant, string> = {
  desktops: "World map with managed desktops lit up across North America, Europe and Asia",
  customers: "World map with connections from a US headquarters to customers worldwide",
  regions: "World map linking delivery regions in North America, Europe and Asia",
  timeline: `World map showing growth from ${TIMELINE.from} to ${TIMELINE.to}`,
}

export function DottedWorldMap({
  variant,
  className,
  highlightColor,
  baseColor,
}: DottedWorldMapProps) {
  const { ref, inView, entries } = useInView<HTMLDivElement>(0.3)
  const reduced = usePrefersReducedMotion()
  const state: MapState = reduced ? "static" : entries > 0 ? "play" : "idle"
  const Overlay = OVERLAYS[variant]

  return (
    <div
      ref={ref}
      role="img"
      aria-label={DESCRIPTIONS[variant]}
      data-state={state}
      data-paused={state === "play" && !inView ? "" : undefined}
      className={cn("dwm-root relative w-full select-none", className)}
      style={
        {
          aspectRatio: `${MAP_WIDTH} / ${MAP_HEIGHT}`,
          "--map-highlight": highlightColor,
          "--map-dot": baseColor,
        } as CSSProperties
      }
    >
      <Layer>
        <path d={BASE_PATH} className="fill-map-dot" />
      </Layer>
      {/* customers restarts its sequence each time it scrolls back into view */}
      <Overlay
        key={variant === "customers" ? entries : variant}
        state={state}
        active={state === "play" && inView}
      />
    </div>
  )
}

export type { DottedWorldMapProps, Variant as DottedWorldMapVariant }
