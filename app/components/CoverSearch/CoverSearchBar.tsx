"use client";

import { useEffect, useRef, useState } from "react";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

type Props = {
  /** Se llama al dar Enter o clic en la lupa. */
  onSubmit: (query: string) => void;
  /** Se llama tras la animación de cierre para desmontar. */
  onClose: () => void;
  placeholder: string;
};

const CLOSE_ANIM_MS = 180;

/**
 * Barra de búsqueda que se despliega sobre la portada (perfil/comunidad).
 * Mismo estilo que la barra de "/search", con animación de entrada/salida.
 * Debe renderizarse como hijo directo del contenedor de la portada
 * (position: relative): se posiciona absoluta y ocupa todo el renglón.
 */
export default function CoverSearchBar({ onSubmit, onClose, placeholder }: Props) {
  const [value, setValue] = useState("");
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, []);

  function handleClose() {
    setClosing(true);
    window.setTimeout(() => onClose(), CLOSE_ANIM_MS);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim());
      }}
      className="cover-search-field"
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        top: 14,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: "8px 8px 8px 12px",
        boxSizing: "border-box",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        transformOrigin: "right center",
        animation: closing
          ? `coverSearchOut ${CLOSE_ANIM_MS}ms ease forwards`
          : "coverSearchIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards",
      }}
    >
      <input
        ref={inputRef}
        className="cover-search-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#fff",
          fontSize: 13,
          fontFamily: "inherit",
          lineHeight: 1.5,
        }}
      />
      <button
        type="submit"
        aria-label={placeholder}
        style={{
          flexShrink: 0,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          color: "#fff",
          display: "grid",
          placeItems: "center",
        }}
      >
        <VibraNavigationIcon type="search" size={20} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Cerrar"
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          color: "rgba(255,255,255,0.7)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <style jsx>{`
        .cover-search-input::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }
      `}</style>
      <style jsx global>{`
        @keyframes coverSearchIn {
          from {
            opacity: 0;
            transform: scale(0.94) translateX(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateX(0);
          }
        }
        @keyframes coverSearchOut {
          from {
            opacity: 1;
            transform: scale(1) translateX(0);
          }
          to {
            opacity: 0;
            transform: scale(0.94) translateX(10px);
          }
        }
      `}</style>
    </form>
  );
}
