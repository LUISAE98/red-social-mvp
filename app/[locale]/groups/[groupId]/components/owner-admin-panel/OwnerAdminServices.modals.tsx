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

import Subscription from "./services/Subscription";
import Greetings from "./services/Greetings";
import Advice from "./services/Advice";
import MeetGreet from "./services/MeetGreet";
import CustomClass from "./services/CustomClass";
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

  const fontStack =
    'inherit';

  return (
    <ModalPortal open={open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-services-confirm-title"
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
            width: "100%",
            maxWidth: 520,
            maxHeight: "min(88dvh, 88vh)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#111",
            boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            padding: 18,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <h3
              id="owner-services-confirm-title"
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

            <div
              style={{
                color: "rgba(255,255,255,0.72)",
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: fontStack,
              }}
            >
              {description}
            </div>
          </div>

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
              disabled={loading}
              style={{
                minWidth: 190,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.92)",
                background: "#fff",
                color: "#000",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 800,
                fontSize: 13,
                fontFamily: fontStack,
                opacity: loading ? 0.75 : 1,
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
                  Procesando...
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

