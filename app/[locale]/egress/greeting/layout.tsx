// Metadata SSR para la plantilla de grabación de saludos/consejos.
//
// El grabador de LiveKit corre un Chrome real (pantalla virtual, no headless
// puro). Como el texto horneado está en español, Chrome ofrecía TRADUCIR la
// página y horneaba el panel de Google Translate sobre la esquina del video.
//
// La meta `<meta name="google" content="notranslate">` desactiva esa oferta,
// pero DEBE estar en el <head> desde la carga inicial — un useEffect llega tarde
// (Chrome ya decidió mostrar el panel). Por eso va aquí, en un server component.

import type { Metadata } from "next";

export const metadata: Metadata = {
  other: { google: "notranslate" },
};

export default function GreetingEgressLayout({ children }: { children: React.ReactNode }) {
  return children;
}
