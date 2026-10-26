import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { DottedWorldMap } from "@/components/ui/dotted-world-map"
import type { DottedWorldMapVariant } from "@/components/ui/dotted-world-map"
import { useInView } from "@/hooks/use-in-view"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"

/** Counts up to `value` once on scroll-in; reserves the final width so nothing shifts */
function CountUp({ value, suffix = "", durationMs = 1500 }: { value: number; suffix?: string; durationMs?: number }) {
  const { ref, entries } = useInView<HTMLSpanElement>(0.3)
  const reduced = usePrefersReducedMotion()
  const [current, setCurrent] = useState(0)
  const started = entries > 0

  useEffect(() => {
    if (!started || reduced) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      setCurrent(Math.round(value * (1 - (1 - t) ** 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [started, reduced, value, durationMs])

  const format = (n: number) => `${n.toLocaleString("en-US")}${suffix}`
  const shown = reduced ? value : current

  return (
    <span ref={ref} className="inline-grid tabular-nums">
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {format(value)}
      </span>
      <span className="col-start-1 row-start-1 text-right" aria-hidden>
        {format(shown)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}

interface StatRow {
  flag: string
  heading: ReactNode
  body: string
  variant: DottedWorldMapVariant
}

// TODO: replace the body copy with the site's existing text.
const ROWS: StatRow[] = [
  {
    flag: "Flag 001",
    heading: (
      <>
        <CountUp value={40000} suffix="+" /> total number of desktops managed
      </>
    ),
    body: "Virtual desktops we run day to day for organisations of every size.",
    variant: "desktops",
  },
  {
    flag: "Flag 002",
    heading: "200+ customers",
    body: "Customers across North America, Europe, the Middle East, Asia and beyond.",
    variant: "customers",
  },
  {
    flag: "Flag 003",
    heading: "Global delivery experience",
    body: "Delivery teams working across North America, Europe and Asia.",
    variant: "regions",
  },
  {
    flag: "Flag 004",
    heading: "15 years of VDI experience",
    body: "Building and running virtual desktop infrastructure since 2011.",
    variant: "timeline",
  },
]

export default function StatsSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
      {ROWS.map((row) => (
        <div
          key={row.flag}
          className="grid items-center gap-8 border-t border-border py-12 md:grid-cols-2 md:gap-12"
        >
          <div className="flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
              {row.flag}
            </span>
            <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
              {row.heading}
            </h2>
            <p className="max-w-md text-muted-foreground">{row.body}</p>
          </div>
          <DottedWorldMap variant={row.variant} />
        </div>
      ))}
    </section>
  )
}
