"use client";

import React from "react";
import type { CSSProperties } from "react";

/**
 * El lenguaje visual de una pantalla de configuración de Vibra.
 *
 * 🚨 VIVE AQUÍ PORQUE ESTABA EN UN SOLO SITIO Y HACÍA FALTA EN DOS. La
 * configuración del perfil tenía estas piezas dentro de su propio archivo, y la
 * de la comunidad se había quedado con un lenguaje distinto —interruptores
 * blancos y negros, botones de caja, etiquetas al revés— del que ya nadie se
 * acordaba. Copiarlas habría dejado dos "iguales" que duran hasta el primer
 * retoque; por eso se mudan a un módulo compartido y las dos pantallas beben
 * del mismo.
 *
 * Aquí no hay reglas de negocio, solo forma, medida y letra.
 */

/** El glifo de una pestaña de configuración. Trazo, no relleno. */
export function SettingsIcon({
  children,
  size = 20,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** El nombre del campo, arriba y en gris. */
export const settingsLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "rgba(255,255,255,0.58)",
  lineHeight: 1.2,
};

/** Lo que vale ahora mismo ese campo. Es lo único que se lee en blanco. */
export const settingsValue: CSSProperties = {
  marginTop: 4,
  fontSize: 13.5,
  color: "rgba(255,255,255,0.92)",
  fontWeight: 600,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

/** La explicación de qué pasa si se cambia. */
export const settingsHint: CSSProperties = {
  marginTop: 5,
  fontSize: 11,
  color: "rgba(255,255,255,0.58)",
  lineHeight: 1.4,
};

/** Texto a la izquierda, control a la derecha. */
export const settingsRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 10,
  alignItems: "center",
  padding: "11px 0",
  position: "relative",
};

/**
 * Un renglón de ajuste, con su raya de separación.
 *
 * 🚨 LA RAYA LA PINTA ESTE COMPONENTE, NO EL DE FUERA. styled-jsx solo pone su
 * hash en lo que renderiza SU propio componente, así que una regla escrita en la
 * tarjeta de arriba nunca alcanzaría a estos renglones —y fallaría en silencio,
 * sin raya y sin error. Cada renglón trae la suya.
 *
 * La raya entra 6px por cada lado en vez de cruzar de borde a borde, y el último
 * renglón la pierde para no chocar con el canto de la tarjeta.
 */
export function SettingsRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="vb-settings-row" style={{ ...settingsRow, ...style }}>
      {children}

      <style jsx>{`
        .vb-settings-row::after {
          content: "";
          position: absolute;
          inset-inline-start: 6px;
          inset-inline-end: 6px;
          bottom: 0;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
        }

        .vb-settings-row:last-child::after {
          display: none;
        }
      `}</style>
    </div>
  );
}

/**
 * Una pestaña de configuración, con su tarjeta, su icono y su título.
 *
 * El cuerpo se pliega con `grid-template-rows` de `0fr` a `1fr` para animar
 * hasta su altura real sin un tope fijo que recorte la lista de dentro.
 *
 * 🚨 ÚSALO A NIVEL DE MÓDULO, NO DECLARES UNO DENTRO DE UN COMPONENTE. Una
 * función declarada dentro es un tipo nuevo en cada render, así que React
 * desmonta y vuelve a montar todo su subárbol, se pierde el foco de lo que se
 * estuviera escribiendo y se reinicia cualquier animación en curso.
 */
export function SettingsSection({
  icono,
  titulo,
  abierta,
  onToggle,
  fija = false,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  abierta: boolean;
  onToggle: () => void;
  /**
   * Siempre abierta y sin nada que pulsar.
   *
   * En laptop hay sitio de sobra para verlas todas a la vez, y plegarlas solo
   * añade un clic para ver lo que ya cabe. Cuando está fija la cabecera deja de
   * ser un botón y pierde el chevron, porque una flecha que no hace nada promete
   * algo que no va a pasar.
   */
  fija?: boolean;
  children: React.ReactNode;
}) {
  const desplegada = fija || abierta;

  return (
    <div
      style={{
        minWidth: 0,
        position: "relative",
        // 🚨 CADA PESTAÑA ES SU PROPIO MÓDULO, con su tarjeta. No van todas
        // dentro de una sola: apiladas en un mismo bloque gris se leen como una
        // lista larga otra vez, que es justo de lo que se venía.
        background: "rgba(255,255,255,0.06)",
        borderRadius: 14,
        padding: 6,
      }}
    >
      <button
        type="button"
        onClick={fija ? undefined : onToggle}
        // Fija no es un control, ni se puede pulsar ni anuncia estado plegable.
        disabled={fija}
        aria-expanded={fija ? undefined : abierta}
        style={{
          width: "100%",
          minHeight: 39,
          display: "flex",
          alignItems: "center",
          gap: 8,
          // Dentro de la tarjeta gris no lleva fondo propio, dos grises
          // encimados solo ensucian el contraste.
          background: "transparent",
          border: "none",
          borderRadius: 10,
          cursor: fija ? "default" : "pointer",
          padding: "9px 6px",
          textAlign: "start",
          WebkitTapHighlightColor: "transparent",
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            flexShrink: 0,
            display: "inline-flex",
            color: desplegada ? "#ffffff" : "rgba(255,255,255,0.72)",
          }}
        >
          {icono}
        </span>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "#ffffff",
            fontWeight: desplegada ? 700 : 600,
          }}
        >
          {titulo}
        </span>

        {!fija && (
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              display: "inline-flex",
              color: "rgba(255,255,255,0.5)",
              transform: abierta ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9.5L12 15.5L18 9.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: desplegada ? "1fr" : "0fr",
          opacity: desplegada ? 1 : 0,
          transition:
            "grid-template-rows 380ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Relleno lateral propio: sin él, el contenido queda pegado al borde
              de la tarjeta y se lee apretado. */}
          <div style={{ padding: "0 6px 6px" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Los glifos de las pestañas ────────────────────────────────────────────
 *
 * 🚨 VIVEN AQUÍ Y NO EN CADA PANTALLA. Los mismos siete ajustes aparecen en la
 * pestaña del perfil, en el espacio personal y en la página de configuración de
 * laptop; con un juego de iconos por archivo, "cuentas bloqueadas" acababa
 * siendo un candado en una pantalla y un círculo tachado en otra.
 */

/** Quién puede escribirte: un globo de mensaje. */
export const ICONO_MENSAJES = (
  <SettingsIcon>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
  </SettingsIcon>
);

/** Notificaciones: la campana. */
export const ICONO_NOTIFICACIONES = (
  <SettingsIcon>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </SettingsIcon>
);

/** Datos de la cuenta: la persona. */
export const ICONO_CUENTA = (
  <SettingsIcon>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </SettingsIcon>
);

/** Descripción del perfil: renglones de texto. */
export const ICONO_BIO = (
  <SettingsIcon>
    <path d="M4 6h16" />
    <path d="M4 11h16" />
    <path d="M4 16h9" />
  </SettingsIcon>
);

/** Idioma y moneda: el globo terráqueo. */
export const ICONO_IDIOMA = (
  <SettingsIcon>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
  </SettingsIcon>
);

/** Cuentas bloqueadas: el círculo tachado. */
export const ICONO_BLOQUEADAS = (
  <SettingsIcon>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </SettingsIcon>
);

/** Sesiones activas: la pantalla de otro aparato. */
export const ICONO_SESIONES = (
  <SettingsIcon>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
    <path d="M12 16v4" />
  </SettingsIcon>
);
