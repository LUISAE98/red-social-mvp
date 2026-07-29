"use client";

// Hook central para media queries (reemplaza el matchMedia ad-hoc repartido en
// ~47 componentes con umbrales distintos). SSR-safe: arranca en `false` y se
// corrige tras hidratar, para no romper la hidratación (ver [[project_hydration_audit]]).

import { useEffect, useState } from "react";
import { BREAKPOINTS, maxWidth, type Breakpoint } from "@/lib/ui/breakpoints";

/**
 * Devuelve true si la media query matchea. Acepta una query CSS completa,
 * un número (se interpreta como `max-width: Npx`) o un nombre de breakpoint.
 */
export function useMediaQuery(query: string | number | Breakpoint): boolean {
  const resolved =
    typeof query === "number"
      ? maxWidth(query)
      : query in BREAKPOINTS
        ? maxWidth(query as Breakpoint)
        : query;

  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(resolved);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [resolved]);

  return matches;
}

/** ≤640px (teléfono). */
export function useIsMobile(): boolean {
  return useMediaQuery("mobile");
}

/** ≤900px (móvil/tablet vs laptop — el corte dominante de la app). */
export function useIsCompact(): boolean {
  return useMediaQuery("laptop");
}
