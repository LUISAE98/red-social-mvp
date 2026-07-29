// Breakpoints canónicos de Vibra. Fuente única para reemplazar los ~7 umbrales
// dispersos (599/639/640/767/768/900/1220…) que hoy viven hardcodeados en cada
// componente. Valores elegidos por los dominantes del código actual.
//
// Uso: import { BREAKPOINTS } from "@/lib/ui/breakpoints" + el hook useMediaQuery
// (lib/hooks/useMediaQuery.ts), o useIsMobile()/useIsCompact().

export const BREAKPOINTS = {
  /** ≤640px = teléfono. */
  mobile: 640,
  /** ≤768px = tablet vertical. */
  tablet: 768,
  /** ≤900px = corte dominante "móvil/tablet vs laptop" en la app. */
  laptop: 900,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** Media query `max-width` a partir de px o un nombre de breakpoint. */
export function maxWidth(bp: Breakpoint | number): string {
  const px = typeof bp === "number" ? bp : BREAKPOINTS[bp];
  return `(max-width: ${px}px)`;
}
