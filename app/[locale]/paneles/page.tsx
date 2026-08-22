import { notFound } from "next/navigation";

import SimuladorPaneles from "./components/SimuladorPaneles";

/**
 * Banco de trabajo para diseñar el panel de Vibra.
 *
 * Hermano de lo que fueron `/simulador-botones` y `/estilos-avisos`, con la
 * misma regla que aquellos: no dibuja maquetas, monta el componente REAL. Una
 * maqueta se desincroniza del producto en dos semanas; un catálogo que monta lo
 * de verdad no puede mentir.
 *
 * No es una pantalla del producto, así que no existe en producción.
 */
export default function PanelesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SimuladorPaneles />;
}
