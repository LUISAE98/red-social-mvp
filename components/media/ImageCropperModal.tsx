"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
import { cropImageToBlob } from "@/lib/storage/cropImage";

type Props = {
  open: boolean;
  title: string;
  imageSrc: string | null;
  aspect: number;           // 1 para avatar, 16/9 para cover
  cropShape?: "rect" | "round";
  outputMime?: "image/jpeg" | "image/png" | "image/webp";
  onClose: () => void;
  onConfirm: (blob: Blob) => void;
};

export default function ImageCropperModal({
  open,
  title,
  imageSrc,
  aspect,
  cropShape = "rect",
  outputMime = "image/jpeg",
  onClose,
  onConfirm,
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const canConfirm = useMemo(() => open && !!imageSrc && !!croppedAreaPixels && !busy, [open, imageSrc, croppedAreaPixels, busy]);

  const handleConfirm = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setBusy(true);
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
    } catch (e: any) {
      setErr(e?.message ?? "Error al recortar imagen.");
      setBusy(false);
    }
  }, [imageSrc, croppedAreaPixels, outputMime, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0b0c] shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="text-sm font-semibold text-white/90">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/60 hover:text-white/90 text-sm"
              disabled={busy}
            >
              Cerrar
            </button>
          </div>

          <div className="p-4">
            {err && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {err}
              </div>
            )}

            <div className="relative w-full h-[380px] rounded-xl overflow-hidden border border-white/10 bg-black">
              {imageSrc ? (
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={aspect}
                  cropShape={cropShape}
                  showGrid={cropShape !== "round"}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              ) : (
                <div className="w-full h-full grid place-items-center text-white/50 text-sm">
                  No hay imagen.
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs text-white/60">Zoom</label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full"
                  disabled={busy}
                />
              </div>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                disabled={busy}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirm}
                className="px-4 py-2 rounded-xl bg-white text-black font-semibold hover:opacity-90 disabled:opacity-50"
                disabled={!canConfirm}
              >
                {busy ? "Procesando…" : "Usar esta imagen"}
              </button>
            </div>

            <p className="mt-3 text-xs text-white/50">
              Tip: arrastra para centrar y usa el zoom. El recorte se guarda ya listo para subir.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}