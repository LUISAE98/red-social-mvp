import { notFound } from "next/navigation";

import SimuladorBotones from "./components/SimuladorBotones";

/**
 * Simulador de los botones reales de la plataforma.
 *
 * Hermano de `/estilos-avisos`: no dibuja copias, monta el componente REAL con
 * sus props reales. Lo que se ve en la tabla es exactamente lo que ve el
 * usuario, y si el componente cambia, la tabla cambia con él.
 *
 * Herramienta de trabajo, no pantalla de producto: no existe en producción.
 */
export default function SimuladorBotonesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SimuladorBotones />;
}
