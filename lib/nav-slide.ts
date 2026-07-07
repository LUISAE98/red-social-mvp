let _dir: "left" | "right" | null = null;

export function setNavSlideDir(d: "left" | "right") {
  _dir = d;
}

// Read without clearing — use during render (useMemo) so framer-motion
// gets the correct initial value before useLayoutEffect clears it.
export function peekNavSlideDir(): "left" | "right" | null {
  return _dir;
}

export function consumeNavSlideDir(): "left" | "right" | null {
  const d = _dir;
  _dir = null;
  return d;
}
