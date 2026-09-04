"use client";

import React, { forwardRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Campo de contraseña con ojo para revelarla.
 *
 * Existe porque escribir a ciegas es de los sitios donde más se abandona un
 * alta: una tecla mal dada no se ve, y el error solo aparece al enviar. Poder
 * mirar lo escrito arregla eso sin bajar ninguna exigencia de la contraseña.
 *
 * Hereda el aspecto de quien lo usa: el `style` que se le pase manda, y lo
 * único que impone es el hueco de la derecha para que el texto no pase por
 * debajo del botón. Así encaja igual en el alta, en el login y en cualquier
 * formulario que ya tenga su propio lenguaje visual.
 *
 * El botón NO es enfocable con el tabulador (`tabIndex={-1}`) a propósito: en
 * un formulario se tabula de campo a campo, y meter el ojo en medio del camino
 * entre la contraseña y el botón de enviar estorba a quien navega con teclado.
 * Sigue siendo alcanzable con el ratón, con el dedo y por lectores de pantalla.
 *
 * ⚠️ El ojo va en blanco translúcido: da por hecho una superficie OSCURA, que es
 * lo que hay en el alta, en el login y en la wallet. Sobre fondo claro no se
 * vería — ahí habría que abrirle un parámetro de color antes de usarlo, no
 * meterlo tal cual. El único sitio claro conocido es la pasarela de pago.
 */

export type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Estilos del contenedor, por si hace falta colocarlo dentro de una rejilla. */
  wrapperStyle?: React.CSSProperties;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ style, wrapperStyle, ...rest }, ref) {
    const t = useTranslations("common");
    const [visible, setVisible] = useState(false);

    return (
      <div style={{ position: "relative", ...wrapperStyle }}>
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          // El hueco del botón se reserva SIEMPRE, esté o no revelada: si
          // dependiera del estado, el texto daría un salto al pulsar el ojo.
          style={{ ...style, paddingInlineEnd: 42 }}
          {...rest}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          title={visible ? t("hidePassword") : t("showPassword")}
          style={{
            position: "absolute",
            top: "50%",
            insetInlineEnd: 10,
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            padding: 4,
            cursor: "pointer",
            color: "rgba(255,255,255,0.55)",
            display: "grid",
            placeItems: "center",
            lineHeight: 0,
          }}
        >
          {visible ? EYE_ICON : EYE_OFF_ICON}
        </button>
      </div>
    );
  }
);

const EYE_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EYE_OFF_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-6.5 0-10-8-10-8a18.5 18.5 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

export default PasswordInput;
