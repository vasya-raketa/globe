import { useCallback, useEffect, useRef } from "react"
import { geoDistance, geoOrthographic, geoPath } from "d3-geo"
import type { GeoPermissibleObjects } from "d3-geo"
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
import land110m from "world-atlas/land-110m.json"

const land = feature(
  land110m as unknown as Topology<{ land: GeometryCollection }>,
  (land110m as unknown as Topology<{ land: GeometryCollection }>).objects.land
)

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

interface LineGlobeProps {
  markers?: Marker[]
  highlight?: Highlight
  className?: string
  lineColor?: string
  highlightColor?: string
  /** Angular gap between hatch lines, in degrees */
  lineSpacing?: number
  lineWidth?: number
  /** Auto-rotation, radians per frame */
  speed?: number
  /** Initial view centre, [lat, lng] */
  center?: [number, number]
}

const toRad = Math.PI / 180

/**
 * Hatch lines: concentric small circles around a pole that sits in the ocean
 * (its antipode is in the ocean too), wobbled so the lines flow like the
 * hand-drawn style. Circles keep the spacing even everywhere on the sphere.
 */
function hatchLines(spacing: number): GeoJSON.MultiLineString {
  const pole = [-25 * toRad, -15 * toRad] // South Atlantic → antipode in the Pacific
  const p: [number, number, number] = [
    Math.cos(pole[0]) * Math.cos(pole[1]),
    Math.cos(pole[0]) * Math.sin(pole[1]),
    Math.sin(pole[0]),
  ]
  // Orthonormal basis around the pole
  const e1: [number, number, number] = [-Math.sin(pole[1]), Math.cos(pole[1]), 0]
  const e2: [number, number, number] = [
    p[1] * e1[2] - p[2] * e1[1],
    p[2] * e1[0] - p[0] * e1[2],
    p[0] * e1[1] - p[1] * e1[0],
  ]

  const lines: [number, number][][] = []
  for (let r = spacing; r < 180; r += spacing) {
    const rad = r * toRad
    const steps = Math.max(24, Math.ceil((360 * Math.sin(rad)) / 1.5))
    const line: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI
      // Gentle bends; damped near the pole so the small circles stay clean
      const rr =
        rad +
        Math.min(1, 2 * Math.sin(rad)) *
          (0.05 * Math.sin(3 * a + rad * 2) + 0.025 * Math.sin(7 * a - rad * 5))
      const c = Math.cos(rr)
      const s = Math.sin(rr)
      const x = c * p[0] + s * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0])
      const y = c * p[1] + s * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1])
      const z = c * p[2] + s * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])
      line.push([Math.atan2(y, x) / toRad, Math.asin(Math.max(-1, Math.min(1, z))) / toRad])
    }
    lines.push(line)
  }
  return { type: "MultiLineString", coordinates: lines }
}

export function LineGlobe({
  markers = [],
  highlight,
  className = "",
  lineColor = "#a3a3a3",
  highlightColor = "#0AB574",
  lineSpacing = 1.7,
  lineWidth = 1.2,
  speed = 0.003,
  center = [25, -30],
}: LineGlobeProps) {
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

    const hatch = hatchLines(lineSpacing)
    // Offscreen layers: grey land lines, and the highlighted copy of them
    const landLayer = document.createElement("canvas")
    const highlightLayer = document.createElement("canvas")
    const landCtx = landLayer.getContext("2d")!
    const highlightCtx = highlightLayer.getContext("2d")!

    const projection = geoOrthographic().precision(0.5)
    let size = 0
    let dpr = 1
    let animationId = 0
    let phi = 0

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      size = canvas!.offsetWidth * dpr
      for (const c of [canvas!, landLayer, highlightLayer]) {
        c.width = size
        c.height = size
      }
      projection.scale(size / 2 - 2 * dpr).translate([size / 2, size / 2])
    }

    function draw() {
      if (!size) return
      const view = [
        centerLng + (phi + phiOffsetRef.current + dragOffset.current.phi) / toRad,
        centerLat + (thetaOffsetRef.current + dragOffset.current.theta) / toRad,
      ]
      projection.rotate([-view[0], -view[1]])

      // Land lines
      landCtx.globalCompositeOperation = "source-over"
      landCtx.clearRect(0, 0, size, size)
      landCtx.beginPath()
      geoPath(projection, landCtx)(hatch)
      landCtx.lineWidth = lineWidth * dpr
      landCtx.lineCap = "round"
      landCtx.strokeStyle = lineColor
      landCtx.stroke()
      landCtx.globalCompositeOperation = "destination-in"
      landCtx.beginPath()
      geoPath(projection, landCtx)(land)
      landCtx.fill()

      // Highlighted land: the same lines, recoloured and masked
      highlightCtx.globalCompositeOperation = "source-over"
      highlightCtx.clearRect(0, 0, size, size)
      if (highlight) {
        highlightCtx.drawImage(landLayer, 0, 0)
        highlightCtx.globalCompositeOperation = "source-in"
        highlightCtx.fillStyle = highlightColor
        highlightCtx.fillRect(0, 0, size, size)
        if (highlight.include) {
          highlightCtx.globalCompositeOperation = "destination-in"
          highlightCtx.beginPath()
          geoPath(projection, highlightCtx)(highlight.include)
          highlightCtx.fill()
        }
        if (highlight.exclude) {
          highlightCtx.globalCompositeOperation = "destination-out"
          highlightCtx.beginPath()
          geoPath(projection, highlightCtx)(highlight.exclude)
          highlightCtx.fill()
        }
      }

      // Sphere, then both line layers
      const r = projection.scale()
      ctx!.clearRect(0, 0, size, size)
      const shade = ctx!.createRadialGradient(size / 2, size / 2, r * 0.6, size / 2, size / 2, r)
      shade.addColorStop(0, "#ffffff")
      shade.addColorStop(1, "#f1f0ee")
      ctx!.beginPath()
      ctx!.arc(size / 2, size / 2, r, 0, 2 * Math.PI)
      ctx!.fillStyle = shade
      ctx!.fill()
      ctx!.drawImage(landLayer, 0, 0)
      ctx!.drawImage(highlightLayer, 0, 0)

      // Labels follow their anchor point; hidden on the far side
      const centerLngLat: [number, number] = [view[0], view[1]]
      for (const m of markers) {
        const el = labelRefs.current.get(m.id)
        if (!el) continue
        const lngLat: [number, number] = [m.location[1], m.location[0]]
        const visible = geoDistance(lngLat, centerLngLat) < Math.PI / 2 - 0.25
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
  }, [markers, highlight, lineColor, highlightColor, lineSpacing, lineWidth, speed, centerLat, centerLng])

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
