"use client";

/**
 * Skeletons del DM, sobre la base canónica de `vibra_style.md`: misma clase
 * `.vb-skel` (mismo relleno y misma onda `vbSkelWave`) que el resto de la
 * plataforma; solo cambian las formas.
 *
 * Nada de spinners ni de "Cargando…": mientras carga se dibuja la silueta de lo
 * que va a aparecer, y el contenido real entra con fade (ver `ChatReveal`).
 */

/** Relleno + onda + reduced-motion. Idéntico en los tres skeletons de aquí. */
function SkeletonBase() {
  return (
    <style jsx global>{`
      .vb-chat-skel .vb-skel {
        /* Color sólido POR SI el gradiente/animación no pinta (fallback). */
        background-color: rgba(255, 255, 255, 0.08);
        background-image: linear-gradient(
          100deg,
          rgba(255, 255, 255, 0.05) 30%,
          rgba(255, 255, 255, 0.11) 50%,
          rgba(255, 255, 255, 0.05) 70%
        );
        background-size: 300% 100%;
        animation: vbSkelWave 1.6s ease-in-out infinite;
      }
      @keyframes vbSkelWave {
        0% {
          background-position: 180% 0;
        }
        100% {
          background-position: -80% 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .vb-chat-skel .vb-skel {
          animation: none;
          background: rgba(255, 255, 255, 0.07);
        }
      }
    `}</style>
  );
}

/**
 * Filas de la lista de conversaciones: avatar + nombre + última línea.
 * Misma métrica que `ConversationList` para que no salte nada al reemplazarse.
 */
export function ConversationListSkeleton({
  rows = 4,
  avatarSize = 36,
}: {
  rows?: number;
  avatarSize?: number;
}) {
  return (
    <div className="vb-chat-skel" aria-hidden>
      <SkeletonBase />
      <div style={{ display: "grid", gap: 6 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
            }}
          >
            <div
              className="vb-skel"
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: "50%",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 7 }}>
              {/* Anchos desiguales: una columna de barras idénticas se lee
                  como una tabla rota, no como texto cargando. */}
              <div
                className="vb-skel"
                style={{ height: 10, borderRadius: 6, width: `${58 - (i % 3) * 9}%` }}
              />
              <div
                className="vb-skel"
                style={{ height: 9, borderRadius: 6, width: `${82 - (i % 4) * 11}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Globos alternando lado, como se verá la conversación real. */
export function MessageThreadSkeleton({ bubbles = 6 }: { bubbles?: number }) {
  // Anchos fijos por posición: aleatorio re-generaría en cada render y la onda
  // parecería saltar.
  const widths = [62, 44, 71, 38, 55, 48, 66, 41];

  return (
    <div className="vb-chat-skel" aria-hidden style={{ display: "grid", gap: 8 }}>
      <SkeletonBase />
      {Array.from({ length: bubbles }).map((_, i) => {
        const mine = i % 2 === 1;
        return (
          <div
            key={i}
            style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}
          >
            <div
              className="vb-skel"
              style={{
                width: `${widths[i % widths.length]}%`,
                height: 34,
                borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Bloque shimmer suelto, para reservar el hueco de algo que aún no llegó.
 *
 * Trae consigo la base (`.vb-skel` va scopeada bajo `.vb-chat-skel`), así que se
 * puede soltar en cualquier sitio. El envoltorio va en `display: contents` para
 * no meter una caja de más en el layout de quien lo usa.
 */
export function SkeletonBlock({ style }: { style?: React.CSSProperties }) {
  return (
    <span className="vb-chat-skel" aria-hidden style={{ display: "contents" }}>
      <SkeletonBase />
      <span className="vb-skel" style={{ display: "block", ...style }} />
    </span>
  );
}

/**
 * Imagen que se está subiendo, en su sitio del hilo.
 *
 * La foto se manda al elegirla, así que hay una ventana en la que el mensaje
 * todavía no existe. En vez de dejar el hilo quieto, se ocupa ya el hueco con la
 * silueta del globo: al llegar el mensaje real, nada salta de sitio.
 *
 * Va siempre del lado de quien escribe — solo tú puedes estar subiendo algo.
 */
export function SendingImageSkeleton() {
  return (
    <div
      className="vb-chat-skel"
      aria-hidden
      style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}
    >
      <div
        className="vb-skel"
        style={{
          width: 200,
          height: 150,
          // Mismo redondeo que un globo propio: es lo que va a sustituirlo.
          borderRadius: "16px 16px 4px 16px",
        }}
      />
      <SkeletonBase />
    </div>
  );
}

/**
 * Revelado del contenido real: entra con fade en vez de aparecer de golpe.
 * `show` pasa a true cuando los datos llegaron.
 */
export function ChatReveal({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transition: "opacity 380ms ease",
        willChange: "opacity",
      }}
    >
      {children}
    </div>
  );
}
