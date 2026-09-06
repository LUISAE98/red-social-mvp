"use client";

import Image from "next/image";
import { IconButton } from "@/components/ui";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import type { CommentImage } from "@/lib/posts/types";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import PostPinchZoomImage from "./PostPinchZoomImage";

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

/**
 * Salida del visor, calcada del de publicaciones (PostImageViewer): la imagen se
 * desliza hacia abajo encogiendo un poco mientras TODO se transparenta, y el
 * feed de detrás va asomando. Los números son los mismos a propósito — si se
 * tocan allí, tocarlos aquí.
 */
const CLOSE_MS = 240;
const CLOSE_EASE = "ease-in";
/** Recorrido del dedo, en px, que apaga del todo el velo. */
const DRAG_FADE_PX = 320;
/** A partir de aquí, soltar cierra. */
const DRAG_CLOSE_PX = 120;

/** Cuánto se encoge la caja según lo que lleve bajado. Tope del 8%, como allí. */
function escalaDeArrastre(dy: number): number {
  const alto = typeof window === "undefined" ? 800 : window.innerHeight;
  return 1 - Math.min(0.08, (Math.max(0, dy) / Math.max(1, alto)) * 0.12);
}

/** Opacidad del conjunto según lo que lleve bajado. */
function opacidadDeArrastre(dy: number): number {
  return 1 - Math.min(1, Math.max(0, dy) / DRAG_FADE_PX) * 0.85;
}

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
    // El tamaño va en `style` a propósito: `size="sm"` fija 32×32 en el propio
    // IconButton, y la miniatura mide 118. Sin esto el botón quedaba en 32px con
    // la imagen desbordando, que es como se veía rota. `style` se esparce al
    // final dentro del componente, así que gana sobre su tamaño de tono.
    <IconButton
      label="Ver imagen"
      size="sm"
      tone="bare"
      shape="square"
      style={{
        marginTop: 6,
        width: size,
        height: size,
        minWidth: size,
        padding: 0,
        borderRadius: 12,
        overflow: "hidden",
      }}
      ref={ref}
      onClick={() => onOpen(image, ref.current?.getBoundingClientRect() ?? null)}
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
    </IconButton>
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
            insetInlineEnd: 1,
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
      <IconButton label="Adjuntar imagen" size="sm" tone="bare" style={{ placeItems: "center" }} onClick={() => inputRef.current?.click()} disabled={disabled}>
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
      </IconButton>
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
  // Con zoom puesto, el arrastre es para pasear la imagen: no cierra. Va en ref
  // y no en estado porque lo leen los manejadores del gesto, no el render.
  const zoomedRef = useRef(false);

  const url = target?.image.url ?? null;

  /**
   * El original se precarga aparte en vez de montarse directamente.
   *
   * Así se puede seguir enseñando la miniatura (que ya está en caché) sin un
   * parpadeo negro, y el visor con zoom se monta solo cuando la imagen grande ya
   * está lista — al montarse, sale del caché del navegador y aparece al instante.
   */
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const fullLoaded = !!url && loadedUrl === url;

  useEffect(() => {
    if (!url) return;
    // `window.Image` y no `Image` a secas: en este archivo ese nombre es el
    // componente de `next/image`, que lo tapa.
    const preload = new window.Image();
    // Un error también cuenta como "ya no esperamos más": mejor intentar
    // pintarla y que falle a la vista que dejar el visor colgado en la miniatura.
    preload.onload = () => setLoadedUrl(url);
    preload.onerror = () => setLoadedUrl(url);
    preload.src = url;
    return () => {
      preload.onload = null;
      preload.onerror = null;
    };
  }, [url]);

  useEffect(() => {
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
      bd.style.transition = `opacity ${CLOSE_MS}ms ${CLOSE_EASE}`;
      bd.style.opacity = "0";
    }
    window.setTimeout(onClose, CLOSE_MS + 10);
  }

  /**
   * Arrastrar hacia abajo para cerrar.
   *
   * Lo gobierna ESTE componente, con ratón y con el dedo, igual que hace el
   * visor de publicaciones con su contenedor. Antes el táctil lo llevaba
   * `PostPinchZoomImage`, que solo mueve la imagen por dentro: la caja no
   * encogía y el velo no se aclaraba, así que en celular el gesto se sentía
   * distinto al del visor de publicaciones. Al pinch se le deja el pellizco y el
   * paseo con zoom, que es lo suyo, con `swipeAxis="horizontal"`.
   */
  function empezarArrastre(clientY: number) {
    if (closingRef.current || zoomedRef.current) return false;
    const box = boxRef.current;
    if (!box) return false;
    dragRef.current = { startY: clientY, dy: 0, active: true };
    box.style.transition = "none";
    return true;
  }

  function moverArrastre(clientY: number) {
    const d = dragRef.current;
    if (!d.active) return;
    const box = boxRef.current;
    const bd = backdropRef.current;
    let dy = clientY - d.startY;
    if (dy < 0) dy = dy * 0.3; // resistencia hacia arriba
    d.dy = dy;
    // Baja y encoge a la vez; el velo se aclara con el recorrido y deja ver lo
    // que hay detrás. Las tres cosas, con los números del otro visor.
    if (box) {
      box.style.transform = `translateY(${dy}px) scale(${escalaDeArrastre(dy)})`;
    }
    if (bd && dy > 0) bd.style.opacity = String(opacidadDeArrastre(dy));
  }

  function terminarArrastre() {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    if (d.dy > DRAG_CLOSE_PX) {
      startClose(true);
      return;
    }
    // Snap back.
    const box = boxRef.current;
    const bd = backdropRef.current;
    if (box) {
      box.style.transition = "transform 220ms cubic-bezier(0.22,1,0.36,1)";
      box.style.transform = "translateY(0px) scale(1)";
    }
    if (bd) {
      bd.style.transition = "opacity 220ms ease";
      bd.style.opacity = "1";
    }
    d.dy = 0;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    if (!empezarArrastre(e.clientY)) return;
    boxRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    moverArrastre(e.clientY);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    terminarArrastre();
  }

  // Táctil: un solo dedo y sin zoom. Con dos dedos manda el pellizco.
  function onTouchStart(e: ReactTouchEvent<HTMLDivElement>) {
    if (e.touches.length !== 1) {
      dragRef.current.active = false;
      return;
    }
    empezarArrastre(e.touches[0]!.clientY);
  }

  function onTouchMove(e: ReactTouchEvent<HTMLDivElement>) {
    if (e.touches.length !== 1) {
      dragRef.current.active = false;
      return;
    }
    moverArrastre(e.touches[0]!.clientY);
  }

  function onTouchEnd() {
    terminarArrastre();
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
        height: "var(--vb-alto-pantalla)",
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
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
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

        {/* Original CON ZOOM, encima, en cuanto está cargado. Es el mismo visor
            de pellizco que las imágenes de publicación (`PostPinchZoomImage`):
            dos dedos para acercar hasta 4x, arrastrar para moverse dentro, y
            deslizar hacia abajo sin zoom para cerrar. */}
        {fullLoaded ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 1,
              animation: "pmFadeIn 200ms ease",
            }}
          >
            <PostPinchZoomImage
              src={image.url}
              alt=""
              // El arrastre vertical lo lleva la caja de fuera (ver empezarArrastre):
              // así baja, encoge y aclara el velo a la vez, como en el visor de
              // publicaciones. Aquí el pinch se queda con el pellizco y el paseo.
              swipeAxis="horizontal"
              onZoomStateChange={(z) => { zoomedRef.current = z; }}
              // Cerrar por gesto pasa por la MISMA salida animada que la X, para
              // que el visor no desaparezca de golpe.
              onClose={() => startClose(true)}
              // El alto lo pone la caja del visor, no la pantalla: aquí la
              // imagen vive dentro del recuadro que creció desde la miniatura.
              disableMinHeight
            />
          </div>
        ) : null}
      </div>

      <button className="vibra-pop"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          startClose(false);
        }}
        aria-label="Cerrar"
        style={{
          position: "fixed",
          // Por debajo de la muesca / isla dinámica y de la barra de estado. Sin
          // esto la X se encimaba con la hora y la batería del sistema, que
          // además se comen el toque.
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          // En horizontal la muesca se va a un lado y también hay que esquivarla.
          insetInlineEnd: "calc(16px + env(safe-area-inset-right, 0px))",
          border: "none",
          // Disco oscuro detrás: sobre una foto clara, una X blanca sin fondo
          // desaparece.
          background: "rgba(0,0,0,0.42)",
          borderRadius: 999,
          color: "#fff",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          padding: 8,
          // Por encima del visor con zoom, que ocupa toda la caja.
          zIndex: 1,
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
