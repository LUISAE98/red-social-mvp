"use client";

/**
 * Añadir Vibra a la pantalla de inicio, en iPhone y iPad.
 *
 * 🚨 Aquí NO hay botón que instale, y no es una carencia del código.
 *
 * Safari no emite el evento de instalación ni expone ninguna API para pedirla:
 * en Apple, instalar es un gesto que solo puede hacer la persona, a mano, desde
 * el menú Compartir. Lo único que se puede hacer desde aquí es explicarlo bien.
 * De ahí que este aviso sea un instructivo y el de Android un botón.
 *
 * ⚠️ Y no es cosmético. En iPhone, los avisos push SOLO funcionan si la app está
 * en la pantalla de inicio; en Safari a secas no llegan nunca, se configure lo
 * que se configure. Así que todo el trabajo de notificaciones no le sirve de
 * nada a un usuario de iPhone que no haya pasado por aquí. Este aviso es el
 * requisito de aquello, no un extra de crecimiento.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { usePwaInstalled } from "@/lib/hooks/usePwaInstalled";
import { aplazar, puedePreguntar, CADENCIA_INSTRUCTIVO } from "@/lib/pwa/aplazarAviso";
import { PRIORIDAD, useTurnoDeAviso } from "@/lib/pwa/turnoDeAvisos";
import PanelModal from "./PanelModal";

/** Clave propia: posponer este aviso no calla al de Android, ni al revés. */
const CLAVE_APLAZADO = "vibra:iosInstallPromptAplazado";

/** El glifo de Compartir de iOS, para que el paso 1 se reconozca sin leerlo. */
function IconoCompartir({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

/** Marco común de los dos dibujos, para que se lean como dos capturas. */
const MAQUETA: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 10,
  overflow: "hidden",
};

/** Lo que está APAGADO en el dibujo: presente para dar contexto, sin llamar. */
const APAGADO = "rgba(255,255,255,0.28)";

const ESTILO_PASO: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  color: "rgba(255,255,255,0.88)",
  lineHeight: 1.3,
};

/** Los botones redondos de la barra de Safari. */
const CIRCULO: React.CSSProperties = {
  flex: "0 0 auto",
  width: 24,
  height: 24,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.07)",
  display: "grid",
  placeItems: "center",
};

/**
 * Una opción de menú de iOS, dibujada como la de verdad.
 *
 * La usan los pasos 3 y 4, que son la misma cosa: una fila que hay que tocar.
 * El gris es el de los menús de iOS, y el anillo blanco es lo que señala,
 * igual que en la barra del paso 2.
 */
const FILA_IOS: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "11px 13px",
  borderRadius: 12,
  background: "#1c1c1e",
  boxShadow: "inset 0 0 0 1.5px #ffffff",
  color: "#fff",
  fontSize: 13,
  fontWeight: 500,
};

/**
 * La brújula de Safari, dibujada.
 *
 * Se redibuja en vez de traer el icono de Apple: aquí solo hace falta que se
 * reconozca de un vistazo, y un SVG propio pesa nada, escala a cualquier
 * pantalla y no arrastra un archivo ajeno al repositorio.
 *
 * La aguja es la marca reconocible — roja hacia arriba a la derecha, blanca
 * hacia abajo a la izquierda —, así que es lo que se dibuja con más cuidado.
 */
function IconoSafari({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id="vbSafariFondo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#19c5fb" />
          <stop offset="100%" stopColor="#0a72e8" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#vbSafariFondo)" />
      <circle cx="24" cy="24" r="19" fill="none" stroke="#fff" strokeWidth="2" opacity="0.55" />
      {/* Las cuatro marcas cardinales. */}
      <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
        <path d="M24 6.5v3M24 38.5v3M6.5 24h3M38.5 24h3" />
      </g>
      {/* La aguja. Dos triángulos que se tocan en el centro. */}
      <path d="M35 13L22.5 21.5L27 26.5Z" fill="#ff3b30" />
      <path d="M13 35L26.5 26.5L21.5 21.5Z" fill="#f5f5f7" />
    </svg>
  );
}

/**
 * El número del paso. Blanco y suelto, sin cápsula detrás.
 *
 * Conserva el ancho fijo aunque ya no haya caja: es lo que mantiene los cuatro
 * rótulos alineados en la misma columna, y sin él cada uno arrancaría en un
 * sitio distinto según lo ancho que sea su cifra.
 */
function Paso({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        width: 18,
        color: "#fff",
        fontSize: 16,
        fontWeight: 700,
        // La cifra manda sobre su rótulo, así que se le da su propia altura de
        // línea: heredando la del texto, un número más grande empujaba el
        // renglón y los cuatro pasos dejaban de tener el mismo alto.
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {n}
    </span>
  );
}

