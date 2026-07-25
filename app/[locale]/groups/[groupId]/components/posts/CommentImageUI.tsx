"use client";

import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { CommentImage } from "@/lib/posts/types";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

/**
 * UI compartida para la imagen adjunta de comentarios/respuestas:
 * - {@link CommentImageThumb}: miniatura cuadrada con esquinas redondeadas que se
 *   renderiza bajo el texto. Al hacer click abre el lightbox animado desde su
 *   propia posición.
 * - {@link CommentAttachButton}: botón para adjuntar UNA imagen en el composer,
 *   con preview y botón para quitarla antes de enviar.
 * - {@link CommentImageLightbox}: visor a pantalla completa. Anima la imagen
 *   creciendo desde la miniatura (FLIP), muestra la miniatura ya cargada mientras
 *   la original termina de cargar (sin parpadeo), y permite cerrar con swipe hacia
 *   abajo. Deliberadamente NO reutiliza el visor del post (que muestra el contexto
 *   social del post, ajeno a la imagen del comentario).
 */

const ACCEPT = "image/*,.heic,.heif";

export type CommentImageLightboxTarget = {
  image: CommentImage;
  /** Rect de la miniatura de origen, para animar el zoom. */
  rect: DOMRect | null;
};

export function CommentImageThumb({
  image,
  size = 118,
  onOpen,
}: {
  image: CommentImage;
  size?: number;
  onOpen: (image: CommentImage, rect: DOMRect | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(image, ref.current?.getBoundingClientRect() ?? null)}
      aria-label="Ver imagen"
      style={{
        marginTop: 6,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "zoom-in",
        display: "block",
        lineHeight: 0,
      }}
    >
      <span
        style={{
          display: "block",
          position: "relative",
          width: size,
          height: size,
          borderRadius: 12,
          overflow: "hidden",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Image
          src={image.thumbnailUrl}
          alt=""
          fill
          sizes={`${size}px`}
          style={{ objectFit: "cover" }}
        />
      </span>
    </button>
  );
}

export function CommentAttachButton({
  file,
  onSelect,
  onClear,
  disabled,
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    // Permite volver a elegir el mismo archivo después de quitarlo.
    e.target.value = "";
    if (selected) onSelect(selected);
  }

  if (file && previewUrl) {
    return (
      <span
        style={{
          position: "relative",
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.14)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <button
          type="button"
          onClick={onClear}
          aria-label="Quitar imagen"
          disabled={disabled}
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.62)",
            color: "#fff",
            fontSize: 12,
            lineHeight: "16px",
            padding: 0,
            cursor: disabled ? "default" : "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Adjuntar imagen"
        title="Adjuntar imagen"
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.6)",
          cursor: disabled ? "default" : "pointer",
          display: "grid",
          placeItems: "center",
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="4"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
          <path
            d="M21 15l-5-5L5 21"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}

// useLayoutEffect avisa en SSR; el lightbox es solo-cliente, usamos la variante
// isomórfica para evitar el warning y aun así posicionar antes del primer paint.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Rect = { left: number; top: number; width: number; height: number };

function computeContainedRect(natW: number, natH: number): Rect {
  const pad = 16;
  const availW = window.innerWidth - pad * 2;
  const availH = window.innerHeight - pad * 2;
  const ar = natW > 0 && natH > 0 ? natW / natH : 1;
  let w = availW;
  let h = w / ar;
  if (h > availH) {
    h = availH;
    w = h * ar;
  }
  return {
    left: (window.innerWidth - w) / 2,
    top: (window.innerHeight - h) / 2,
    width: w,
    height: h,
  };
}

export function CommentImageLightbox({
  target,
  onClose,
}: {
  target: CommentImageLightboxTarget | null;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const finalRectRef = useRef<Rect | null>(null);
  const closingRef = useRef(false);
  const dragRef = useRef({ startY: 0, dy: 0, active: false });
  const [fullLoaded, setFullLoaded] = useState(false);

  const url = target?.image.url ?? null;

  useEffect(() => {
    setFullLoaded(false);
    closingRef.current = false;
  }, [url]);

  // Bloqueo de scroll del fondo mientras el lightbox está abierto.
  useBodyScrollLock(!!target);

  // Escape para cerrar.
  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") startClose(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Animación de apertura: la caja arranca en el rect de la miniatura y crece
  // hasta su posición/tamaño final (FLIP).
  useIsoLayoutEffect(() => {
    if (!target) return;
    const box = boxRef.current;
    const bd = backdropRef.current;
    if (!box) return;

    const fin = computeContainedRect(
      target.image.width ?? 1,
      target.image.height ?? 1
    );
    finalRectRef.current = fin;
    box.style.left = `${fin.left}px`;
    box.style.top = `${fin.top}px`;
    box.style.width = `${fin.width}px`;
    box.style.height = `${fin.height}px`;
    box.style.transformOrigin = "top left";
    box.style.transition = "none";
    box.style.opacity = "1";

    const src = target.rect;
    if (src) {
      const dx = src.left - fin.left;
      const dy = src.top - fin.top;
      const s = fin.width > 0 ? src.width / fin.width : 0.3;
      box.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      box.style.borderRadius = "12px";
    } else {
      box.style.transform = "scale(0.9)";
      box.style.borderRadius = "8px";
    }
    if (bd) {
      bd.style.transition = "none";
      bd.style.opacity = "0";
    }

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.style.transition =
          "transform 300ms cubic-bezier(0.22,1,0.36,1), border-radius 300ms ease";
        box.style.transform = "translate(0px, 0px) scale(1)";
        box.style.borderRadius = "8px";
        if (bd) {
          bd.style.transition = "opacity 260ms ease";
          bd.style.opacity = "1";
        }
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  function startClose(swipeDown: boolean) {
    if (closingRef.current) return;
    closingRef.current = true;
    const box = boxRef.current;
    const bd = backdropRef.current;
    const fin = finalRectRef.current;
    const src = target?.rect ?? null;

    if (box) {
      if (swipeDown || !src || !fin) {
        // Deslizar hacia abajo y desvanecer.
        box.style.transition = "transform 240ms ease-in, opacity 240ms ease-in";
        box.style.transform = `translateY(${window.innerHeight}px)`;
        box.style.opacity = "0";
      } else {
        // Reverso del zoom: regresa a la miniatura.
        box.style.transformOrigin = "top left";
        box.style.transition =
          "transform 260ms cubic-bezier(0.4,0,0.2,1), border-radius 260ms ease, opacity 260ms ease";
        const dx = src.left - fin.left;
        const dy = src.top - fin.top;
        const s = fin.width > 0 ? src.width / fin.width : 0.3;
        box.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
        box.style.borderRadius = "12px";
      }
    }
    if (bd) {
      bd.style.transition = "opacity 240ms ease";
      bd.style.opacity = "0";
    }
    window.setTimeout(onClose, 250);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (closingRef.current) return;
    const box = boxRef.current;
    if (!box) return;
    box.setPointerCapture?.(e.pointerId);
    dragRef.current = { startY: e.clientY, dy: 0, active: true };
    box.style.transition = "none";
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d.active) return;
    const box = boxRef.current;
    const bd = backdropRef.current;
    let dy = e.clientY - d.startY;
    if (dy < 0) dy = dy * 0.3; // resistencia hacia arriba
    d.dy = dy;
    if (box) box.style.transform = `translateY(${dy}px)`;
    if (bd && dy > 0) {
      const p = Math.min(1, dy / 320);
      bd.style.opacity = String(1 - p * 0.85);
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    if (d.dy > 110) {
      startClose(true);
      return;
    }
    // Snap back.
    const box = boxRef.current;
    const bd = backdropRef.current;
    if (box) {
      box.style.transition = "transform 220ms cubic-bezier(0.22,1,0.36,1)";
      box.style.transform = "translate(0px, 0px) scale(1)";
    }
    if (bd) {
      bd.style.transition = "opacity 220ms ease";
      bd.style.opacity = "1";
    }
    d.dy = 0;
  }

  if (!target || typeof document === "undefined") return null;

  const { image } = target;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={() => startClose(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.92)",
        touchAction: "none",
      }}
    >
      <div
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "fixed",
          overflow: "hidden",
          borderRadius: 8,
          background: "transparent",
          willChange: "transform",
          touchAction: "none",
          cursor: "grab",
        }}
      >
        {/* Miniatura ya cargada: se muestra de inmediato → sin parpadeo negro. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
        {/* Original: aparece encima al terminar de cargar. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt=""
          draggable={false}
          onLoad={() => setFullLoaded(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            opacity: fullLoaded ? 1 : 0,
            transition: "opacity 200ms ease",
          }}
        />
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          startClose(false);
        }}
        aria-label="Cerrar"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          border: "none",
          background: "none",
          color: "#fff",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          padding: 8,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>,
    document.body
  );
}
