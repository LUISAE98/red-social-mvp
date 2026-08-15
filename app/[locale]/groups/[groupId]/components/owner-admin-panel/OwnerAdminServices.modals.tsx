"use client";

// Hooks y modales (ModalPortal, ConfirmModal, OverlayModal) de OwnerAdminServices.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildNormalizedGroupCommerceState } from "@/lib/groups/groupServiceCatalog";
import {
  applyGroupSubscriptionTransition,
  removeLegacyFreeMembersAfterSubscriptionTransition,
} from "@/lib/groups/subscriptionTransitions";
import type {
  Currency,
  GroupOffering,
  CreatorServiceType,
  GroupDonationSettings,
  DonationMode,
  CreatorServiceMeta,
  CustomClassWeeklyAvailability,
} from "@/types/group";

import Subscription from "@/components/services/config/Subscription";
import Greetings from "@/components/services/config/Greetings";
import Advice from "@/components/services/config/Advice";
import MeetGreet from "@/components/services/config/MeetGreet";
import CustomClass from "@/components/services/config/CustomClass";
import { SpinningGear } from "./OwnerAdminServices.parts";

export const useLockBodyScroll = useBodyScrollLock;

export function useCloseOnEscape(active: boolean, onClose: () => void, disabled = false) {
  useEffect(() => {
    if (!active || disabled || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose, disabled]);
}

export function ModalPortal({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(children, document.body);
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel: cancelLabelProp,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tCommon = useTranslations("common");
  const cancelLabel = cancelLabelProp ?? tCommon("cancel");
  useLockBodyScroll(open);
  useCloseOnEscape(open, onCancel, loading);

  if (!open) return null;

  // Panel base canónico de vibra_style.md: backdrop 0.88, contenedor #0a0a0a r18,
  // header de 56 px con título centrado + X, contenido con scroll y footer con el
  // botón primario. Centrado TAMBIÉN en celular (es panel, no pestaña).
  return (
    <ModalPortal open={open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-services-confirm-title"
        onMouseDown={(e) => {
          if (loading) return;
          if (e.target === e.currentTarget) onCancel();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding:
            "max(24px, env(safe-area-inset-top)) 24px max(24px, var(--vb-safe-bottom, 0px))",
          background: "rgba(0,0,0,0.88)",
          fontFamily: "inherit",
          overscrollBehavior: "contain",
          animation: "vibraConfirmBackdropIn 180ms ease-out",
        }}
      >
        <style>{`
          @keyframes vibraConfirmPanelIn {
            from { opacity: 0; transform: scale(0.94) translateY(10px); }
            to   { opacity: 1; transform: scale(1)    translateY(0);     }
          }
          @keyframes vibraConfirmBackdropIn {
            from { background: rgba(0,0,0,0); }
            to   { background: rgba(0,0,0,0.88); }
          }
        `}</style>

        <section
          style={{
            width: "min(100%, 540px)",
            maxHeight: "min(88dvh, 680px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: 18,
            background: "#0a0a0a",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
            color: "#fff",
            overflow: "hidden",
            animation: "vibraConfirmPanelIn 180ms ease-out",
          }}
        >
          {/* Header: [vacío | título centrado | X] */}
          <div
            style={{
              height: 56,
              display: "grid",
              gridTemplateColumns: "48px 1fr 48px",
              alignItems: "center",
              padding: "0 12px",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              flexShrink: 0,
            }}
          >
            <div aria-hidden="true" />

            <span
              id="owner-services-confirm-title"
              style={{
                fontSize: 17,
                fontWeight: 500,
                color: "#fff",
                lineHeight: 1.2,
                textAlign: "center",
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </span>

            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              aria-label={cancelLabel}
              style={{
                border: "none",
                background: "none",
                color: "#fff",
                cursor: loading ? "default" : "pointer",
                display: "grid",
                placeItems: "center",
                justifySelf: "end",
                padding: 4,
                opacity: loading ? 0.5 : 1,
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Contenido con scroll */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              WebkitOverflowScrolling: "touch",
              padding: "18px 20px 8px",
              color: "rgba(255,255,255,0.72)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>

          {/* Footer: botón primario a ancho completo. */}
          <div
            style={{
              flexShrink: 0,
              padding: "14px 20px 18px",
              borderTop: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              style={{
                width: "100%",
                height: 42,
                borderRadius: 5,
                border: "none",
                background: loading ? "rgba(255,255,255,0.1)" : "#a855f7",
                color: loading ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
                fontSize: 17,
                fontWeight: 500,
                fontFamily: "inherit",
                letterSpacing: "-0.02em",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {loading ? (
                <>
                  <SpinningGear />
                  Procesando...
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}

export function OverlayModal({
  open,
  title,
  children,
  confirmLabel = "Guardar cambios",
  cancelLabel: cancelLabelProp,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tCommon = useTranslations("common");
  const cancelLabel = cancelLabelProp ?? tCommon("cancel");
  useLockBodyScroll(open);
  useCloseOnEscape(open, onCancel, loading);

  if (!open) return null;

  const fontStack =
    'inherit';

  return (
    <ModalPortal open={open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-services-overlay-title"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999999,
          background: "rgba(0,0,0,0.72)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding:
            "max(16px, env(safe-area-inset-top)) 16px max(16px, var(--vb-safe-bottom, 0px))",
          overscrollBehavior: "contain",
        }}
        onClick={loading ? undefined : onCancel}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(100%, 640px)",
            maxWidth: 640,
            maxHeight: "min(88dvh, 88vh)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            borderRadius: 22,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#111",
            boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            padding: 18,
            display: "grid",
            gap: 14,
          }}
        >
          <h3
            id="owner-services-overlay-title"
            style={{
              margin: 0,
              color: "#fff",
              fontSize: 18,
              lineHeight: 1.2,
              fontWeight: 800,
              fontFamily: fontStack,
            }}
          >
            {title}
          </h3>

          <div style={{ display: "grid", gap: 12 }}>{children}</div>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              style={{
                minWidth: 120,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 13,
                fontFamily: fontStack,
                opacity: loading ? 0.6 : 1,
                flex: "1 1 160px",
              }}
            >
              {cancelLabel}
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={loading || confirmDisabled}
              style={{
                minWidth: 180,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.92)",
                background: "#fff",
                color: "#000",
                cursor: loading || confirmDisabled ? "not-allowed" : "pointer",
                fontWeight: 800,
                fontSize: 13,
                fontFamily: fontStack,
                opacity: loading || confirmDisabled ? 0.75 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                flex: "1 1 220px",
              }}
            >
              {loading ? (
                <>
                  <SpinningGear />
                  Guardando...
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

