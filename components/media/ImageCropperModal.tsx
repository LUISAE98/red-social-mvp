"use client";

// Modal de recorte reutilizable. Recibe una imagen, deja recortarla con
// SafeCropper (mismo motor que el perfil) y devuelve un Blob por onConfirm; NO
// sube nada — de la subida se encarga quien lo monta. El estilo sigue el
// "Panel base (modal/overlay)" canónico de vibra_style.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconButton } from "@/components/ui";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import SafeCropper from "@/components/media/SafeCropper";
import { cropImageToBlob } from "@/lib/storage/cropImage";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type CropArea = { x: number; y: number; width: number; height: number };

type Props = {
  open: boolean;
  title: string;
  hint?: string;
  imageSrc: string | null;
  aspect: number; // 1 para avatar, 16/9 para portada
  cropShape?: "rect" | "round";
  outputMime?: "image/jpeg" | "image/png" | "image/webp";
  /** El padre está subiendo el resultado: deshabilita los controles. */
  busy?: boolean;
  onClose: () => void;
  onConfirm: (blob: Blob) => void;
};

export default function ImageCropperModal({
  open,
  title,
  hint,
  imageSrc,
  aspect,
  cropShape = "rect",
  outputMime = "image/jpeg",
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const tCommon = useTranslations("common");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropArea | null>(null);
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (err) showToast(err, "error"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps
  // Montaje en cliente: createPortal necesita document (evita desajuste SSR).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useBodyScrollLock(open);

  // Reset al cerrar.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setProcessing(false);
      setErr(null);
    }
  }, [open]);

  const onCropComplete = useCallback((_area: CropArea, areaPixels: CropArea) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const disabled = busy || processing;
  const canConfirm = useMemo(
    () => open && !!imageSrc && !!croppedAreaPixels && !disabled,
    [open, imageSrc, croppedAreaPixels, disabled]
  );

  const handleConfirm = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setProcessing(true);
    setErr(null);
    try {
      const blob = await cropImageToBlob(
        imageSrc,
        {
          x: croppedAreaPixels.x,
          y: croppedAreaPixels.y,
          width: croppedAreaPixels.width,
          height: croppedAreaPixels.height,
        },
        outputMime
      );
      onConfirm(blob);
    } catch (e: unknown) {
      setErr((e instanceof Error ? e.message : null) ?? tCommon("cropError"));
    } finally {
      setProcessing(false);
    }
  }, [imageSrc, croppedAreaPixels, outputMime, onConfirm]);

  if (!open || !mounted) return null;

  const primaryButtonStyle: React.CSSProperties = canConfirm
    ? {
        width: "100%",
        height: 42,
        borderRadius: 5,
        border: "none",
        background: "#a855ff",
        color: "rgba(255,255,255,0.98)",
        fontSize: 17,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        letterSpacing: "-0.02em",
        display: "grid",
        placeItems: "center",
      }
    : {
        width: "100%",
        height: 42,
        borderRadius: 5,
        border: "none",
        background: "rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.36)",
        fontSize: 17,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "not-allowed",
        letterSpacing: "-0.02em",
        display: "grid",
        placeItems: "center",
      };

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !disabled) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(0,0,0,0.88)",
        fontFamily: "inherit",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes vibraComposerDesktopIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);     }
        }
        /* Slider de zoom fino (track delgado + thumb pequeño). */
        .vibra-crop-zoom {
          -webkit-appearance: none;
          appearance: none;
          height: 14px;
          background: transparent;
          cursor: pointer;
        }
        .vibra-crop-zoom::-webkit-slider-runnable-track {
          height: 3px;
          border-radius: 999px;
          background: rgba(255,255,255,0.2);
        }
        .vibra-crop-zoom::-moz-range-track {
          height: 3px;
          border-radius: 999px;
          background: rgba(255,255,255,0.2);
        }
        .vibra-crop-zoom::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 13px;
          height: 13px;
          margin-top: -5px;
          border-radius: 50%;
          background: #a855ff;
          border: none;
        }
        .vibra-crop-zoom::-moz-range-thumb {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #a855ff;
          border: none;
        }
        .vibra-crop-zoom:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

      <section
        style={{
          width: "min(100%, 540px)",
          maxHeight: "min(88vh, 680px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff",
          overflow: "hidden",
          animation: "vibraComposerDesktopIn 180ms ease-out",
        }}
      >
        {/* Header: [vacío | título centrado | cerrar] */}
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
          <IconButton label={tCommon("close")} size="sm" tone="bare" shape="square" style={{ placeItems: "center", justifySelf: "end" }} onClick={() => !disabled && onClose()}>
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
          </IconButton>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 8px" }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: cropShape === "round" ? 320 : 260,
              background: "#050505",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            {imageSrc ? (
              <SafeCropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                cropShape={cropShape}
                showGrid={cropShape !== "round"}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                rotation={0}
                minZoom={1}
                maxZoom={3}
                zoomSpeed={1}
              />
            ) : null}
          </div>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
              {tCommon("zoom")}
            </label>
            <input
              className="vibra-crop-zoom"
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ flex: 1 }}
              disabled={disabled}
            />
          </div>

          {hint && (
            <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>
              {hint}
            </div>
          )}
        </div>

        {/* Footer: botón primario (Guardar) */}
        <div
          style={{
            padding: "14px 20px 18px",
            borderTop: "1px solid rgba(255,255,255,0.12)",
            flexShrink: 0,
          }}
        >
          <button type="button" onClick={handleConfirm} disabled={!canConfirm} style={primaryButtonStyle}>
            {busy ? tCommon("uploading") : tCommon("save")}
          </button>
        </div>
      </section>
      <VibraToast toast={toast} />
    </div>,
    document.body
  );
}
