"use client";

import { useLayoutEffect, useState } from "react";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import { useScreenReady } from "@/lib/useScreenReady";

/**
 * Tu espacio personal en celular: la tarjeta de tu perfil, a quién sigues y tus
 * comunidades. Es lo que abre el avatar del nav inferior.
 *
 * Se llama `/menu` y no `/groups` (donde vivía antes) porque ya no es solo el
 * índice de comunidades: es el menú que hay detrás de tu avatar. Tocar la
 * tarjeta de arriba es lo que lleva al perfil de verdad, `/u/{handle}`.
 */
export default function MenuMobilePage() {
  // Avisa al montar: el menú es el OwnerSidebar, que trae sus propios estados
  // de carga por sección. Retener el splash por encima solo taparía la tarjeta
  // del perfil, que ya se puede pintar.
  useScreenReady();

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
        // Y abajo NADA: el hueco del nav lo reserva entero `.mainCol` en el
        // layout protegido. Cualquier padding inferior aquí se le suma y vuelve
        // a abrir el espacio muerto.
        padding: "16px 0 0",
        color: "#fff",
      }}
    >
      <OwnerSidebar />
    </div>
  );
}
