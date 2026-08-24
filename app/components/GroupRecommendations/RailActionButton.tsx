"use client";

import React from "react";

/**
 * El botón de acción de las tarjetas del rail: seguir, unirse, solicitar acceso.
 *
 * Existía tres veces —JoinButton, FollowButton y el de las tarjetas de live—
 * copiado casi letra por letra, así que cada arreglo había que hacerlo tres
 * veces y el gesto se veía distinto según la tarjeta. Aquí es uno solo.
 *
 * ── Cómo cambia de color ──────────────────────────────────────────────────
 *
 * El color NO se apaga cambiando `background`: un degradado no se puede
 * interpolar con un color plano, así que el navegador lo cambiaba de golpe —el
 * salto seco que se veía—. En su lugar hay DOS capas fijas, el gris debajo y el
 * degradado encima, y lo que se anima es la OPACIDAD del de arriba. Eso sí es
 * interpolable, así que el color se va y vuelve de verdad.
 *
 * El contorno es `transparent` en TODOS los estados, nunca de un color según el
 * estado. Va aunque no se vea porque ocupa su pixel: sin él, el botón crecía y
 * encogía 2px al cambiar de estado y la tarjeta entera daba un tirón.
 */

/** Qué pinta tiene el botón ahora mismo. */
export type RailBtnTono =
  /** Acción disponible o ya consumada con éxito: colores de Vibra. */
  | "marca"
  /** Suscripción de pago: el azul que ya usaban esas tarjetas. */
  | "pago"
  /** A la espera de que responda otro: gris. */
  | "espera";

export function RailActionButton({
  label,
  tono,
  loading,
  onClick,
  disabled,
  fontStack,
}: {
  label: string;
  tono: RailBtnTono;
  /** La acción está en vuelo: el color se apaga y el texto pasa a tres puntos. */
  loading: boolean;
  onClick: () => void;
  /** Sin acción posible (por ejemplo, sin sesión). Distinto de `loading`. */
  disabled?: boolean;
  fontStack: string;
}) {
  // Mientras la acción vuela, el botón se apaga pase lo que pase: es la señal
  // de que algo está ocurriendo, y vale para los tres tonos.
  const coloreado = !loading && tono !== "espera";

  const fondoColor =
    tono === "pago"
      ? "#70aefb"
      : "linear-gradient(135deg, #ec4899, #9333ea)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      // El nombre de la acción tiene que seguir anunciándose mientras los puntos
      // ocupan el sitio del texto: si no, quien usa lector de pantalla se queda
      // con un botón sin nombre justo cuando algo está pasando.
      aria-label={label}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        borderRadius: 10,
        padding: "7px 12px",
        border: "1px solid transparent",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: disabled || loading ? "default" : "pointer",
        background: "transparent",
        fontFamily: fontStack,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 33,
        color: coloreado ? "#fff" : "rgba(255,255,255,0.70)",
        transition: "color 260ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Capa de abajo: el gris. Siempre está, y es lo que queda a la vista
          cuando el color de arriba se desvanece. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          background: "rgba(255,255,255,0.14)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      />

      {/* Capa de arriba: el color. Lo único que se anima. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          background: fondoColor,
          opacity: coloreado ? 1 : 0,
          transition: "opacity 260ms ease",
        }}
      />

      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        {loading ? (
          <span className="vibra-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          label
        )}
      </span>
    </button>
  );
}
