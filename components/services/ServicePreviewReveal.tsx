"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import ServiceFeaturePreview from "./ServiceFeaturePreview";

/**
 * Envuelve el `ServiceFeaturePreview` (los "items" de un servicio inactivo) para
 * que se DESCUBRAN en vez de mostrarse siempre:
 *  - Laptop: al pasar el cursor por el contenedor del servicio (el panel debe
 *    llevar la clase `serviceActivationPanel`).
 *  - Celular: con un botón "Ver más" en la esquina inferior derecha del panel.
 *
 * Se usa en la activación de experiencias del PERFIL (los grupos no pasan
 * accentColor, así que ni el preview ni este envoltorio se renderizan ahí).
 */
export default function ServicePreviewReveal({
  service,
  accentColor,
  audience,
  durationDescription,
}: {
  service: React.ComponentProps<typeof ServiceFeaturePreview>["service"];
  accentColor: string;
  audience?: "creator" | "user";
  durationDescription?: string;
}) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <>
      <style jsx global>{`
        .serviceActivationPanel {
          position: relative;
        }
        .servicePreviewReveal {
          display: grid;
          grid-template-rows: 0fr;
          opacity: 0;
          transition:
            grid-template-rows 360ms cubic-bezier(0.4, 0, 0.2, 1),
            opacity 300ms ease;
        }
        .servicePreviewReveal > .servicePreviewRevealInner {
          overflow: hidden;
          min-height: 0;
        }
        @media (hover: hover) {
          .serviceActivationPanel:hover .servicePreviewReveal {
            grid-template-rows: 1fr;
            opacity: 1;
          }
        }
        @media (hover: none) {
          .servicePreviewReveal.is-open {
            grid-template-rows: 1fr;
            opacity: 1;
          }
          /* Aire abajo para que el botón no tape el último item al abrir. */
          .servicePreviewReveal.is-open > .servicePreviewRevealInner {
            padding-bottom: 30px;
          }
        }
        .serviceSeeMoreBtn {
          display: none;
        }
        @media (hover: none) {
          /* Sin contenedor: solo el texto, en el color de acento del servicio
             (va inline por accentColor). */
          .serviceSeeMoreBtn {
            position: absolute;
            bottom: 8px;
            inset-inline-end: 10px;
            z-index: 2;
            display: inline-flex;
            align-items: center;
            padding: 4px 2px;
            border: none;
            background: transparent;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: -0.01em;
            font-family: inherit;
            cursor: pointer;
          }
        }
      `}</style>

      <div className={`servicePreviewReveal${open ? " is-open" : ""}`}>
        <div className="servicePreviewRevealInner">
          <ServiceFeaturePreview
            service={service}
            accentColor={accentColor}
            audience={audience}
            durationDescription={durationDescription}
          />
        </div>
      </div>

      <button
        type="button"
        className="serviceSeeMoreBtn"
        style={{ color: accentColor }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? tCommon("seeLess") : tCommon("seeMore")}
      </button>
    </>
  );
}
