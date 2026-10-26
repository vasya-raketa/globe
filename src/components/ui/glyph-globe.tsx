import { useCallback, useEffect, useRef } from "react"
import { geoDistance, geoEquirectangular, geoOrthographic, geoPath } from "d3-geo"
import type { GeoPermissibleObjects } from "d3-geo"
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
import land110m from "world-atlas/land-110m.json"

const landTopology = land110m as unknown as Topology<{ land: GeometryCollection }>
const land = feature(landTopology, landTopology.objects.land)

// The glyph each land cell is drawn with (Union.svg, 45 × 24)
const GLYPH_PATH =
  "M44.2461 6.43164H7.60742C6.95829 6.4319 6.4319 6.95829 6.43164 7.60742C6.43164 8.25677 6.95813 8.78392 7.60742 8.78418H37.3223C41.5238 8.78432 44.9305 12.1901 44.9307 16.3916C44.9307 20.5932 41.5239 23.9999 37.3223 24H0.858398V17.5674H37.3223C37.9717 17.5672 38.498 17.041 38.498 16.3916C38.4979 15.7423 37.9715 15.216 37.3223 15.2158H7.60742C3.40592 15.2156 0 11.809 0 7.60742C0.000255462 3.40607 3.40607 0.000255618 7.60742 0H44.2461V6.43164Z"
const GLYPH_W = 45
const GLYPH_H = 24

interface Marker {
  id: string
  location: [number, number] // [lat, lng]
  label: string
}

interface Highlight {
  /** Land inside this area is highlighted (default: all land) */
  include?: GeoPermissibleObjects
  /** Land inside this area is never highlighted */
  exclude?: GeoPermissibleObjects
}

interface GlyphGlobeProps {
  markers?: Marker[]
  highlight?: Highlight
  className?: string
  color?: string
  highlightColor?: string
  /** Glyph width on the globe, in degrees of arc */
  glyphSize?: number
  /** Space between glyphs, as a fraction of the glyph size */
  gap?: number
  /** Auto-rotation, radians per frame */
  speed?: number
  /** Initial view centre, [lat, lng] */
  center?: [number, number]
}

const toRad = Math.PI / 180

interface Cell {
  lng: number
  lat: number
  highlighted: boolean
}

/** Rasterises `shape` onto an equirectangular grid for fast lookups */
function rasterMask(shapes: GeoPermissibleObjects[]) {
  const w = 1440
  const h = 720
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  const path = geoPath(geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]), ctx)
  for (const shape of shapes) {
    ctx.beginPath()
    path(shape)
    ctx.fill()
  }
  const data = ctx.getImageData(0, 0, w, h).data
  return (lng: number, lat: number) => {
    const x = Math.min(w - 1, Math.floor(((lng + 180) / 360) * w))
    const y = Math.min(h - 1, Math.floor(((90 - lat) / 180) * h))
    return data[(y * w + x) * 4 + 3] > 127
  }
}

/** Brick-laid grid of glyph cells over the land, evenly spaced on the sphere */
function landCells(glyphSize: number, gap: number, highlight?: Highlight): Cell[] {
  const isLand = rasterMask([land])
  const inInclude = highlight?.include ? rasterMask([highlight.include]) : () => true
  const inExclude = highlight?.exclude ? rasterMask([highlight.exclude]) : () => false

  const colStep = glyphSize * (1 + gap)
  const rowStep = glyphSize * (GLYPH_H / GLYPH_W) * (1 + gap * 1.6)
  const cells: Cell[] = []
  let row = 0
  for (let lat = -90 + rowStep / 2; lat < 90; lat += rowStep, row++) {
    const lngStep = colStep / Math.max(Math.cos(lat * toRad), 0.05)
    const offset = row % 2 ? lngStep / 2 : 0
    for (let lng = -180 + offset; lng < 180; lng += lngStep) {
      if (!isLand(lng, lat)) continue
      cells.push({
        lng,
        lat,
        highlighted: !!highlight && inInclude(lng, lat) && !inExclude(lng, lat),
      })
    }
  }
  return cells
}

