"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { WalletChannel } from "@/lib/wallet/walletSubscriptionData";

// Aro de Vibra (mismo gradiente de marca que el aro de historias).
const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const AVATAR = 60; // diámetro del avatar (+30%)
const RING_PAD = 2.4; // grosor del aro de Vibra (+20% sobre 2)
const STACK_OVERLAP = 44; // encimado de los avatares de "Todos" (más angosto)
const STACK_MAX = 4; // avatares visibles en el grupo "Todos"
const LAPTOP_MIN_WIDTH = 820;

function Avatar({
  src,
  initial,
  size,
  ring,
}: {
  src: string | null;
  initial: string;
  size: number;
  ring: boolean;
}) {
  const [error, setError] = useState(false);
  const showImg = Boolean(src) && !error;
  const inner = ring ? size - Math.round(RING_PAD * 2 + 3) : size;

  const media = showImg ? (
    <Image
      src={src as string}
      alt=""
      width={inner}
      height={inner}
      onError={() => setError(true)}
      style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <div
      style={{
        width: inner,
        height: inner,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.09)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(inner * 0.4),
        color: "#fff",
      }}
    >
      {initial}
    </div>
  );

  if (!ring) {
    return (
      <div
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: "50%",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {media}
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        background: VIBRA_RING,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: RING_PAD,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          border: "1.5px solid #0a0a0e",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
      >
        {media}
      </div>
    </div>
  );
}

// Flecha del carrusel (mismo chevron que en los servicios del perfil, en blanco).
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Filtro por canal para Movimientos: primero un grupo de avatares encimados
 * (perfil + comunidades) que equivale a "Todos", y luego cada canal por separado.
 * Los seleccionados llevan el aro de Vibra. Scroll horizontal: en laptop dos
 * flechas laterales; en móvil se desliza con el dedo. Multi-selección.
 */
export default function WalletChannelFilter({
  channels,
  value,
  onChange,
}: {
  channels: WalletChannel[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const tWallet = useTranslations("wallet");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [isLaptop, setIsLaptop] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [overflow, setOverflow] = useState(false);

  const allActive = value.includes("all");

  const channelLabel = useCallback(
    (ch: WalletChannel) =>
      ch.name ??
      (ch.type === "profile"
        ? tWallet("channelProfile")
        : tWallet("channelCommunityFallback")),
    [tWallet]
  );

  const toggle = (key: string) => {
    if (allActive) {
      onChange([key]);
      return;
    }
    if (value.includes(key)) {
      const next = value.filter((k) => k !== key);
      onChange(next.length ? next : ["all"]);
    } else {
      onChange([...value, key]);
    }
  };

  // Detectar laptop para mostrar/ocultar las flechas.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(min-width: ${LAPTOP_MIN_WIDTH}px)`);
    const update = () => setIsLaptop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Estado de las flechas según el scroll disponible.
  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const isOverflow = el.scrollWidth > el.clientWidth + 2;
    setOverflow(isOverflow);
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, channels.length]);

  const scrollByDir = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(180, el.clientWidth * 0.7), behavior: "smooth" });
  };

  // Si el creador no administra ninguna comunidad (solo su perfil), no hay nada
  // que filtrar: se oculta por completo.
  if (channels.filter((c) => c.type === "group").length === 0) return null;

  const stack = channels.slice(0, STACK_MAX);
  const showArrows = isLaptop;

  const cell = (label: string, node: ReactNode, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        scrollSnapAlign: "start",
      }}
    >
      {node}
    </button>
  );

  return (
    <div style={{ position: "relative", marginBottom: 16 }}>
      {showArrows && canLeft ? (
        <button
          type="button"
          aria-label="←"
          onClick={() => scrollByDir(-1)}
          className="chf-arrow chf-arrow-left"
        >
          <Chevron dir="left" />
        </button>
      ) : null}
      {showArrows && canRight ? (
        <button
          type="button"
          aria-label="→"
          onClick={() => scrollByDir(1)}
          className="chf-arrow chf-arrow-right"
        >
          <Chevron dir="right" />
        </button>
      ) : null}

      <div
        ref={scrollerRef}
        className="chf-scroller"
        style={{ justifyContent: overflow ? "flex-start" : "center" }}
      >
        {/* "Todos": avatares encimados; al seleccionar, cada uno con su propio aro. */}
        {cell(
          tWallet("channelFilterAll"),
          <div style={{ display: "flex", alignItems: "center" }}>
            {stack.map((ch, i) => (
              <div
                key={ch.key}
                style={{
                  marginLeft: i === 0 ? 0 : -STACK_OVERLAP,
                  zIndex: stack.length - i,
                  borderRadius: "50%",
                  border: "2px solid #0a0a0e",
                  boxSizing: "border-box",
                }}
              >
                <Avatar
                  src={ch.avatar}
                  initial={channelLabel(ch).charAt(0).toUpperCase()}
                  size={AVATAR}
                  ring={allActive}
                />
              </div>
            ))}
          </div>,
          () => onChange(["all"]),
          "__all__"
        )}

        {/* Canales individuales. */}
        {channels.map((ch) => {
          const active = !allActive && value.includes(ch.key);
          return cell(
            channelLabel(ch),
            <Avatar
              src={ch.avatar}
              initial={channelLabel(ch).charAt(0).toUpperCase()}
              size={AVATAR}
              ring={active}
            />,
            () => toggle(ch.key),
            ch.key
          );
        })}
      </div>

      <style jsx>{`
        .chf-scroller {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          scroll-snap-type: x proximity;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          padding: 2px 2px 0;
        }
        .chf-scroller::-webkit-scrollbar {
          display: none;
        }
        /* Móvil: el scroll se extiende sobre los márgenes laterales de la card
           (padding 15px), pero deja un inset para no pegarse al borde. */
        @media (max-width: 819px) {
          .chf-scroller {
            margin-left: -15px;
            margin-right: -15px;
            padding-left: 15px;
            padding-right: 15px;
            scroll-padding-left: 15px;
          }
        }
        .chf-arrow {
          position: absolute;
          top: 30px;
          transform: translateY(-50%);
          z-index: 5;
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.75));
        }
        .chf-arrow-left {
          left: -8px;
        }
        .chf-arrow-right {
          right: -8px;
        }
      `}</style>
    </div>
  );
}
