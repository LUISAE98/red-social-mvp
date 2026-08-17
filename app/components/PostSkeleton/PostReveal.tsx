"use client";

import { useEffect, useRef, useState } from "react";

// Envuelve una tarjeta de post y la revela con fade-in SOLO cuando sus imágenes
// (avatar + media del post) ya cargaron. Genérico: inspecciona los <img> que hay
// dentro y espera a que todos "asienten" (load o error). Si no hay imágenes,
// revela de inmediato. Un fallback evita que un post quede invisible si alguna
// imagen se cuelga o es lazy (fuera de viewport).
//
// Con `skeleton` el relevo es un cruce, no un relevo por turnos: el esqueleto se
// queda encima hasta que el contenido ya está entrando, y se apaga mientras el
// otro sube. Sin él, el esqueleto de la lista se desmonta en cuanto llegan los
// datos y el contenido todavía está en opacidad 0 — un hueco vacío que dura lo
// que tarden las imágenes.

const REVEAL_MS = 380;

export default function PostReveal({
  children,
  fallbackMs = 4000,
  skeleton = null,
}: {
  children: React.ReactNode;
  fallbackMs?: number;
  /**
   * Esqueleto que cubre el hueco mientras el contenido se revela. Debe tener la
   * forma de lo que envuelve (`PostSkeleton` para posts, `CommentSkeleton` para
   * comentarios). Sin él, el componente se comporta como siempre: solo fade-in.
   */
  skeleton?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [skeletonMounted, setSkeletonMounted] = useState(!!skeleton);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setReady(true);
      return;
    }

    const imgs = Array.from(el.querySelectorAll("img"));
    if (imgs.length === 0) {
      setReady(true);
      return;
    }

    let done = false;
    let settled = 0;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    const onOne = () => {
      settled += 1;
      if (settled >= imgs.length) finish();
    };

    const cleanups: Array<() => void> = [];
    imgs.forEach((img) => {
      // `complete` es true también cuando la imagen ya está cacheada o falló.
      if (img.complete) {
        onOne();
        return;
      }
      const onLoad = () => onOne();
      const onError = () => onOne();
      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);
      cleanups.push(() => {
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      });
    });

    const fb = window.setTimeout(finish, fallbackMs);

    return () => {
      cleanups.forEach((c) => c());
      window.clearTimeout(fb);
    };
  }, [fallbackMs]);

  // Retira el esqueleto solo cuando el cruce terminó. Antes de eso sigue en el
  // árbol, aunque ya sea invisible: quitarlo a mitad del fundido reabriría el
  // hueco que este componente existe para tapar.
  useEffect(() => {
    if (!ready || !skeletonMounted) return;
    const t = window.setTimeout(() => setSkeletonMounted(false), REVEAL_MS + 40);
    return () => window.clearTimeout(t);
  }, [ready, skeletonMounted]);

  const content = (
    <div
      ref={ref}
      style={{
        opacity: ready ? 1 : 0,
        transition: `opacity ${REVEAL_MS}ms ease`,
        willChange: "opacity",
      }}
    >
      {children}
    </div>
  );

  // Sin esqueleto no se añade envoltura: el árbol queda idéntico al de antes.
  if (!skeleton) return content;

  return (
    <div style={{ position: "relative" }}>
      {content}
      {skeletonMounted ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
            opacity: ready ? 0 : 1,
            transition: `opacity ${REVEAL_MS}ms ease`,
            willChange: "opacity",
          }}
        >
          {skeleton}
        </div>
      ) : null}
    </div>
  );
}
