"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isPushSupported,
  currentPushPermission,
  enablePush,
  disablePush,
  hasLocalPushToken,
  type EnablePushResult,
} from "@/lib/push/fcm";

/**
 * Estado y control del push por dispositivo para el switch de Configuración.
 * `enabled` = soportado + permiso concedido + este dispositivo tiene token local.
 */
export function usePushNotifications(uid: string | null | undefined) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sup = await isPushSupported();
      if (!alive) return;
      setSupported(sup);
      const perm = currentPushPermission();
      setPermission(perm);
      setEnabled(sup && perm === "granted" && hasLocalPushToken());
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  const toggle = useCallback(
    async (next: boolean): Promise<EnablePushResult> => {
      if (!uid || busy) return { ok: false, reason: "no-uid" };
      setBusy(true);
      try {
        if (next) {
          const res = await enablePush(uid);
          setPermission(currentPushPermission());
          if (res.ok) setEnabled(true);
          return res;
        }
        await disablePush(uid);
        setEnabled(false);
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [uid, busy]
  );

  return { supported, enabled, permission, busy, toggle };
}
