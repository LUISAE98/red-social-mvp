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
import PanelModal from "@/components/pwa/PanelModal";
import { PRIORIDAD, useTurnoDeAviso } from "@/lib/pwa/turnoDeAvisos";

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

  /**
   * Cede el paso al de instalar.
   *
   * Los dos son modales a pantalla completa: si salieran juntos habría dos
   * velos y dos descartes seguidos. Este no se pierde, vuelve en la siguiente
   * visita — y para entonces la pregunta de instalar ya estará resuelta, que
   * en iPhone es además el requisito para que los avisos funcionen.
   */
  const enTurno = useTurnoDeAviso("notificaciones", PRIORIDAD.notificaciones, show);

  if (!enTurno) return null;

  return (
    <PanelModal
      titulo={t("title")}
      cuerpo={t("body")}
      textoDescartar={t("later")}
      onDescartar={later}
      accion={{
        texto: working ? t("enabling") : t("enable"),
        onClick: () => void activate(),
        ocupado: working,
      }}
      icono={
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5v-1l-1.6-1.6V9a5.4 5.4 0 0 0-4-5.2V3a1.4 1.4 0 0 0-2.8 0v.8A5.4 5.4 0 0 0 6.6 9v5.4L5 16v1Z" />
        </svg>
      }
    />
  );
}
