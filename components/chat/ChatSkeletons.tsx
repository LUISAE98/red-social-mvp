"use client";

/**
 * Skeletons del DM, sobre la base canónica de `vibra_style.md`: misma clase
 * `.vb-skel` (mismo relleno y misma onda `vbSkelWave`) que el resto de la
 * plataforma; solo cambian las formas.
 *
 * Nada de spinners ni de "Cargando…": mientras carga se dibuja la silueta de lo
 * que va a aparecer, y el contenido real entra con fade (ver `ChatReveal`).
 */

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
export function SendingImageSkeleton({
  previewUrl,
  box,
}: {
  /** URL local de la foto elegida. Se ve la foto, no su silueta. */
  previewUrl: string;
  /** La MISMA caja que usará el globo real, medida con `imageBox`. */
  box: { width: number; maxWidth: string; aspectRatio: string };
}) {
  return (
    <div
      className="vb-chat-skel"
      aria-hidden
      style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}
    >
      <div
        style={{
          ...box,
          position: "relative",
          overflow: "hidden",
          // Mismo redondeo que un globo propio: es lo que va a sustituirlo.
          borderRadius: "16px 16px 4px 16px",
        }}
      >
        {/* La foto ya elegida, a su tamaño final. Antes esto era un rectángulo
            gris de 200×150 fijo, así que al llegar el mensaje real la foto
            cambiaba de forma y de sitio de golpe. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        {/* Velo con la misma onda que el resto de skeletons. La foto ya se ve;
            lo único que falta por decir es que todavía va en camino. */}
        <div
          className="vb-skel"
          style={{ position: "absolute", inset: 0, opacity: 0.5 }}
        />
      </div>
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
