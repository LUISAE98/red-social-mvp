let _dir: "left" | "right" | null = null;
let _overlayDir: "left" | "right" | null = null;

export function setNavSlideDir(d: "left" | "right") {
  _dir = d;
  _overlayDir = d;
}

export function consumeNavSlideDir(): "left" | "right" | null {
  const d = _dir;
  _dir = null;
  return d;
}

// Separate consume for position:fixed overlays (e.g. OwnerSidebar) that
// mount asynchronously after auth resolves — they pick this up independently.
export function consumeNavOverlayDir(): "left" | "right" | null {
  const d = _overlayDir;
  _overlayDir = null;
  return d;
}
