"use client";

/**
 * Encabezado de una sección plegable del menú lateral.
 *
 * Es la fila que se repite en todo el menú: ícono, título, globo de novedades y,
 * al final, el "+" que abre — o el enlace de "ver todas" cuando ya está abierta.
 *
 * Vive aparte porque lo usan dos cosas distintas: los rails de avatares
 * (`CommunityRail`) y la sección de experiencias, que despliega tarjetas en vez
 * de una tira. Cuando el encabezado vivía dentro del rail, la única forma de que
 * la otra sección se viera igual era copiarlo, y dos copias se separan a la
 * primera corrección.
 *
 * El orden de la derecha es deliberado: el globo va SIEMPRE pegado a la
 * izquierda del "+", nunca suelto al final del renglón.
 */

import type { ReactNode } from "react";

export default function RailHeader({
  icon,
  title,
  open,
  collapsible,
  badgeCount = 0,
  seeAllLabel,
  onToggle,
  onSeeAll,
}: {
  /** Ícono de 21px. Llega como prop: los del menú viven en un árbol deprecado. */
  icon?: ReactNode;
  title: string;
  open: boolean;
  /** Sin esto el encabezado no es un botón: no hay nada que plegar. */
  collapsible: boolean;
  /** Novedades sin ver. Solo se pinta con la sección cerrada. */
  badgeCount?: number;
  /** Texto del enlace de la derecha con la sección abierta. Sin él, no hay enlace. */
  seeAllLabel?: string;
  onToggle: () => void;
  onSeeAll?: () => void;
}) {
  const inner = (
    <>
      {/* Caja y color calcados de .walletIcon (menú derecho de laptop): 22px de
          lado, gris al 68% y opacidad 0.82. */}
      {icon ? (
        <span
          style={{
            width: 22,
            minWidth: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "rgba(255,255,255,0.68)",
            opacity: 0.82,
          }}
        >
          {icon}
        </span>
      ) : null}

      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "start",
        }}
      >
        {title}
      </span>

      {/* Globo de novedades: solo con la sección cerrada y pegado al "+".
          Abierta no hay nada que avisar — lo que cuenta ya está a la vista. */}
      {collapsible && !open && badgeCount > 0 ? (
        <span
          style={{
            flexShrink: 0,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 999,
            background: "#a855f7",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            boxSizing: "border-box",
          }}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}

      {/* Cerrada, un "+" para abrir. Abierta, el enlace de "ver todas", con el
          mismo tratamiento que el de Mensajes. El "+" solo existe donde se puede
          plegar; el enlace no depende de eso, porque en una sección no plegable
          es la única puerta a la lista completa. */}
      {collapsible && !open ? (
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            fontSize: 17,
            lineHeight: 1,
            fontWeight: 400,
            color: "rgba(255,255,255,0.62)",
          }}
        >
          +
        </span>
      ) : seeAllLabel && onSeeAll ? (
        <span
          role="link"
          tabIndex={0}
          // stopPropagation: el encabezado entero pliega la sección, y sin esto
          // pulsar "ver todas" la cerraría en vez de abrir la lista.
          onClick={(e) => {
            e.stopPropagation();
            onSeeAll();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            onSeeAll();
          }}
          style={{
            flexShrink: 0,
            color: "#a855f7",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          {seeAllLabel}
        </span>
      ) : null}
    </>
  );

  const style = {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 7,
    padding: "0 8px 6px",
    fontWeight: 400,
    color: "rgba(255,255,255,0.74)",
  };

  // Sin `collapsible` no es un botón: un control que no hace nada confunde al
  // lector de pantalla.
  return collapsible ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      style={{
        ...style,
        width: "100%",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {inner}
    </button>
  ) : (
    <div style={style}>{inner}</div>
  );
}
