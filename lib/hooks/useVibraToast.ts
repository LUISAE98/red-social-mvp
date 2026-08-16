import { useRef, useState } from "react";

export type ToastType = "success" | "error" | "warning";
export type ToastState = { text: string; type: ToastType } | null;

/** Cuánto se queda el aviso en pantalla antes de irse solo. */
export function useVibraToast(duration = 4000) {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(raw: string | null, typeHint?: ToastType) {
    if (!raw) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const text = raw.replace(/^[✅❌⚠️🚫]\s*/, "");
    const type: ToastType =
      typeHint ??
      (raw.startsWith("✅") ? "success" : raw.startsWith("⚠️") ? "warning" : "error");
    setToast({ text, type });
    timerRef.current = setTimeout(() => setToast(null), duration);
  }

  function hideToast() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }

  return { toast, showToast, hideToast };
}
