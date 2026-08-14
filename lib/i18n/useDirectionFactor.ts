"use client";

import { useLocale } from "next-intl";

import { localeDir } from "@/i18n/locales";

/**
 * +1 si se lee de izquierda a derecha, -1 si es de derecha a izquierda.
 *
 * Para lo que NO se voltea solo. Las propiedades lógicas (`margin-inline-start`,
 * `inset-inline-end`…) se encargan del espejado ellas mismas en cuanto el `<html>`
 * lleva `dir="rtl"`, y ese es siempre el camino preferido. Pero hay dos cosas que
 * quedan fuera de ese mecanismo:
 *
 *  · `translateX`, que es geometría pura y no tiene versión lógica.
 *  · el gesto, cuyo `clientX` llega en píxeles físicos de la pantalla.
 *
 * En un carrusel las dos tienen que voltearse A LA VEZ. Si se voltea solo el CSS,
 * el contenido se mueve al revés que el dedo, que es peor que no espejar nada.
 *
 * La forma de usarlo: guardar el desplazamiento del gesto en LÓGICO
 * (`(clientX - startX) * factor`), dejar la lógica de umbrales y topes tal cual
 * —ya está escrita en términos lógicos— y volver a multiplicar por el factor solo
 * al pintar el `translateX`. Un único cruce entre los dos mundos, en el borde.
 *
 * El equivalente en CSS puro, para animaciones sin gesto, es la variable
 * `--vb-dir` de `globals.css`.
 */
export function useDirectionFactor(): 1 | -1 {
  return localeDir(useLocale()) === "rtl" ? -1 : 1;
}
