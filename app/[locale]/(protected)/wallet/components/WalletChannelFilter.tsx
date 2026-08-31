"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { WalletChannel } from "@/lib/wallet/walletSubscriptionData";

// Aro de Vibra (mismo gradiente de marca que el aro de historias).
const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const AVATAR = 60; // diámetro del avatar (+30%)
const RING_PAD = 2.4; // grosor del aro de Vibra (+20% sobre 2)
const RING_GAP = 2.5; // hueco entre el aro y la foto
/**
 * Cuánto sobresale el aro por fuera de la foto.
 *
 * El aro va FUERA y no comiendo la foto, que es lo que antes obligaba a
 * cambiarle el tamaño a la imagen. Al estar posicionado en absoluto no ocupa
 * sitio en la fila, así que no descoloca a los avatares de al lado.
 */
const RING_OUT = RING_PAD + RING_GAP;
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

  // ⚠️ El tamaño de la foto NO depende del aro. Antes sí, y como `next/image`
  // lleva las medidas en los atributos, encenderlo la hacía pedir otra imagen
  // y durante el cambio se veía el fondo negro de debajo.
  const media = showImg ? (
    <Image
      src={src as string}
      alt=""
      width={size}
      height={size}
      onError={() => setError(true)}
      style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.09)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        color: "#fff",
      }}
    >
      {initial}
    </div>
  );

  return (
    <div
      className={ring ? "chf-avatar chf-on" : "chf-avatar"}
      style={{ width: size, height: size, position: "relative", flexShrink: 0 }}
    >
      {/* El aro vive siempre en el árbol; lo que cambia es cuánto se ha
          dibujado. Montarlo y desmontarlo dejaría la salida sin animación. */}
      <span className="chf-ring" aria-hidden="true">
        <span className="chf-ring-fill" />
      </span>
      <div className="chf-photo">{media}</div>

      {/* ⚠️ El bloque va AQUI, no en el componente de arriba. styled-jsx
          firma con un hash los elementos del componente que contiene la
          etiqueta <style>, y solo a esos les aplica las reglas. Puesto fuera,
          el aro no recibia ni una linea de este CSS. */}
      <style jsx>{`
        /* El aro se dibuja FUERA de la foto, en su propia capa. Al ir en
           posicion absoluta no ocupa sitio: encenderlo no mueve ni un avatar
           de la fila.

           Aparece BARRIENDO, como una barra de carga circular, y al quitarlo
           hace el mismo recorrido al reves. Por eso nunca se desmonta: un
           elemento que sale del arbol no puede animar su salida. */
        .chf-ring {
          position: absolute;
          inset: -${RING_OUT}px;
          border-radius: 50%;
          pointer-events: none;

          /* UNA mascara por elemento. Componer dos en el mismo elemento
             —mask-composite— fue lo que dejo el aro invisible. */
          -webkit-mask: conic-gradient(from -90deg, #000 var(--chf-sweep, 0%), transparent 0);
          mask: conic-gradient(from -90deg, #000 var(--chf-sweep, 0%), transparent 0);

          opacity: 0;
          transform: scale(0.82);
          transition:
            --chf-sweep 460ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 160ms ease,
            transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        /* El hijo pone el color y el agujero del centro: eso es lo que lo
           convierte en aro y no en disco. */
        .chf-ring-fill {
          display: block;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: ${VIBRA_RING};
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - ${RING_PAD}px), #000 0);
          mask: radial-gradient(farthest-side, transparent calc(100% - ${RING_PAD}px), #000 0);
        }

        .chf-on .chf-ring {
          --chf-sweep: 100%;
          opacity: 1;
          transform: scale(1);
        }

        /* La foto se aparta un poco para dejarle sitio al aro. Es un
           transform, no un cambio de medidas: la imagen sigue siendo la misma
           y next/image no vuelve a pedirla. Ese cambio de tamano era lo que
           ponia el avatar en negro al seleccionarlo. */
        .chf-photo {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          overflow: hidden;
          transform: scale(1);
          transition: transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .chf-on .chf-photo {
          transform: scale(0.9);
        }

        @media (prefers-reduced-motion: reduce) {
          .chf-ring,
          .chf-photo {
            transition: none;
          }
        }
      `}</style>
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
        <IconButton label="←" size="sm" tone="bare" shape="square" style={{ position: "absolute", top: "30px", transform: "translateY(-50%)", zIndex: "5", filter: "drop-shadow(0 1px 4px rgba(0, 0, 0, 0.75))", insetInlineStart: "-8px" }} onClick={() => scrollByDir(-1)} className="chf-arrow chf-arrow-left">
          <Chevron dir="left" />
        </IconButton>
      ) : null}
      {showArrows && canRight ? (
        <IconButton label="→" size="sm" tone="bare" shape="square" style={{ position: "absolute", top: "30px", transform: "translateY(-50%)", zIndex: "5", filter: "drop-shadow(0 1px 4px rgba(0, 0, 0, 0.75))", insetInlineEnd: "-8px" }} onClick={() => scrollByDir(1)} className="chf-arrow chf-arrow-right">
          <Chevron dir="right" />
        </IconButton>
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
                  marginInlineStart: i === 0 ? 0 : -STACK_OVERLAP,
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
          /* ⚠️ overflow-x: auto hace que el navegador calcule tambien
             overflow-y: auto, asi que esto recorta arriba y abajo. El aro
             sobresale de la foto, y sin este aire se lo come. */
          padding: ${RING_OUT + 2}px 2px;
          /* Solo scroll horizontal: el navegador no dispara scroll/refresh vertical
             al arrastrar aquí (axis-lock también en usePullToRefresh). */
          touch-action: pan-x;
        }
        .chf-scroller::-webkit-scrollbar {
          display: none;
        }
        /* Móvil: el scroll se extiende sobre los márgenes laterales de la card
           (padding 15px), pero deja un inset para no pegarse al borde. */
        @media (max-width: 819px) {
          .chf-scroller {
            margin-inline-start: -15px;
            margin-inline-end: -15px;
            padding-inline-start: 15px;
            padding-inline-end: 15px;
            scroll-padding-inline-start: 15px;
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
          inset-inline-start: -8px;
        }
        .chf-arrow-right {
          inset-inline-end: -8px;
        }
      `}</style>
    </div>
  );
}
