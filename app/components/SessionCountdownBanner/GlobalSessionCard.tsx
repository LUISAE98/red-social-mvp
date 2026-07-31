"use client";

import { useLayoutEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import { useIsCompact } from "@/lib/hooks/useMediaQuery";
import DraggableSessionCard from "@/app/components/SessionCountdownBanner/DraggableSessionCard";

export default function GlobalSessionCard() {
  const { user } = useAuth();
  const isCompact = useIsCompact(); // ≤900px (celular/tablet)
  const [isEmbed, setIsEmbed] = useState(false);

  useLayoutEffect(() => {
    try {
      setIsEmbed(window.self !== window.top);
    } catch {
      setIsEmbed(true);
    }
  }, []);

  // En laptop (>900px) el card vive dentro del OwnerSidebar; el flotante es solo
  // para celular/tablet, donde no hay sidebar.
  if (isEmbed || !user || !isCompact) return null;
  return <DraggableSessionCard uid={user.uid} />;
}
