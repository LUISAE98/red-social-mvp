"use client";

import { useState } from "react";

import VibraResponsivePanel from "./VibraResponsivePanel";
import WheelColumn, { WHEEL_HEIGHT, type WheelItem } from "./WheelColumn";

/**
 * Selector de fecha con tres tambores: día, mes y año.
 *
 * Sustituye a las tres listas desplegables. En celular, una lista de cien años
 * obliga a un desplazamiento largo dentro de una ventanita del sistema; aquí se
 * gira con el dedo y el valor se lee en la banda del centro.
 *
 * Los días se recortan al mes y al año elegidos —febrero de un año bisiesto
 * tiene 29 y de uno normal 28—, y si el día que estaba puesto ya no existe, baja
 * al último del mes en vez de quedarse en una fecha imposible.
 *
 * No usa claves de idioma propias: los textos llegan por props, porque el
 * componente lo pueden montar pantallas que viven en distintos espacios de
 * nombres.
 */

export type DateWheelValue = { day: string; month: string; year: string };

export function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  const bisiesto = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return bisiesto ? 29 : 28;
}

export default function DateWheelPanel({
  open,
  onClose,
  onConfirm,
  value,
  months,
  years,
  title,
  labels,
  defaultYear,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (next: DateWheelValue) => void;
  /** Lo que hay puesto al abrir. Vacío = se arranca en un valor razonable. */
  value: DateWheelValue;
  /** Meses ya traducidos por quien llama; `value` es "1".."12". */
  months: WheelItem[];
  /** Años admitidos, en el orden en que se quieren ver (de menor a mayor). */
  years: number[];
  /** En qué año se abre cuando no hay fecha puesta. */
  defaultYear?: number;
  title: string;
  labels: {
    day: string;
    month: string;
    year: string;
    confirm: string;
    closeAria: string;
  };
}) {
  /**
   * Sin fecha previa hay que arrancar en algún sitio, y el extremo de la lista
   * es el peor: obliga a girar cien años. Se arranca en `defaultYear`, que queda
   * centrado y deja a la mitad de la gente girando hacia arriba y a la otra
   * mitad hacia abajo.
   */
  const seed = (v: DateWheelValue): DateWheelValue => ({
    day: v.day || "1",
    month: v.month || "1",
    year:
      v.year ||
      String(
        defaultYear && years.includes(defaultYear)
          ? defaultYear
          : (years[Math.floor(years.length / 2)] ?? years[0] ?? "")
      ),
  });

  /**
   * Borrador propio: girar la rueda no debe tocar el formulario de fuera hasta
   * confirmar, así que cerrar sin aceptar deja la fecha como estaba.
   *
   * Se siembra una sola vez y se rehace al CANCELAR, que es un evento, no
   * dentro de un efecto que persiga al valor de fuera. Sincronizar estado con
   * estado a través de un efecto provoca un render de más con el valor viejo
   * pintado en medio.
   */
  const [draft, setDraft] = useState<DateWheelValue>(() => seed(value));

  function cancel() {
    setDraft(seed(value));
    onClose();
  }

  const maxDay = daysInMonth(Number(draft.year), Number(draft.month));

  const dayItems: WheelItem[] = Array.from({ length: maxDay }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  const yearItems: WheelItem[] = years.map((y) => ({
    value: String(y),
    label: String(y),
  }));

  /**
   * El día se recorta en cuanto deja de existir en el mes elegido: pasar de
   * marzo 31 a febrero tiene que dejar 28 o 29, no un 31 imposible.
   *
   * Se CALCULA, no se guarda corregido con un efecto. Guardarlo obligaría a un
   * render extra con la fecha imposible pintada en medio, y el día original se
   * perdería: volver a marzo tiene que devolver el 31, no dejarlo en 29.
   */
  const safeDay = String(Math.min(Number(draft.day) || 1, maxDay));

  return (
    <VibraResponsivePanel
      open={open}
      onClose={cancel}
      ariaLabel={title}
      maxWidthDesktop={420}
      // Sin caja: las ruedas y el botón flotan.
      bareSurface
      /* Sin cabecera. El título y el botón se pintan DENTRO del contenido, para
         que queden bajo el mismo oscurecido: si se quedaran en la cabecera y en
         el pie del panel, caerían fuera del degradado y se leerían sobre la
         página, sin nada detrás. */
      hideHeader
      /* La página de detrás NO se apaga. Quien oscurece es el propio panel, con
         un degradado que se desvanece hacia afuera, así que el sitio sigue a la
         vista alrededor en vez de quedar tapado por una cortina. */
      backdrop="none"
    >
      <div
        style={{
          display: "grid",
          gap: 8,
          /* El oscurecido propio. Es elíptico y arranca a apagarse antes de
             llegar al borde, así que no deja un canto duro contra la página:
             el panel se funde con lo que hay detrás en vez de recortarse.
             Va con relleno generoso para que el degradado tenga por dónde
             apagarse sin comerse las ruedas. */
          margin: -20,
          padding: 20,
          background:
            "radial-gradient(120% 100% at 50% 50%, rgba(6,6,9,0.94) 0%, rgba(6,6,9,0.88) 42%, rgba(6,6,9,0.55) 72%, rgba(6,6,9,0) 100%)",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 650,
            color: "#fff",
            textAlign: "center",
            marginBottom: 2,
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.6fr 1fr",
            gap: 4,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "rgba(255,255,255,0.42)",
            textAlign: "center",
          }}
        >
          <span>{labels.day}</span>
          <span>{labels.month}</span>
          <span>{labels.year}</span>
        </div>

        <div style={{ position: "relative", height: WHEEL_HEIGHT }}>
          {/* Sin banda en el centro. Lo que marca el valor elegido es el propio
              renglón: va en blanco y más grueso, mientras los de alrededor
              quedan grises y se apagan hacia los extremos. */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: "1fr 1.6fr 1fr",
              gap: 4,
            }}
          >
            <WheelColumn
              items={dayItems}
              value={safeDay}
              onChange={(day) => setDraft((prev) => ({ ...prev, day }))}
              ariaLabel={labels.day}
            />
            {/* El único cíclico de los tres: tras diciembre viene enero, y
                antes de enero, diciembre. */}
            <WheelColumn
              items={months}
              value={draft.month}
              onChange={(month) => setDraft((prev) => ({ ...prev, month }))}
              ariaLabel={labels.month}
              loop
            />
            <WheelColumn
              items={yearItems}
              value={draft.year}
              onChange={(year) => setDraft((prev) => ({ ...prev, year }))}
              ariaLabel={labels.year}
            />
          </div>
        </div>

        {/* Solo guardar. Para salir sin cambios están el toque fuera, el
            arrastre hacia abajo y la tecla Esc. */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
          <button
            type="button"
            onClick={() => onConfirm({ ...draft, day: safeDay })}
            style={{
              width: "min(240px, 100%)",
              minHeight: 42,
              borderRadius: 5,
              border: "none",
              background: "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              fontFamily: "inherit",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            {labels.confirm}
          </button>
        </div>
      </div>
    </VibraResponsivePanel>
  );
}
