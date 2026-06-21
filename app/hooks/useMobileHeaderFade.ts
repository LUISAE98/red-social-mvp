import { useRef } from "react";

/**
 * Previously faded the header on scroll-down. Now disabled — header stays
 * permanently visible on all viewports to match desktop behavior.
 */
export function useMobileHeaderFade() {
  const headerRef = useRef<HTMLElement>(null);
  const safeAreaRef = useRef<HTMLDivElement>(null);

  return { headerRef, safeAreaRef };
}
