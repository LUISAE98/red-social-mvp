"use client";

import { useAuth } from "@/app/providers";
import { useScreenReady } from "@/lib/useScreenReady";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import OwnerSidebarSettings from "@/app/components/OwnerSidebar/OwnerSidebarSettings";

/**
 * Configuración, en su propia pantalla.
 *
 * Existe para el menú de laptop: en celular estos mismos ajustes viven dentro
 * del espacio personal (`/menu`), pero en laptop ese espacio no está —el
 * sidebar de la izquierda es otra cosa— y el único camino era entrar al perfil
 * y buscar su pestaña.
 *
 * 🚨 REUSA `OwnerSidebarSettings`, NO COPIA SUS PESTAÑAS. Son siete ajustes con
 * su estado, sus paneles y sus escrituras a Firestore; mantener dos copias en
 * paralelo garantizaba que una se quedara atrás. El componente ya se dibuja como
 * una columna de tarjetas, así que aquí solo se le pone el ancho de página.
 */
export default function ConfiguracionPage() {
  const { user } = useAuth();
  const { toast, showToast } = useVibraToast();

  // El componente trae sus propios estados por pestaña; retener el splash por
  // encima solo taparía una lista que ya se puede pintar.
  useScreenReady();

  return (
    <div className="cfgPage">
      <OwnerSidebarSettings
        uid={user?.uid ?? null}
        email={user?.email ?? null}
        onToast={showToast}
        // Aquí hay alto de sobra: las siete pestañas van abiertas, y el título
        // es el de una página cualquiera en vez del renglón del sidebar.
        variante="pagina"
      />

      <VibraToast toast={toast} />

      <style jsx>{`
        .cfgPage {
          /* Misma columna que notificaciones y mensajes, para que cambiar de
             sección no mueva el ancho del contenido. */
          max-width: 640px;
          margin: 0 auto;
          padding: 8px 12px 12px;
        }
      `}</style>
    </div>
  );
}
