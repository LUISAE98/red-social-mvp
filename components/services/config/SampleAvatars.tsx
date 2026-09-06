"use client";

// La fila de muestras ya grabadas, en formato de avatar.
//
// Se usa en dos sitios distintos, el panel de configurar el servicio y la card
// de experiencias, así que vive aparte en vez de duplicarse en los dos. Solo el
// panel de configurar deja borrar; la card es de consulta.

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ConfirmPanel from "@/components/ui/ConfirmPanel";
import { deleteGreetingSample } from "@/lib/greetings/greetingSamples";
import { deleteStory } from "@/lib/stories/storyService";
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
  accentColor,
  deletable = false,
  overlap = false,
}: {
  samples: GreetingSample[];
  size?: number;
  /** Sin esto no se pinta el "+", así que la fila queda de solo lectura. */
  onAdd?: () => void;
  showHint?: boolean;
  hintStyle?: React.CSSProperties;
  /** Color del servicio, el mismo que usa su tarjeta. */
  accentColor?: string;
  deletable?: boolean;
  /**
   * Solapadas, como un grupo de avatares. Ocupan mucho menos y siguen leyéndose
   * como un conjunto. Cada una lleva el separador oscuro de los círculos de
   * historias, que es lo que las despega de la de atrás.
   */
  overlap?: boolean;
}) {
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const canAdd = !!onAdd && samples.length < MAX_GREETING_SAMPLES;

  const [pendingDelete, setPendingDelete] = useState<GreetingSample | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await deleteGreetingSample({ sampleId: target.id });
      // La historia se creó desde el cliente colgada del id de la muestra, así
      // que se retira por el mismo sitio. Si no existe todavía —Mux aún estaba
      // procesando— no hay nada que borrar y la consulta sale vacía.
      const snap = await getDocs(
        query(collection(db, "stories"), where("greetingRequestId", "==", target.id)),
      );
      await Promise.all(snap.docs.map((d) => deleteStory(d.id)));
    } catch (err) {
      console.error("[SampleAvatars] delete", err);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  if (samples.length === 0 && !canAdd) return null;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%" }}>
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: overlap ? "flex-start" : "center",
          gap: overlap ? 0 : 12,
        }}>
          {samples.map((s, i) => {
            const thumb = sampleThumbnail(s);
            return (
              <div
                key={s.id}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                  marginInlineStart: overlap && i > 0 ? -Math.round(size * 0.34) : 0,
                }}
              >
                <div
                  title={s.context ?? undefined}
                  style={{
                    width: size, height: size, borderRadius: "50%",
                    overflow: "hidden", position: "relative", flexShrink: 0,
                    background: "rgba(255,255,255,0.07)",
                    display: "grid", placeItems: "center",
                    // El mismo separador oscuro que usan los círculos de
                    // historias para despegarse de lo que tienen detrás.
                    border: overlap ? "2px solid rgb(10,10,14)" : "none",
                    boxSizing: "border-box",
                  }}
                >
                  {thumb ? (
                    <Image src={thumb} alt="" fill sizes={`${size}px`} style={{ objectFit: "cover" }} />
                  ) : (
                    // Mux todavía está procesando: no hay fotograma que enseñar,
                    // así que se marca el hueco en vez de dejar un círculo vacío.
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

                {deletable && (
                  // Mismo formato que "Ver todos" del menú lateral: texto plano,
                  // 12 en peso 600, con el color del servicio.
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={() => setPendingDelete(s)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      setPendingDelete(s);
                    }}
                    style={{
                      flexShrink: 0,
                      color: accentColor ?? "#a855f7",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    {tServices("deleteSample")}
                  </span>
                )}
              </div>
            );
          })}

          {canAdd && (
            <button className="vibra-pop"
              type="button"
              onClick={onAdd}
              aria-label={tServices("addSampleAriaLabel")}
              title={tServices("addSampleAriaLabel")}
              style={{
                width: size, height: size, borderRadius: "50%",
                border: "none", background: "rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.72)",
                padding: 0, lineHeight: 0,
                display: "grid", placeItems: "center", cursor: "pointer",
                fontFamily: "inherit", flexShrink: 0,
                WebkitTapHighlightColor: "transparent",
                transition: "background 160ms ease",
              }}
            >
              <svg
                width={Math.round(size * 0.38)} height={Math.round(size * 0.38)}
                viewBox="0 0 24 24" fill="none" aria-hidden="true"
              >
                <path
                  d="M12 5V19M5 12H19"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        {showHint && canAdd && (
          <span style={{ ...hintStyle, fontSize: 11.5, textAlign: "center", maxWidth: "100%" }}>
            {tServices("addSampleHint")}
          </span>
        )}

        <style>{`
          @keyframes vibraSampleSpin { to { transform: rotate(360deg); } }
        `}</style>
      </div>

      <ConfirmPanel
        open={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => { void confirmDelete(); }}
        title={tServices("confirmDeleteSampleTitle")}
        body={tServices("confirmDeleteSampleBody")}
        confirmLabel={tServices("deleteSample")}
        cancelLabel={tCommon("cancel")}
        tone="danger"
        busy={deleting}
        zIndexBase={1000030}
      />
    </>
  );
}
