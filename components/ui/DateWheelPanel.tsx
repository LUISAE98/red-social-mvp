"use client";

import { useState } from "react";

import WheelPanel, { type WheelPanelColumn } from "./WheelPanel";
import type { WheelItem } from "./WheelColumn";

/**
 * Selector de fecha con tres tambores: día, mes y año.
 *
 * Sustituye a las tres listas desplegables. En celular, una lista de cien años
 * obliga a un desplazamiento largo dentro de una ventanita del sistema; aquí se
 * gira con el dedo y el valor elegido se lee en el centro.
 *
 * Es una especialización de `WheelPanel`: lo único que aporta es saber de
 * calendario —cuántos días tiene cada mes— y armar las tres columnas.
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

/** Columnas de día y año a partir del mes y el año que estén girados. */
export function buildDayItems(year: number, month: number): WheelItem[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));
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

  /**
   * El día se recorta en cuanto deja de existir en el mes elegido: pasar de
   * marzo 31 a febrero tiene que dejar 28 o 29, no un 31 imposible.
   *
   * Se CALCULA, no se guarda corregido con un efecto. Guardarlo obligaría a un
   * render extra con la fecha imposible pintada en medio, y el día original se
   * perdería: volver a marzo tiene que devolver el 31, no dejarlo en 29.
   */
  const safeDay = String(Math.min(Number(draft.day) || 1, maxDay));

  const columns: WheelPanelColumn[] = [
    {
      key: "day",
      label: labels.day,
      items: buildDayItems(Number(draft.year), Number(draft.month)),
      value: safeDay,
      onChange: (day) => setDraft((prev) => ({ ...prev, day })),
    },
    {
      key: "month",
      label: labels.month,
      items: months,
      value: draft.month,
      onChange: (month) => setDraft((prev) => ({ ...prev, month })),
      // El único cíclico: tras diciembre viene enero, y antes de enero,
      // diciembre.
      loop: true,
      flex: 1.6,
    },
    {
      key: "year",
      label: labels.year,
      items: years.map((y) => ({ value: String(y), label: String(y) })),
      value: draft.year,
      onChange: (year) => setDraft((prev) => ({ ...prev, year })),
    },
  ];

  return (
    <WheelPanel
      open={open}
      onClose={cancel}
      onConfirm={() => onConfirm({ ...draft, day: safeDay })}
      title={title}
      confirmLabel={labels.confirm}
      closeAriaLabel={labels.closeAria}
      columns={columns}
    />
  );
}
