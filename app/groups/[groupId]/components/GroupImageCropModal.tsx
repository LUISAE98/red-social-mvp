"use client";

import Cropper from "react-easy-crop";
import type { CSSProperties } from "react";

export type GroupCropMode = "avatar" | "cover";

export type GroupCropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type GroupImageCropModalProps = {
  cropOpen: boolean;
  uploading: boolean;
  cropMode: GroupCropMode;
  cropImageSrc: string;
  crop: { x: number; y: number };
  zoom: number;
  cropAspect: number;
  groupPageFontStack: string;
  groupPageUi: {
    modalMaxWidth: number;
    cardBg: string;
    borderSoft: string;
    shadow: string;
  };
  subtitleStyle: CSSProperties;
  labelStyle: CSSProperties;
  primaryButton: CSSProperties;
  secondaryButton: CSSProperties;
  microText: CSSProperties;
  onClose: () => void;
  onCropChange: (value: { x: number; y: number }) => void;
  onZoomChange: (value: number) => void;
  onCropComplete: (_croppedArea: unknown, croppedAreaPixels: unknown) => void;
  onSave: () => void;
};

export default function GroupImageCropModal({
  cropOpen,
  uploading,
  cropMode,
  cropImageSrc,
  crop,
  zoom,
  cropAspect,
  groupPageFontStack,
  groupPageUi,
  subtitleStyle,
  labelStyle,
  primaryButton,
  secondaryButton,
  microText,
  onClose,
  onCropChange,
  onZoomChange,
  onCropComplete,
  onSave,
}: GroupImageCropModalProps) {
  if (!cropOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.72)",
        display: "grid",
        placeItems: "center",
        padding: 14,
        fontFamily: groupPageFontStack,
      }}
      onClick={() => {
        if (!uploading) onClose();
      }}
    >
      <div
        style={{
          width: `min(${groupPageUi.modalMaxWidth}px, 92vw)`,
          background: groupPageUi.cardBg,
          border: groupPageUi.borderSoft,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: groupPageUi.shadow,
          color: "#fff",
          backdropFilter: "blur(10px)",
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
            flexWrap: "wrap",
          }}
        >
          <div style={subtitleStyle}>
            {cropMode === "avatar"
              ? "Recortar avatar de la comunidad"
              : "Recortar portada de la comunidad"}
          </div>

          <button
            type="button"
            onClick={() => !uploading && onClose()}
            style={{
              ...secondaryButton,
              opacity: uploading ? 0.6 : 1,
              cursor: uploading ? "not-allowed" : "pointer",
            }}
          >
            Cerrar
          </button>
        </div>

        <div style={{ padding: 12 }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: cropMode === "avatar" ? 300 : 240,
              background: "#050505",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <Cropper
              image={cropImageSrc}
              crop={crop}
              zoom={zoom}
              aspect={cropAspect}
              onCropChange={onCropChange}
              onZoomChange={onZoomChange}
              onCropComplete={onCropComplete}
              cropShape={cropMode === "avatar" ? "round" : "rect"}
              showGrid={cropMode !== "avatar"}
            />
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
            <label style={labelStyle}>Zoom</label>

            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => onZoomChange(Number(e.target.value))}
              style={{ width: 200 }}
            />

            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => !uploading && onClose()}
                style={{
                  ...secondaryButton,
                  opacity: uploading ? 0.6 : 1,
                  cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={onSave}
                disabled={uploading}
                style={{
                  ...primaryButton,
                  background: uploading ? "rgba(255,255,255,0.15)" : "#fff",
                  color: uploading ? "#fff" : "#000",
                  opacity: uploading ? 0.8 : 1,
                  cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                {uploading ? "Subiendo..." : "Guardar"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, ...microText }}>
            Tip: mueve la imagen para encuadrar.{" "}
            {cropMode === "avatar" ? "Avatar 1:1." : "Portada 16:9."}
          </div>
        </div>
      </div>
    </div>
  );
}