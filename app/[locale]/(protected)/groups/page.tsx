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
        // Sin padding lateral aquí: OwnerSidebar ya trae sus propios 10px de panel.
        // Antes iba position:fixed de borde a borde (ignoraba este wrapper); ahora
        // en flujo, sumar padding lateral estrechaba el contenido. Se conserva el
        // ancho previo (~full width) dejando solo el padding vertical.
        padding: "16px 0 120px",
        color: "#fff",
      }}
    >
      <OwnerSidebar />
    </div>
  );
}
