"use client";

import React from "react";

import { TextButton } from "./TextButton";

/**
 * "Editar" en texto morado.
 *
 * Sustituye a los lápices flotantes que había sobre el avatar, la portada y las
 * historias. Un icono encima de una foto tapa parte de la imagen y, sin fondo ni
 * borde, no se lee como algo pulsable; el texto sí, y no le quita sitio a lo que
 * está mirando la persona.
 *
 * Lleva sombra en el texto porque sobre una portada puede caer encima de
 * cualquier color, y el morado solo no siempre despega del fondo.
 */
/**
 * Estilo del "Editar" que va debajo del avatar, en el perfil y en la comunidad.
 *
 * Vive aquí y no en cada página porque las dos lo colocan igual, y las medidas
 * dependen de lo que sobresale alrededor del avatar, no del gusto de cada
 * pantalla: el aro de historia se dibuja en `inset: -6`, y el punto de live baja
 * hasta 20px por debajo del borde. Si el texto arranca antes de eso, el aro se
 * le monta encima.
 *
 * Lleva relleno propio para tener área táctil: en móvil el avatar llega a 286px
 * y el texto se quedaba en 11px sin nada alrededor, un objetivo demasiado fino
 * para el dedo.
 *
 * `bottom` se calcula hacia atrás desde donde queremos que empiece el texto:
 * borde inferior de la caja = separación + alto de línea + relleno de arriba.
 */
export function avatarEditButtonStyle({
  mobile,
  live = false,
}: {
  mobile: boolean;
  live?: boolean;
}): React.CSSProperties {
  const clearance = live ? 26 : mobile ? 15 : 13;
  const fontSize = mobile ? 13 : 12;
  const padY = mobile ? 8 : 6;

  return {
    position: "absolute",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: -(clearance + fontSize + padY),
    width: "100%",
    boxSizing: "border-box",
    padding: `${padY}px 12px`,
    fontSize,
    /* El botón es `inline-flex` (viene de TextButton), así que quien centra es
       `justify-content`, no `text-align`: el texto es un hijo flex y align no
       lo mueve. Se dejan los dos para que también centre si algún día vuelve a
       ser un bloque normal. */
    display: "flex",
    justifyContent: "center",
    textAlign: "center",
    zIndex: 200,
  };
}

/**
 * Envoltura fina sobre `TextButton`: mismo aspecto, misma API de siempre.
 *
 * Se conserva como pieza propia porque nombra un uso concreto —el "Editar" que
 * va debajo del avatar— y sus llamadas no tienen por qué saber de tonos ni de
 * tamaños. El estilo ya no vive aquí: sale del primitivo.
 */
export default function EditTextButton({
  children,
  onClick,
  disabled,
  ariaLabel,
  title,
  style,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <TextButton
      tone="brand"
      size="sm"
      shadow
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      style={style}
    >
      {children}
    </TextButton>
  );
}
