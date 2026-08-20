"use client";

// La fila de muestras ya grabadas, en formato de avatar.
//
// Se usa en dos sitios distintos, el panel de configurar el servicio y la card
// de experiencias, así que vive aparte en vez de duplicarse en los dos.

import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  MAX_GREETING_SAMPLES,
  sampleThumbnail,
  type GreetingSample,
} from "@/lib/greetings/useGreetingSamples";

export default function SampleAvatars({
  samples,
  size = 56,
  onAdd,
  showHint = false,
  hintStyle,
}: {
  samples: GreetingSample[];
  size?: number;
  /** Sin esto no se pinta el "+", así que la fila queda de solo lectura. */
  onAdd?: () => void;
  showHint?: boolean;
  hintStyle?: React.CSSProperties;
}) {
  const tServices = useTranslations("services");
  const canAdd = !!onAdd && samples.length < MAX_GREETING_SAMPLES;

  if (samples.length === 0 && !canAdd) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        {samples.map((s) => {
          const thumb = sampleThumbnail(s);
          return (
            <div
              key={s.id}
              title={s.context ?? undefined}
              style={{
                width: size, height: size, borderRadius: "50%",
                overflow: "hidden", position: "relative", flexShrink: 0,
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.12)",
                display: "grid", placeItems: "center",
              }}
            >
              {thumb ? (
                <Image src={thumb} alt="" fill sizes={`${size}px`} style={{ objectFit: "cover" }} />
              ) : (
                // Mux todavía está procesando: no hay fotograma que enseñar, así
                // que se marca el hueco en vez de dejar un círculo vacío.
                <span
                  aria-hidden="true"
                  style={{
                    width: 16, height: 16, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.25)",
                    borderTopColor: "rgba(255,255,255,0.7)",
                    animation: "vibraSampleSpin 900ms linear infinite",
                  }}
                />
              )}
            </div>
          );
        })}

        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={tServices("addSampleAriaLabel")}
            title={tServices("addSampleAriaLabel")}
            style={{
              width: size, height: size, borderRadius: "50%",
              border: "none", background: "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.72)",
              fontSize: Math.round(size * 0.5), fontWeight: 300, lineHeight: 1,
              display: "grid", placeItems: "center", cursor: "pointer",
              fontFamily: "inherit", flexShrink: 0,
              WebkitTapHighlightColor: "transparent",
              transition: "background 160ms ease",
            }}
          >
            +
          </button>
        )}
      </div>

      {showHint && canAdd && (
        <span style={{ ...hintStyle, fontSize: 11.5, textAlign: "center", maxWidth: 260 }}>
          {tServices("addSampleHint")}
        </span>
      )}

      <style>{`
        @keyframes vibraSampleSpin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
