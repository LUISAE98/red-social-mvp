import { notFound } from "next/navigation";

import LienzoPanel from "../components/LienzoPanel";

/**
 * El lienzo: lo que se ve DENTRO de cada pantalla del banco de trabajo.
 *
 * Es una ruta propia, y no un componente que se monte en la página de al lado,
 * por una razón concreta: cada pantalla del simulador es un <iframe>, y un
 * iframe necesita una URL. Ver la explicación larga en SimuladorPaneles.
 */
export default function LienzoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LienzoPanel />;
}
