"use client";

// Prompt para activar notificaciones push al entrar desde un dispositivo nuevo.
// - Si el permiso nunca se pidió en este dispositivo (`default`), ofrece activar.
// - Si el permiso ya está concedido pero falta el token local (cache limpia /
//   reinstalación de la PWA), re-registra el token en silencio.
// - Una vez que el usuario activa o descarta, no vuelve a molestar en ese
//   dispositivo (bandera en localStorage). Siempre puede activarlo en Configuración.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { usePushNotifications } from "@/lib/hooks/usePushNotifications";
import { hasLocalPushToken } from "@/lib/push/fcm";

const DISMISS_KEY = "vibra:pushPromptDismissed";

export default function PushEnablePrompt() {
  const t = useTranslations("notifPrompt");
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const push = usePushNotifications(uid);

  const [show, setShow] = useState(false);
  const [silentDone, setSilentDone] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!uid || push.supported !== true) {
      setShow(false);
      return;
    }

    // Permiso concedido pero sin token en este dispositivo → re-registra callado.
    if (push.permission === "granted" && !hasLocalPushToken() && !silentDone) {
      setSilentDone(true);
      void push.toggle(true);
      return;
    }

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* localStorage no disponible */
    }
    setShow(push.permission === "default" && !dismissed && !push.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, push.supported, push.permission, push.enabled, silentDone]);

  function remember() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function activate() {
    if (working) return;
    setWorking(true);
    try {
      await push.toggle(true);
    } finally {
      setWorking(false);
    }
    remember();
    setShow(false);
  }

  function later() {
    remember();
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(86px + var(--vb-safe-bottom, 0px))",
        zIndex: 150,
        width: "min(420px, calc(100vw - 24px))",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 14,
        border: "1px solid rgba(168,85,255,0.45)",
        background: "rgba(14,10,28,0.96)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
        color: "#fff",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            width: 36,
            height: 36,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "rgba(168,85,255,0.16)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" style={{ display: "block" }}>
            <path
              fill="#a855f7"
              d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5v-1l-1.6-1.6V9a5.4 5.4 0 0 0-4-5.2V3a1.4 1.4 0 0 0-2.8 0v.8A5.4 5.4 0 0 0 6.6 9v5.4L5 16v1Z"
            />
          </svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{t("title")}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.35, marginTop: 2 }}>
            {t("body")}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={later}
          disabled={working}
          style={{
            padding: "8px 14px",
            borderRadius: 9,
            border: "none",
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.8)",
            fontSize: 13,
            fontWeight: 600,
            cursor: working ? "not-allowed" : "pointer",
          }}
        >
          {t("later")}
        </button>
        <button
          type="button"
          onClick={activate}
          disabled={working}
          style={{
            padding: "8px 16px",
            borderRadius: 9,
            border: "none",
            background: "linear-gradient(100deg, #a855f7, #4f46ff)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: working ? "not-allowed" : "pointer",
            opacity: working ? 0.8 : 1,
          }}
        >
          {working ? t("enabling") : t("enable")}
        </button>
      </div>
    </div>
  );
}
