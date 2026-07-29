"use client";

// Boundary de error por ruta (App Router). Cada `error.tsx` de un segmento
// renderiza este componente: reporta el error a Sentry con contexto y ofrece
// reintentar SIN recargar toda la app (a diferencia de global-error.tsx, que solo
// actúa si falla el layout raíz). Así un fallo en una sección degrada solo esa
// sección, no toda la aplicación.

import { useEffect } from "react";
import { captureError } from "@/lib/observability/captureError";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Área de la app para el tag de Sentry (ej. "groups", "wallet", "profile"). */
  scope?: string;
};

export default function RouteError({ error, reset, scope = "route" }: Props) {
  useEffect(() => {
    captureError(error, { scope, extra: { digest: error.digest, boundary: "route" } });
  }, [error, scope]);

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        minHeight: "60vh",
        padding: "40px 24px",
        textAlign: "center",
        color: "#e6e7ea",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: 28,
          background: "rgba(168,85,255,0.12)",
          border: "1px solid rgba(168,85,255,0.35)",
        }}
      >
        ⚠️
      </div>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
        Algo salió mal en esta sección
      </h2>
      <p style={{ margin: 0, maxWidth: 360, fontSize: 14, color: "#9aa0a8", lineHeight: 1.5 }}>
        Ocurrió un error inesperado. Puedes reintentar; el resto de la app sigue
        funcionando.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 4,
          padding: "10px 20px",
          fontSize: 14,
          fontWeight: 600,
          color: "#fff",
          background: "linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%)",
          border: "none",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        Reintentar
      </button>
    </div>
  );
}
