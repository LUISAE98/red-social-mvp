"use client";

// Tipos, helpers y sub-componentes (SpinningGear, Switch) de ProfileSettingsTab.

import { CSSProperties, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import LogoutButton from "@/app/LogoutButton";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import BlockedAccountsOverlay from "./BlockedAccountsOverlay";
import SessionsOverlay from "./SessionsOverlay";
import { usePushNotifications } from "@/lib/hooks/usePushNotifications";

// Cooldown de cliente para el correo de cambio de contraseña. Firebase ya tiene
// su propio throttling server-side, pero además bloqueamos el reenvío 60s desde
// el cliente (persistido en localStorage para que sobreviva recargas).
export const PWD_RESET_COOLDOWN_S = 60;

export function pwdResetKey(id: string | null | undefined) {
  return `vibra:pwdResetSentAt:${id || "anon"}`;
}

export type ProfileSettingsTabProps = {
  isSaving?: boolean;
  isRestricted: boolean;
  onToggleRestricted: (nextValue: boolean) => Promise<void> | void;

  commentsEnabled?: boolean;
  onToggleCommentsEnabled?: (nextValue: boolean) => Promise<void> | void;
  isSavingComments?: boolean;

  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
  username?: string | null;
  birthDate?: string | Date | null;
  appCreatedAt?: string | Date | null;
  displayNameLastChangedAt?: string | Date | null;

  onUpdateDisplayName?: (nextName: string) => Promise<void> | void;
  bio?: string | null;
  onUpdateBio?: (nextBio: string) => Promise<void> | void;
  onSendPasswordReset?: () => Promise<void> | void;
};

export function formatDate(value?: string | Date | null, locale?: string): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(locale ?? "es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function daysUntilNameChange(value?: string | Date | null) {
  if (!value) return 0;

  const last = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(last.getTime())) return 0;

  const nextAllowed = last.getTime() + 60 * 24 * 60 * 60 * 1000;
  const diff = nextAllowed - Date.now();

  if (diff <= 0) return 0;

  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes profileSettingsGearSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          animation: "profileSettingsGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
        }}
      >
        ⚙
      </span>
    </>
  );
}


export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  activeColor,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
      title={label}
      style={{
        position: "relative",
        width: 36,
        minWidth: 36,
        maxWidth: 36,
        height: 20,
        minHeight: 20,
        maxHeight: 20,
        borderRadius: 999,
        border: "none",
        background: checked
          ? (activeColor ?? "linear-gradient(100deg, #a855f7, #4f46ff)")
          : "rgba(255,255,255,0.10)",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.2s ease",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "all 0.2s ease",
        }}
      />
    </button>
  );
}

