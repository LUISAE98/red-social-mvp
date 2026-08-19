"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { mensajeSeguro } from "@/lib/errors/mensajeSeguro";

export type ToastType = "success" | "error" | "warning";
export type ToastState = { text: string; type: ToastType } | null;

/** Cuánto se queda el aviso en pantalla antes de irse solo. */
export function useVibraToast(duration = 4000) {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tCf = useTranslations("cf");

  function showToast(raw: string | null, typeHint?: ToastType) {
    if (!raw) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const limpio = raw.replace(/^[✅❌⚠️🚫]\s*/, "");
    const type: ToastType =
      typeHint ??
      (raw.startsWith("✅") ? "success" : raw.startsWith("⚠️") ? "warning" : "error");

    /**
     * Último filtro antes de la pantalla: los `catch` del producto pasan
     * `e.message` tal cual, y el del SDK de Firestore es un volcado con traza y
     * URL. Aquí se corta, que es el único punto por el que pasan todos los
     * avisos. Solo aplica a los errores: un acierto nunca trae eso.
     */
    const text = type === "error" ? mensajeSeguro(limpio, tCf("internalError")) : limpio;

    setToast({ text, type });
    timerRef.current = setTimeout(() => setToast(null), duration);
  }

  function hideToast() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }

  return { toast, showToast, hideToast };
}
