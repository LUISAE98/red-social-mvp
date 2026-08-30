"use client";

// Los nombres de país que se enseñan al usuario, resueltos por el navegador.
//
// 👉 Las dos listas se DERIVAN de las constantes que mandan de verdad. Ni una sola vive
//    escrita a mano en `messages/`: el día que se agregue un país a la tabla de impuestos o
//    a la de rutas de cobro, el FAQ lo dice solo. Escribirlos en los 47 idiomas habría
//    creado 47 copias que se desincronizan a la primera alta, que es justo la clase de
//    mentira que este repo lleva semanas limpiando.

import { useMemo, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { intlLocale } from "@/i18n/locales";
import { COUNTRY_TAX_CONFIG } from "@/lib/tax/config";
import {
  PAYOUT_TERMS_BY_COUNTRY,
  PAYOUT_COUNTRY_ALIAS,
} from "@/lib/wallet/payoutTiers";

/**
 * Dónde se puede COMPRAR.
 *
 * Toda fila de la tabla de impuestos es un sitio cobrable — un país sin fila no vende. No
 * hace falta filtrar por `collectionMode`, que solo dice QUIÉN cobra el impuesto, no si se
 * puede vender.
 */
export const BUYABLE_COUNTRIES: readonly string[] = Object.freeze(
  Object.keys(COUNTRY_TAX_CONFIG)
);

/**
 * Dónde el creador puede COBRAR.
 *
 * ⚠️ Es la UNIÓN de las dos constantes, no solo la primera. Puerto Rico y las Islas
 * Vírgenes de EE. UU. cobran por la ruta de Estados Unidos, y Canarias y Ceuta y Melilla
 * por la de España. No tienen fila propia en `PAYOUT_TERMS_BY_COUNTRY`, pero cobrar,
 * cobran, y dejarlos fuera de la lista sería decirle a un creador de Canarias que no puede
 * cuando sí puede.
 */
export const PAYABLE_COUNTRIES: readonly string[] = Object.freeze([
  ...new Set([
    ...Object.keys(PAYOUT_TERMS_BY_COUNTRY),
    ...Object.keys(PAYOUT_COUNTRY_ALIAS),
  ]),
]);

/**
 * Los que se piden en su forma CORTA.
 *
 * En su forma larga, CLDR devuelve el nombre administrativo completo, y queda ilegible en
 * mitad de una lista corrida — "RAE de Hong Kong (China)" en español, "Sonderverwaltungs-
 * region Hongkong" en alemán, "中華人民共和国香港特別行政区" en japonés. La forma corta da
 * "Hong Kong", "Hongkong" y "香港" en los 47 idiomas.
 *
 * Es deliberadamente diminuta y NO se usa para todos. En la mayoría la forma corta es una
 * abreviatura ("EE. UU.", "RU", "É.-U.") que en una lista se lee peor que el nombre entero.
 *
 * Macao todavía no está en ninguna de las dos listas; va aquí para que el día que entre no
 * aparezca con el nombre largo.
 */
const NOMBRE_CORTO = new Set(["HK", "MO"]);

/**
 * Los códigos, en nombres del idioma pedido, ordenados y separados por comas.
 *
 * Devuelve `null` si el navegador no sabe hacerlo, para que quien llame pueda enseñar la
 * frase sin la lista en vez de una ristra de códigos ISO.
 */
export function formatCountryNames(
  codes: readonly string[],
  locale: string
): string | null {
  try {
    // ⚠️ El "en" del final no sobra. `dv` (dhivehi) es el único de los 47 sin datos de
    // región, y sin una cadena de respaldo explícita el navegador cae en LO QUE TENGA
    // configurado el visitante: en una prueba salieron los nombres en es-MX. Con el "en"
    // detrás, quien lea en dhivehi ve la lista en inglés siempre, que será pobre pero es
    // igual para todos y explicable.
    const pedido = intlLocale(locale);
    const largo = new Intl.DisplayNames([pedido, "en"], { type: "region" });
    const corto = new Intl.DisplayNames([pedido, "en"], {
      type: "region",
      style: "short",
    });

    const nombres = codes.map(
      (c) => (NOMBRE_CORTO.has(c) ? corto.of(c) : largo.of(c)) ?? c
    );

    // Se ordena con el idioma en el que de verdad salieron los nombres, no con el que se
    // pidió: en dhivehi son ingleses, y ordenarlos con reglas dhivehi no querría decir nada.
    const idiomaReal = largo.resolvedOptions().locale;
    return nombres
      .sort((a, b) => a.localeCompare(b, idiomaReal))
      .join(", ");
  } catch {
    return null;
  }
}

/** Suscripción vacía: el valor no cambia nunca, solo importa servidor vs navegador. */
const SIN_CAMBIOS = () => () => {};

/**
 * Lo mismo, pero solo después de hidratar.
 *
 * ⚠️ En el servidor devuelve `null` A PROPÓSITO. Los nombres salen de la ICU de quien
 * ejecuta, y la de Node no es la del navegador del visitante: CLDR cambia nombres entre
 * versiones, así que pintar la lista en el servidor y volver a pintarla en el cliente es
 * pedir un desajuste de hidratación sobre un texto de casi dos mil caracteres.
 *
 * Se resuelve con `useSyncExternalStore` y no con estado dentro de un efecto porque en este
 * repo `react-hooks/set-state-in-effect` es un ERROR, no un aviso.
 */
export function useCountryNameList(codes: readonly string[]): string | null {
  const locale = useLocale();
  const hidratado = useSyncExternalStore(
    SIN_CAMBIOS,
    () => true,
    () => false
  );
  return useMemo(
    () => (hidratado ? formatCountryNames(codes, locale) : null),
    [codes, locale, hidratado]
  );
}
