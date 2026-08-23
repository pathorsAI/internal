import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// NOTE: diverges from the stock shadcn/ui hook, which set state inside an effect
// (a cascading render, and a first paint at the wrong breakpoint). useSyncExternalStore
// is the purpose-built API for reading an external source like matchMedia: it
// subscribes without an effect and takes a separate server snapshot, so SSR renders
// the desktop layout deterministically instead of hydrating from `undefined`.
function subscribe(onChange: () => void) {
  const mql = globalThis.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const getSnapshot = () => globalThis.matchMedia(QUERY).matches
const getServerSnapshot = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
