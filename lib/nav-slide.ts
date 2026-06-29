let _dir: "left" | "right" | null = null;

export function setNavSlideDir(d: "left" | "right") {
  _dir = d;
}

export function consumeNavSlideDir(): "left" | "right" | null {
  const d = _dir;
  _dir = null;
  return d;
}
