"use client";

// Modal de recorte reutilizable. Recibe una imagen, deja recortarla con
// SafeCropper (mismo motor que el perfil) y devuelve un Blob por onConfirm; NO
// sube nada — de la subida se encarga quien lo monta (así el registro puede
// recortar antes de que exista la cuenta y subir después). El look replica el
// modal de recorte del perfil (inline, tema Vibra), sin introducir estilos nuevos.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import SafeCropper from "@/components/media/SafeCropper";
import { cropImageToBlob } from "@/lib/storage/cropImage";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

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
      setErr((e instanceof Error ? e.message : null) ?? "Error al recortar la imagen.");
    } finally {
      setProcessing(false);
    }
  }, [imageSrc, croppedAreaPixels, outputMime, onConfirm]);

  if (!open) return null;

  const buttonSecondary: React.CSSProperties = {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "transparent",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };

  const buttonPrimary: React.CSSProperties = {
    padding: "8px 14px",
    borderRadius: 10,
    border: "none",
    background: disabled ? "rgba(255,255,255,0.15)" : "#fff",
    color: disabled ? "#fff" : "#000",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: canConfirm ? "pointer" : "not-allowed",
    opacity: canConfirm ? 1 : 0.8,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.72)",
        display: "grid",
        placeItems: "center",
        paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
        paddingBottom: 14,
        paddingLeft: 14,
        paddingRight: 14,
        fontFamily: "inherit",
      }}
      onClick={() => {
        if (!disabled) onClose();
      }}
    >
      <div
        style={{
          width: "min(560px, 92vw)",
          background: "#0f0b18",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
          color: "#fff",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
            {title}
          </div>
          <button type="button" onClick={() => !disabled && onClose()} style={buttonSecondary}>
            {tCommon("close")}
          </button>
        </div>

        <div style={{ padding: 12 }}>
          {err && (
            <div
              style={{
                marginBottom: 12,
                borderRadius: 9,
                border: "1px solid rgba(255, 80, 80, 0.45)",
                background: "rgba(255, 40, 40, 0.10)",
                padding: "7px 9px",
                fontSize: 11,
                color: "rgba(255, 190, 190, 0.95)",
              }}
            >
              {err}
            </div>
          )}

          <div
            style={{
              position: "relative",
              width: "100%",
              height: cropShape === "round" ? 300 : 240,
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

          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
              {tCommon("zoom")}
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: 200 }}
              disabled={disabled}
            />

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => !disabled && onClose()} style={buttonSecondary}>
                {tCommon("cancel")}
              </button>
              <button type="button" onClick={handleConfirm} disabled={!canConfirm} style={buttonPrimary}>
                {busy ? tCommon("uploading") : tCommon("save")}
              </button>
            </div>
          </div>

          {hint && (
            <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>
              {hint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
