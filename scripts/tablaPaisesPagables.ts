// Genera `docs/paises-pagables.tsv`: los 89 países a los que se le puede pagar a un creador,
// con todo lo que le aplica en una sola fila.
//
// Se ejecuta con:  npx tsx scripts/tablaPaisesPagables.ts
//
// 🚨 **Todo sale de las tablas reales, nada está escrito a mano aquí.** El idioma usa la MISMA
// función que el middleware (`localeFromCountry`), y la comisión y el mínimo salen de
// `payoutTiers`, que es lo que congela el ledger. Una tabla escrita a mano se desincroniza el
// primer día que alguien cambia un país y nadie se entera hasta que un creador reclama.

import { writeFileSync } from "node:fs";
import { localeFromCountry } from "@/i18n/localeFromCountry";
import { COUNTRY_TAX_CONFIG } from "@/lib/tax/config";
import {
  PAYOUT_TERMS_BY_COUNTRY,
  PAYOUT_COUNTRY_ALIAS,
  type PayoutTerms,
} from "@/lib/wallet/payoutTiers";

const NOMBRE: Record<string, string> = {
  MX: "México", US: "Estados Unidos", CA: "Canadá", CR: "Costa Rica",
  DO: "República Dominicana", PE: "Perú", TT: "Trinidad y Tobago", JM: "Jamaica",
  EC: "Ecuador", SV: "El Salvador", GT: "Guatemala", PA: "Panamá", LC: "Santa Lucía",
  AG: "Antigua y Barbuda", AR: "Argentina", BR: "Brasil", BO: "Bolivia", CO: "Colombia",
  CL: "Chile", UY: "Uruguay", PY: "Paraguay", HN: "Honduras", PR: "Puerto Rico",
  VI: "Islas Vírgenes de EE. UU.",
  AT: "Austria", BE: "Bélgica", BG: "Bulgaria", CY: "Chipre", CZ: "Chequia",
  DE: "Alemania", DK: "Dinamarca", EE: "Estonia", ES: "España", FI: "Finlandia",
  FR: "Francia", GR: "Grecia", HR: "Croacia", HU: "Hungría", IE: "Irlanda", IT: "Italia",
  LT: "Lituania", LU: "Luxemburgo", LV: "Letonia", MT: "Malta", NL: "Países Bajos",
  PL: "Polonia", PT: "Portugal", RO: "Rumanía", SE: "Suecia", SI: "Eslovenia",
  SK: "Eslovaquia", NO: "Noruega", IS: "Islandia", GB: "Reino Unido", MC: "Mónaco",
  SM: "San Marino", BA: "Bosnia y Herzegovina", RS: "Serbia", AL: "Albania",
  MD: "Moldavia", TR: "Turquía", IC: "Islas Canarias", EA: "Ceuta y Melilla",
  JP: "Japón", TW: "Taiwán", HK: "Hong Kong", SG: "Singapur", MY: "Malasia",
  TH: "Tailandia", PH: "Filipinas", ID: "Indonesia", VN: "Vietnam", KH: "Camboya",
  LK: "Sri Lanka", BT: "Bután", BN: "Brunéi", MN: "Mongolia",
  AE: "Emiratos Árabes Unidos", QA: "Catar", KW: "Kuwait", JO: "Jordania",
  MA: "Marruecos", EG: "Egipto", ZA: "Sudáfrica", NG: "Nigeria", BW: "Botsuana",
  CI: "Costa de Marfil", AU: "Australia", NZ: "Nueva Zelanda",
};

function metodoDe(x: PayoutTerms): string {
  if (x.route === "wallbit") {
    return x.soloDolares
      ? "Wallbit, solo dólares (sin retiro a banco local)"
      : "Wallbit, con retiro a banco local";
  }
  return x.tier === "expensive"
    ? "Stripe, transferencia internacional"
    : "Stripe, transferencia local";
}

/**
 * El idioma que se le sirve.
 *
 * ⚠️ Canadá devuelve `null` A PROPÓSITO: inglés y francés son cooficiales y ahí decide el
 * navegador, no el país. Se marca como tal en vez de inventarle uno.
 */
function idiomaDe(codigo: string): string {
  return localeFromCountry(codigo) ?? "según el navegador";
}

type Fila = {
  codigo: string; pais: string; moneda: string; idioma: string;
  tasa: number; impuesto: string; comision: number; minimo: number; metodo: string;
};

const filas: Fila[] = [];

for (const [codigo, terms] of Object.entries(PAYOUT_TERMS_BY_COUNTRY)) {
  const fiscal = COUNTRY_TAX_CONFIG[codigo];
  if (!fiscal) throw new Error(`sin ficha fiscal: ${codigo}`);
  if (!NOMBRE[codigo]) throw new Error(`sin nombre: ${codigo}`);
  filas.push({
    codigo,
    pais: NOMBRE[codigo],
    moneda: fiscal.currency,
    idioma: idiomaDe(codigo),
    tasa: fiscal.taxRate,
    impuesto: fiscal.taxRate > 0 ? fiscal.taxName : "Sin impuesto",
    comision: terms.commissionRate,
    minimo: terms.minWithdrawalUsd,
    metodo: metodoDe(terms),
  });
}

// Los territorios que cobran con la cuenta de otro país heredan sus condiciones.
for (const [codigo, matriz] of Object.entries(PAYOUT_COUNTRY_ALIAS)) {
  const fiscal = COUNTRY_TAX_CONFIG[codigo];
  const terms = PAYOUT_TERMS_BY_COUNTRY[matriz];
  if (!fiscal || !terms) throw new Error(`alias incompleto: ${codigo}`);
  filas.push({
    codigo,
    pais: NOMBRE[codigo],
    moneda: fiscal.currency,
    idioma: idiomaDe(codigo),
    tasa: fiscal.taxRate,
    impuesto: fiscal.taxRate > 0 ? fiscal.taxName : "Sin impuesto",
    comision: terms.commissionRate,
    minimo: terms.minWithdrawalUsd,
    metodo: `Cuenta de ${NOMBRE[matriz]}`,
  });
}

filas.sort((a, b) => a.pais.localeCompare(b.pais, "es"));

// Coma decimal y sin decimales cuando es entero, que es como lo lee Excel en español.
const pct = (n: number) => {
  const v = n * 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",")) + "%";
};

const CABECERA = [
  "Código", "País", "Moneda", "Idioma", "Tasa de impuesto", "Nombre del impuesto",
  "Comisión de Vibra", "Mínimo de retiro (USD)", "Método de retiro",
];

const lineas = filas.map((f) =>
  [f.codigo, f.pais, f.moneda, f.idioma, pct(f.tasa), f.impuesto, pct(f.comision), String(f.minimo), f.metodo]
    .join("\t")
);

// BOM para que Excel abra los acentos bien, y CRLF porque es lo que espera en Windows.
writeFileSync(
  "docs/paises-pagables.tsv",
  "﻿" + CABECERA.join("\t") + "\r\n" + lineas.join("\r\n") + "\r\n",
  "utf8"
);

console.log(`filas: ${filas.length}`);
const porMetodo = new Map<string, number>();
for (const f of filas) porMetodo.set(f.metodo, (porMetodo.get(f.metodo) ?? 0) + 1);
for (const [m, n] of porMetodo) console.log(`  ${n}  ${m}`);
