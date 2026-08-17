import { notFound } from "next/navigation";

import ComparadorFirmas from "../components/ComparadorFirmas";

/**
 * Antes y después de las 451 pintas de botón, para aprobar la estandarización.
 *
 * Hermana de `/simulador-botones`: aquella monta los componentes reales, esta
 * compara cómo se ve hoy cada firma contra cómo se vería con el sistema
 * propuesto. No cambia nada del producto.
 *
 * Herramienta de trabajo: no existe en producción.
 */
export default function CompararBotonesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ComparadorFirmas />;
}
