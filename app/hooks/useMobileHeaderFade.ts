import { useRef } from "react";

/**
 * Retorna refs para el header y el backdrop del safe-area.
 * La lógica de scroll se maneja directamente en cada layout
 * para admitir comportamientos diferentes (fade en home, shrink+swap en perfil/grupo).
 */
export function useMobileHeaderFade() {
  const headerRef = useRef<HTMLElement>(null);
  const safeAreaRef = useRef<HTMLDivElement>(null);
  return { headerRef, safeAreaRef };
}
