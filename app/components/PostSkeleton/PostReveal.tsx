"use client";

import { useEffect, useRef, useState } from "react";

// Envuelve una tarjeta de post y la revela con fade-in SOLO cuando sus imágenes
// (avatar + media del post) ya cargaron. Genérico: inspecciona los <img> que hay
// dentro y espera a que todos "asienten" (load o error). Si no hay imágenes,
// revela de inmediato. Un fallback evita que un post quede invisible si alguna
// imagen se cuelga o es lazy (fuera de viewport).
export default function PostReveal({
  children,
  fallbackMs = 4000,
}: {
  children: React.ReactNode;
  fallbackMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

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

  return (
    <div
      ref={ref}
      style={{
        opacity: ready ? 1 : 0,
        transition: "opacity 380ms ease",
        willChange: "opacity",
      }}
    >
      {children}
    </div>
  );
}
