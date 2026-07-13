"use client";

import { useLayoutEffect, useState } from "react";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";

export default function GroupsMobilePage() {
  const [isEmbed, setIsEmbed] = useState(false);

  useLayoutEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsEmbed(window.self !== window.top);
    } catch {
      setIsEmbed(true);
    }
  }, []);

  if (isEmbed) return null;

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "16px 16px 120px",
        color: "#fff",
      }}
    >
      <OwnerSidebar />
    </div>
  );
}