export function GlyphGlobe({
  markers = [],
  highlight,
  className = "",
  color = "#a3a3a3",
  highlightColor = "#0AB574",
  glyphSize = 2.4,
  gap = 0.3,
  speed = 0.003,
  center = [25, -30],
}: GlyphGlobeProps) {
  const [centerLat, centerLng] = center
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null)
  const lastPointer = useRef<{ x: number; y: number; t: number } | null>(null)
  const dragOffset = useRef({ phi: 0, theta: 0 })
  const velocity = useRef({ phi: 0, theta: 0 })
  const phiOffsetRef = useRef(0)
  const thetaOffsetRef = useRef(0)
  const isPausedRef = useRef(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY }
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"
    isPausedRef.current = true
  }, [])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (pointerInteracting.current !== null) {
      const deltaX = e.clientX - pointerInteracting.current.x
      const deltaY = e.clientY - pointerInteracting.current.y
      dragOffset.current = { phi: deltaX / 300, theta: deltaY / 1000 }
      const now = Date.now()
      if (lastPointer.current) {
        const dt = Math.max(now - lastPointer.current.t, 1)
        const maxVelocity = 0.15
        velocity.current = {
          phi: Math.max(
            -maxVelocity,
            Math.min(maxVelocity, ((e.clientX - lastPointer.current.x) / dt) * 0.3)
          ),
          theta: Math.max(
            -maxVelocity,
            Math.min(maxVelocity, ((e.clientY - lastPointer.current.y) / dt) * 0.08)
          ),
        }
      }
      lastPointer.current = { x: e.clientX, y: e.clientY, t: now }
    }
  }, [])

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi
      thetaOffsetRef.current += dragOffset.current.theta
      dragOffset.current = { phi: 0, theta: 0 }
      lastPointer.current = null
    }
    pointerInteracting.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = "grab"
    isPausedRef.current = false
  }, [])

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerup", handlePointerUp, { passive: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const cells = landCells(glyphSize, gap, highlight)
    const glyph = new Path2D(GLYPH_PATH)
    // Glyph units → degrees of arc
    const unit = glyphSize / GLYPH_W

    const projection = geoOrthographic()
    let size = 0
    let dpr = 1
    let animationId = 0
    let phi = 0

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      size = canvas!.offsetWidth * dpr
      canvas!.width = size
      canvas!.height = size
      projection.scale(size / 2 - 2 * dpr).translate([size / 2, size / 2])
    }

    function draw() {
      if (!size) return
      const lambda = centerLng + (phi + phiOffsetRef.current + dragOffset.current.phi) / toRad
      const tilt = centerLat + (thetaOffsetRef.current + dragOffset.current.theta) / toRad
      projection.rotate([-lambda, -tilt])
      const r = projection.scale()

      // Each glyph lies flat on the sphere: map it through the projected
      // east/north directions at its cell, so it foreshortens towards the rim.
      const grey = new Path2D()
      const green = new Path2D()
      const viewCenter: [number, number] = [lambda, tilt]
      const matrix = new DOMMatrix()
      for (const cell of cells) {
        if (geoDistance([cell.lng, cell.lat], viewCenter) > Math.PI / 2 - 0.02) continue
        const p = projection([cell.lng, cell.lat])!
        const pe = projection([cell.lng + 0.5 / Math.max(Math.cos(cell.lat * toRad), 0.05), cell.lat])!
        const pn = projection([cell.lng, cell.lat + 0.5])!
        const ex = (pe[0] - p[0]) * 2 * unit
        const ey = (pe[1] - p[1]) * 2 * unit
        const nx = (pn[0] - p[0]) * 2 * unit
        const ny = (pn[1] - p[1]) * 2 * unit
        matrix.a = ex
        matrix.b = ey
        matrix.c = -nx
        matrix.d = -ny
        matrix.e = p[0] - (GLYPH_W / 2) * ex + (GLYPH_H / 2) * nx
        matrix.f = p[1] - (GLYPH_W / 2) * ey + (GLYPH_H / 2) * ny
        ;(cell.highlighted ? green : grey).addPath(glyph, matrix)
      }

      ctx!.clearRect(0, 0, size, size)
      const shade = ctx!.createRadialGradient(size / 2, size / 2, r * 0.6, size / 2, size / 2, r)
      shade.addColorStop(0, "#ffffff")
      shade.addColorStop(1, "#f1f0ee")
      ctx!.beginPath()
      ctx!.arc(size / 2, size / 2, r, 0, 2 * Math.PI)
      ctx!.fillStyle = shade
      ctx!.fill()
      ctx!.fillStyle = color
      ctx!.fill(grey)
      ctx!.fillStyle = highlightColor
      ctx!.fill(green)

      // Labels follow their anchor point; hidden on the far side
      for (const m of markers) {
        const el = labelRefs.current.get(m.id)
        if (!el) continue
        const lngLat: [number, number] = [m.location[1], m.location[0]]
        const visible = geoDistance(lngLat, viewCenter) < Math.PI / 2 - 0.25
        const [x, y] = projection(lngLat) ?? [0, 0]
        el.style.left = `${(x / size) * 100}%`
        el.style.top = `${(y / size) * 100}%`
        el.style.opacity = visible ? "1" : "0"
        el.style.filter = visible ? "blur(0)" : "blur(8px)"
      }
    }

    function animate() {
      if (!isPausedRef.current) {
        phi += speed
        if (
          Math.abs(velocity.current.phi) > 0.0001 ||
          Math.abs(velocity.current.theta) > 0.0001
        ) {
          phiOffsetRef.current += velocity.current.phi
          thetaOffsetRef.current += velocity.current.theta
          velocity.current.phi *= 0.95
          velocity.current.theta *= 0.95
        }
        const thetaMin = -0.4,
          thetaMax = 0.4
        if (thetaOffsetRef.current < thetaMin) {
          thetaOffsetRef.current += (thetaMin - thetaOffsetRef.current) * 0.1
        } else if (thetaOffsetRef.current > thetaMax) {
          thetaOffsetRef.current += (thetaMax - thetaOffsetRef.current) * 0.1
        }
      }
      draw()
      animationId = requestAnimationFrame(animate)
    }

    const ro = new ResizeObserver(() => {
      resize()
      draw()
    })
    ro.observe(canvas)
    resize()
    animate()
    setTimeout(() => (canvas.style.opacity = "1"))

    return () => {
      ro.disconnect()
      cancelAnimationFrame(animationId)
    }
  }, [markers, highlight, color, highlightColor, glyphSize, gap, speed, centerLat, centerLng])

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1.2s ease",
          borderRadius: "50%",
          touchAction: "none",
          filter: "drop-shadow(0 0 24px rgba(240, 237, 232, 0.9))",
        }}
      />
      {markers.map((m) => (
        <div
          key={m.id}
          ref={(el) => {
            if (el) labelRefs.current.set(m.id, el)
            else labelRefs.current.delete(m.id)
          }}
          style={{
            position: "absolute",
            translate: "-50% calc(-100% - 8px)",
            padding: "2px 6px",
            background: "#1a1a2e",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: "0.6rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            opacity: 0,
            transition: "opacity 0.8s, filter 0.8s",
          }}
        >
          {m.label}
          <span
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translate3d(-50%, -1px, 0)",
              border: "5px solid transparent",
              borderTopColor: "#1a1a2e",
            }}
          />
        </div>
      ))}
    </div>
  )
}
