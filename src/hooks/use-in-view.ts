import { useEffect, useRef, useState } from "react"

/**
 * Tracks whether an element is in the viewport. `entries` counts how many
 * times it has scrolled into view, so callers can tell "never seen" apart
 * from "seen, now off-screen" and restart work on re-entry.
 */
export function useInView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null)
  const [state, setState] = useState({ inView: false, entries: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        const inView = entry.isIntersecting
        setState((s) =>
          s.inView === inView ? s : { inView, entries: s.entries + (inView ? 1 : 0) }
        )
      },
      { threshold }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  return { ref, ...state }
}
