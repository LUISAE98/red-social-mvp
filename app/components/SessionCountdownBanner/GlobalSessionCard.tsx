"use client";

import { useLayoutEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import DraggableSessionCard from "@/app/components/SessionCountdownBanner/DraggableSessionCard";

export default function GlobalSessionCard() {
  const { user } = useAuth();
  const [isEmbed, setIsEmbed] = useState(false);

  useLayoutEffect(() => {
    try {
      setIsEmbed(window.self !== window.top);
    } catch {
      setIsEmbed(true);
    }
  }, []);

  if (isEmbed || !user) return null;
  return <DraggableSessionCard uid={user.uid} />;
}
