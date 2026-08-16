import { notFound } from "next/navigation";

import AvisosCatalogo from "./components/AvisosCatalogo";

/**
 * Catálogo interno de los avisos de error y acierto.
 *
 * Herramienta de trabajo para unificarlos: no es una pantalla del producto, así
 * que no existe en producción.
 */
export default function EstilosAvisosPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AvisosCatalogo />;
}
