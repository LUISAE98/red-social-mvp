"use client";

// Footer de enlaces legales. Renderiza los documentos de `LEGAL_FOOTER_DOCS`
// como una fila de enlaces; al hacer clic abre `LegalDocPanel` (hoy placeholder,
// contenido real cuando los documentos se validen — ver docs/legal/README.md).
//
// Reutilizable: hoy vive al pie del login; el mismo componente se puede montar
// al pie del rail izquierdo (`OwnerSidebar`) cuando se aborde esa superficie.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LEGAL_FOOTER_DOCS, type LegalDocId } from "./legalDocs";
import LegalDocPanel from "./LegalDocPanel";

export default function LegalLinksFooter() {
  const t = useTranslations("legal");
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);

  return (
    <footer className="legalFooter" aria-label={t("footerAriaLabel")}>
      <style jsx>{`
        .legalFooter {
          width: 100%;
          box-sizing: border-box;
          padding: 22px 16px calc(30px + env(safe-area-inset-bottom));
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 6px 4px;
          background: #000;
        }

        .legalLink {
          appearance: none;
          border: none;
          background: transparent;
          padding: 3px 8px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          line-height: 1.3;
          color: #a855f7;
          cursor: pointer;
          border-radius: 6px;
          transition: color 140ms ease, background 140ms ease;
          white-space: nowrap;
        }
        .legalLink:hover {
          color: #c8a8ff;
          background: rgba(168, 85, 255, 0.1);
        }
        .legalLink:focus-visible {
          outline: 2px solid rgba(168, 85, 255, 0.6);
          outline-offset: 1px;
        }

        .legalSep {
          color: rgba(255, 255, 255, 0.18);
          font-size: 12px;
          user-select: none;
        }
        /* En pantallas angostas los separadores estorban al hacer wrap. */
        @media (max-width: 560px) {
          .legalSep {
            display: none;
          }
        }
      `}</style>

      {LEGAL_FOOTER_DOCS.map((docId, i) => (
        <span key={docId} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className="legalLink"
            onClick={() => setOpenDoc(docId)}
          >
            {t(`docs.${docId}`)}
          </button>
          {i < LEGAL_FOOTER_DOCS.length - 1 && (
            <span className="legalSep" aria-hidden="true">
              ·
            </span>
          )}
        </span>
      ))}

      <LegalDocPanel docId={openDoc} onClose={() => setOpenDoc(null)} />
    </footer>
  );
}