export default function IosInstallPrompt() {
  const t = useTranslations("iosInstallPrompt");
  const { instalada, plataforma } = usePwaInstalled();

  /** Se cerró en esta visita. Lo de localStorage lo lleva `puedePreguntar`. */
  const [cerrado, setCerrado] = useState(false);

  /**
   * ⚠️ Se calcula al pintar, sin efecto ni estado derivado.
   *
   * El orden del `&&` no es casual. `instalada` vale `null` hasta que hidrata,
   * así que en el servidor y en la primera pintada la condición se corta ANTES
   * de llegar a `puedePreguntar`, que lee `localStorage` y ahí no existe. Eso
   * evita de un plumazo las dos trampas: leer el navegador en el servidor, y
   * enseñarle el instructivo un fotograma a quien ya tiene la app puesta.
   */
  const quiereSalir =
    !cerrado &&
    instalada === false &&
    plataforma === "ios" &&
    puedePreguntar(CLAVE_APLAZADO, CADENCIA_INSTRUCTIVO);

  // Mismo turno que el de Android: nunca coinciden, pero comparten prioridad.
  const visible = useTurnoDeAviso("instalar-ios", PRIORIDAD.instalar, quiereSalir);

  function noAhora() {
    aplazar(CLAVE_APLAZADO);
    setCerrado(true);
  }

  if (!visible) return null;

  return (
    <PanelModal
      titulo={t("title")}
      cuerpo={t("body")}
      textoDescartar={t("later")}
      onDescartar={noAhora}
      icono={<IconoCompartir />}
    >
      {/* Los CUATRO pasos, dibujados.
          ⚠️ Empieza por abrir Safari, y no es relleno: desde Chrome o Firefox de
          iPhone los otros tres pasos existen igual pero NO dejan una app de
          verdad, así que quien lo intente desde ahí se queda a medias creyendo
          que lo hizo bien. Antes esto era un recuadro de aviso encima, y un
          requisito escrito en un recuadro se lee como una nota; un paso numerado
          con su dibujo se hace.

          Y son cuatro y no tres porque en el Safari actual el botón de compartir
          NO está en la barra de abajo: ahí hay atrás, la dirección y tres
          puntos, y compartir vive dentro de ese menú.

          Los dibujos son SVG y no recortes de captura a propósito: una captura
          se queda en un idioma, en un tamaño y en una versión de iOS, y además
          arrastraría lo que hubiera en la pantalla de quien la tomó. */}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 24 }}>
        <li style={{ display: "grid", gap: 10 }}>
          <span style={ESTILO_PASO}>
            <Paso n={1} />
            {t("step1")}
          </span>

          {/* El icono de Safari, suelto. Sin caja y sin repetir la palabra: el
              rótulo del paso ya dice Safari, y el icono está para reconocerlo de
              un vistazo, no para volver a nombrarlo.

              Centrado, como los dibujos de los otros tres pasos, que ocupan todo
              el ancho. Así los cuatro comparten el mismo eje. */}
          <div
            aria-hidden="true"
            style={{ display: "flex", justifyContent: "center", paddingBlock: 2 }}
          >
            <IconoSafari size={44} />
          </div>
        </li>

        <li style={{ display: "grid", gap: 10 }}>
          <span style={ESTILO_PASO}>
            <Paso n={2} />
            {t("step2")}
          </span>

          {/* La barra de abajo de Safari, tal cual: atrás, la píldora de la
              dirección, y los tres puntos señalados. */}
          <div
            aria-hidden="true"
            style={{
              ...MAQUETA,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 8px",
              color: APAGADO,
            }}
          >
            <span style={CIRCULO}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                height: 24,
                borderRadius: 999,
                background: "rgba(255,255,255,0.07)",
                fontSize: 10,
                color: "rgba(255,255,255,0.45)",
              }}
            >
              vibraon.com
            </span>

            {/* El señalado, en BLANCO y no en morado.
                Aquí el morado competía con el propio dibujo, que ya va en grises:
                el anillo tiene que decir "esto" y nada más. El blanco es el
                contraste más alto que hay sobre negro, así que señala sin
                aportar un color que haya que interpretar. */}
            <span
              style={{
                ...CIRCULO,
                width: 26,
                height: 26,
                color: "#fff",
                background: "rgba(255,255,255,0.16)",
                boxShadow: "0 0 0 2px #ffffff",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5.5" cy="12" r="1.9" />
                <circle cx="12" cy="12" r="1.9" />
                <circle cx="18.5" cy="12" r="1.9" />
              </svg>
            </span>
          </div>
        </li>

        <li style={{ display: "grid", gap: 10 }}>
          <span style={ESTILO_PASO}>
            <Paso n={3} />
            {t("step3")}
          </span>

          {/* SOLO la fila de Compartir, dibujada como la de Safari.
              Las filas de relleno que había debajo sobraban: en los otros pasos
              dan contexto porque hay que encontrar algo dentro de una lista,
              pero aquí Compartir es la primera opción del menú y se reconoce
              sola. Enseñar vecinas inventadas solo añadía ruido.

              Fondo gris oscuro de iOS y no morado; el anillo blanco es lo que
              señala, igual que en el paso anterior. */}
          <div
            aria-hidden="true"
            style={FILA_IOS}
          >
            <IconoCompartir size={17} />
            <span>{t("shareLabel")}</span>
          </div>
        </li>

        <li style={{ display: "grid", gap: 10 }}>
          <span style={ESTILO_PASO}>
            <Paso n={4} />
            {t("step4")}
          </span>

          {/* Igual que el paso anterior: la opción sola, sin vecinas de relleno.
              Que esté abajo del todo de la hoja lo dice el rótulo del paso, no
              hace falta dibujar la lista entera para insinuarlo. */}
          <div aria-hidden="true" style={FILA_IOS}>
            {/* Cuadrado con un más, el icono de iOS para esta opción. */}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 style={{ flexShrink: 0 }}>
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <span>{t("addToHomeScreen")}</span>
          </div>
        </li>
      </ol>
    </PanelModal>
  );
}
