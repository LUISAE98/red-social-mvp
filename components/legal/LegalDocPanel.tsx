"use client";

// Panel de un documento legal. HOY es un placeholder: muestra el título del
// documento y un aviso de "en preparación", porque los documentos siguen en
// revisión legal (ver docs/legal/README.md). El cableado (qué documento abre
// cada enlace) ya queda correcto; cuando exista el contenido real solo se
// reemplaza el cuerpo de este panel por el markdown renderizado del documento.

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import type { LegalDocId } from "./legalDocs";

export default function LegalDocPanel({
  docId,
  onClose,
}: {
  /** Documento a mostrar, o null si el panel está cerrado. */
  docId: LegalDocId | null;
  onClose: () => void;
}) {
  const t = useTranslations("legal");
  const open = docId !== null;

  useBodyScrollLock(open);

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !docId) return null;

  return (
    <div
      className="legalPanelOverlay"
      role="dialog"
      aria-modal="true"
      aria-label={t(`docs.${docId}`)}
      onClick={onClose}
    >
      <style jsx>{`
        .legalPanelOverlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: calc(16px + env(safe-area-inset-top)) 16px
            calc(16px + var(--vb-safe-bottom, 0px));
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          animation: legalOverlayIn 180ms ease;
        }

        .legalPanelCard {
          position: relative;
          width: 100%;
          max-width: 460px;
          box-sizing: border-box;
          padding: 26px 24px 22px;
          border-radius: 18px;
          border: 1px solid rgba(168, 85, 255, 0.22);
          background: linear-gradient(180deg, #14101f 0%, #0a0710 100%);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
          text-align: center;
          animation: legalCardIn 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .legalPanelClose {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          transition: background 140ms ease, color 140ms ease;
        }
        .legalPanelClose:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
        }

        .legalPanelDocTitle {
          margin: 4px 0 14px;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #fff;
        }

        .legalPanelBadge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 12px;
          padding: 5px 11px;
          border-radius: 999px;
          border: 1px solid rgba(168, 85, 255, 0.28);
          background: rgba(168, 85, 255, 0.08);
          font-size: 11.5px;
          font-weight: 600;
          color: #c8a8ff;
        }

        .legalPanelBody {
          margin: 0;
          font-size: 13.5px;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.7);
        }

        @keyframes legalOverlayIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes legalCardIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .legalPanelOverlay,
          .legalPanelCard {
            animation: none;
          }
        }
      `}</style>

      {/* El clic dentro de la tarjeta no debe cerrar el panel. */}
      <div className="legalPanelCard" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="legalPanelClose"
          aria-label={t("close")}
          onClick={onClose}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <span className="legalPanelBadge">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {t("inProgressTitle")}
        </span>

        <h2 className="legalPanelDocTitle">{t(`docs.${docId}`)}</h2>
        <p className="legalPanelBody">{t("inProgressBody")}</p>
      </div>
    </div>
  );
}
