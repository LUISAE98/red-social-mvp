import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parse as parseIcu } from "@formatjs/icu-messageformat-parser";
import {
  LOCALE_META,
  READY_LOCALES,
  EU_COUNTRY_TO_LOCALE,
  NON_EU_COUNTRY_TO_LOCALE,
  nearestReadyLocale,
  intlLocale,
  isReadyLocale,
  RTL_LOCALES,
  localeDir,
} from "@/i18n/locales";
import { localeFromCountry } from "@/i18n/localeFromCountry";
import { routing } from "@/i18n/routing";

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

/** Aplana un objeto de mensajes a la lista de sus rutas de clave hoja. */
function leafKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k)
  );
}

// Precargado a nivel de módulo, no dentro de los tests, y a propósito.
// Seis de estos tests recorren TODOS los locales. Parsear los 46 archivos cuesta
// ~3 s (los de escritura no latina rondan los 270 KB), y si ese coste cae dentro
// de un `it()` se lo come entero el primero que los toque: pasaba del timeout de
// 5 s de Vitest y fallaba con "Test timed out", que se lee como si una traducción
// estuviera rota y no como lentitud. Fuera de los tests, el mismo trabajo cuenta
// como tiempo de carga del archivo y ningún test individual lo paga.
const MESSAGES: ReadonlyMap<string, unknown> = new Map(
  READY_LOCALES.map((code) => [
    code,
    JSON.parse(readFileSync(root(`messages/${code}.json`), "utf8")) as unknown,
  ])
);

/** Claves hoja por locale, también precalculadas: aplanar 46 árboles cuesta otro medio segundo. */
const LEAF_KEYS: ReadonlyMap<string, string[]> = new Map(
  [...MESSAGES].map(([code, msgs]) => [code, leafKeys(msgs).sort()])
);

function readMessages(locale: string): unknown {
  const hit = MESSAGES.get(locale);
  if (hit === undefined) throw new Error(`messages/${locale}.json no está precargado`);
  return hit;
}

// El idioma es la capa donde un error no rompe el build: falla en silencio y el
// usuario ve una clave cruda ("wallet.withdraw.confirm") en una pantalla de dinero.
describe("i18n / catálogo de idiomas", () => {
  it("cada locale servido tiene su archivo messages/{code}.json", () => {
    for (const code of READY_LOCALES) {
      expect(existsSync(root(`messages/${code}.json`)), `falta messages/${code}.json`).toBe(true);
    }
  });

  it("READY_LOCALES y la bandera `ready` de LOCALE_META dicen lo mismo", () => {
    const flagged = LOCALE_META.filter((m) => m.ready).map((m) => m.code).sort();
    expect(flagged).toEqual([...READY_LOCALES].sort());
  });

  it("todo locale servido existe en LOCALE_META y no hay códigos repetidos", () => {
    const codes = LOCALE_META.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of READY_LOCALES) {
      expect(codes, `${code} no está en LOCALE_META`).toContain(code);
    }
  });

  it("el defaultLocale está entre los servidos", () => {
    expect(isReadyLocale(routing.defaultLocale)).toBe(true);
  });

  // La razón de ser del catálogo: que ningún idioma quede a medias. Una clave que
  // falta en un idioma hace que next-intl muestre la ruta cruda de la clave.
  it("todos los idiomas tienen EXACTAMENTE el mismo juego de claves que en.json", () => {
    const base = LEAF_KEYS.get("en")!;
    expect(base.length).toBeGreaterThan(2000); // sanity: el archivo se leyó de verdad

    // Con Set, no con Array.includes: comparar dos listas de ~2500 claves a
    // fuerza bruta son 6 millones de comparaciones por idioma, y con 45 idiomas
    // eso reventaba el timeout de 5 s de Vitest. El síntoma era "Test timed out",
    // que se lee como si una traducción estuviera rota y no como lentitud.
    const baseSet = new Set(base);

    for (const code of READY_LOCALES) {
      if (code === "en") continue;
      const keys = LEAF_KEYS.get(code)!;
      const keySet = new Set(keys);
      const faltan = base.filter((k) => !keySet.has(k));
      const sobran = keys.filter((k) => !baseSet.has(k));
      expect(faltan, `claves que FALTAN en ${code}.json`).toEqual([]);
      expect(sobran, `claves de MÁS en ${code}.json (no existen en en.json)`).toEqual([]);
    }
  });

  it("no hay archivos en messages/ que nadie sirva", () => {
    const onDisk = readdirSync(root("messages"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(onDisk).toEqual([...READY_LOCALES].sort());
  });

  // Un ICU mal formado (llave sin cerrar, rama plural rota) NO rompe el build:
  // revienta al renderizar la pantalla que usa esa clave.
  it("todas las cadenas son ICU válido en todos los idiomas", () => {
    for (const code of READY_LOCALES) {
      const errores: string[] = [];
      (function walk(o: unknown, path: string) {
        if (typeof o === "string") {
          try {
            parseIcu(o);
          } catch (e) {
            errores.push(`${path}: ${(e as Error).message}`);
          }
          return;
        }
        if (typeof o === "object" && o !== null) {
          for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
        }
      })(readMessages(code), "");
      expect(errores, `ICU inválido en ${code}.json`).toEqual([]);
    }
  });

  // Cada idioma tiene su juego de categorías plurales: inglés y alemán usan 2
  // (one/other), polaco 4 (one/few/many/other), checo y eslovaco 4, lituano 3…
  // Si a un plural le falta una categoría que el idioma usa de verdad, ICU cae en
  // silencio a `other` y sale una forma gramaticalmente mal: «5 dzień» en vez de
  // «5 dni». No se ve revisando el texto: solo aparece con ciertos números.
  //
  // ⚠️ No basta con `resolvedOptions().pluralCategories`: ese listado incluye
  // categorías que solo existen para NOTACIÓN COMPACTA. El `many` del español, francés,
  // italiano y portugués solo se activa en 1.000.000 («1 millón de días») y esta app no
  // usa números compactos, así que `other` da la forma correcta. El `many` del polaco,
  // en cambio, se activa en 5 y sí cambia la palabra. Por eso se calculan las categorías
  // realmente alcanzables con conteos enteros: 0–120 cubre todos los ciclos de módulo
  // (%10 y %100) que usan las lenguas eslavas.
  const categoriasReales = (intl: string) => {
    const pr = new Intl.PluralRules(intl);
    const s = new Set<string>(["other"]); // ICU siempre exige `other`
    for (let n = 0; n <= 120; n++) s.add(pr.select(n));
    return [...s];
  };

  it("cada plural declara todas las categorías que el idioma usa con conteos reales", () => {
    for (const code of READY_LOCALES) {
      const requeridas = categoriasReales(intlLocale(code));
      const fallos: string[] = [];

      (function walk(o: unknown, path: string) {
        if (typeof o === "string") {
          let ast;
          try {
            ast = parseIcu(o);
          } catch {
            return; // el test de ICU válido ya cubre esto
          }
          (function visit(nodes: unknown[]) {
            for (const n of nodes) {
              const node = n as { type?: number; options?: Record<string, { value: unknown[] }> };
              // 6 = plural, 5 = select (select no lleva categorías CLDR).
              if (node.type === 6 && node.options) {
                const declaradas = Object.keys(node.options).filter((k) => !k.startsWith("="));
                const faltan = requeridas.filter((r) => !declaradas.includes(r));
                if (faltan.length) fallos.push(`${path} → falta la categoría "${faltan.join('", "')}"`);
              }
              if (node.options) {
                for (const opt of Object.values(node.options)) visit(opt.value);
              }
              const tag = n as { children?: unknown[] };
              if (tag.children) visit(tag.children);
            }
          })(ast);
          return;
        }
        if (typeof o === "object" && o !== null) {
          for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
        }
      })(readMessages(code), "");

      expect(fallos, `plurales incompletos en ${code}.json (necesita: ${requeridas.join("/")})`)
        .toEqual([]);
    }
  });

  // El riesgo real de los placeholders es UNA sola dirección: que la traducción PIERDA
  // un {price} o un {name} y la pantalla muestre el texto sin el dato.
  //
  // Lo contrario es legítimo y no se marca: un idioma puede necesitar MÁS gramática que
  // el inglés. El español ya usa `{count, plural}` en notifications.verb.follow ("empezó"
  // vs "empezaron") donde el inglés se arregla con una sola forma. Exigir igualdad exacta
  // castigaría a todo idioma con concordancia más rica.
  //
  // Las etiquetas de formato (<vibra>, <amount>, <strong>) sí van en ambos sentidos: una
  // de más que el componente no renderiza hace lanzar a next-intl.
  it("ninguna traducción pierde un placeholder de en.json", () => {
    const en = readMessages("en");
    const ARG = /\{\s*([a-zA-Z0-9_]+)\s*(?:\}|,\s*(?:plural|select|selectordinal|number|date|time)\b)/g;
    const TAG = /<\/?[a-zA-Z]+>/g;
    const args = (s: string) => new Set([...s.matchAll(ARG)].map((m) => m[1]));
    const tags = (s: string) => [...new Set(s.match(TAG) ?? [])].sort().join(",");

    for (const code of READY_LOCALES) {
      if (code === "en") continue;
      const otro = readMessages(code);
      const perdidos: string[] = [];
      (function walk(a: unknown, b: unknown, path: string) {
        if (typeof a === "string") {
          if (typeof b !== "string") return;
          const faltan = [...args(a)].filter((x) => !args(b).has(x));
          if (faltan.length) perdidos.push(`${path} → falta {${faltan.join("}, {")}}`);
          if (tags(a) !== tags(b)) {
            perdidos.push(`${path} → etiquetas en: [${tags(a)}] vs ${code}: [${tags(b)}]`);
          }
          return;
        }
        if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
          for (const k of Object.keys(a)) {
            if (k in (b as object)) {
              walk((a as never)[k], (b as never)[k], path ? `${path}.${k}` : k);
            }
          }
        }
      })(en, otro, "");
      expect(perdidos, `placeholders perdidos en ${code}.json`).toEqual([]);
    }
  });

  // En alfabetos no latinos (griego, y más adelante búlgaro en cirílico) es facilísimo
  // que se cuele un HOMÓGLIFO: una «A» latina donde va una «Α» griega, o una «o» latina
  // en medio de una palabra cirílica. Se ven IDÉNTICAS, así que no se detectan revisando
  // el texto, pero rompen la búsqueda, la ordenación y el renderizado de fuentes.
  //
  // La señal fiable es una PALABRA con mezcla de alfabetos. Las palabras enteramente
  // latinas (Vibra, OBS, KYC, Google) conviven sin problema con texto griego y no se marcan.
  it("ninguna palabra mezcla alfabetos (homóglifos)", () => {
    const LATIN = /\p{Script=Latin}/u;
    const GREEK = /\p{Script=Greek}/u;
    const CYRILLIC = /\p{Script=Cyrillic}/u;

    for (const code of READY_LOCALES) {
      const sospechosas: string[] = [];
      (function walk(o: unknown, path: string) {
        if (typeof o === "string") {
          // Trocea en «palabras» de letras, ignorando placeholders ICU y etiquetas.
          const limpio = o.replace(/\{[^}]*\}/g, " ").replace(/<[^>]*>/g, " ");
          for (const palabra of limpio.split(/[^\p{L}]+/u)) {
            if (!palabra) continue;
            const scripts = [LATIN, GREEK, CYRILLIC].filter((re) => re.test(palabra)).length;
            if (scripts > 1) sospechosas.push(`${path}: «${palabra}»`);
          }
          return;
        }
        if (typeof o === "object" && o !== null) {
          for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
        }
      })(readMessages(code), "");

      expect(sospechosas, `palabras con alfabetos mezclados en ${code}.json`).toEqual([]);
    }
  });

  it("ningún valor traducido quedó vacío", () => {
    for (const code of READY_LOCALES) {
      const msgs = readMessages(code) as Record<string, unknown>;
      const vacias: string[] = [];
      (function walk(o: unknown, path: string) {
        if (typeof o === "string") {
          if (o.trim() === "") vacias.push(path);
          return;
        }
        if (typeof o === "object" && o !== null) {
          for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
        }
      })(msgs, "");
      expect(vacias, `claves vacías en ${code}.json`).toEqual([]);
    }
  });
});

describe("i18n / detección por país", () => {
  it("los 27 países de la UE están mapeados a un idioma", () => {
    expect(Object.keys(EU_COUNTRY_TO_LOCALE)).toHaveLength(27);
  });

  it("todo idioma destino del mapa de la UE existe en el catálogo", () => {
    const codes = new Set(LOCALE_META.map((m) => m.code));
    for (const [cc, loc] of Object.entries(EU_COUNTRY_TO_LOCALE)) {
      expect(codes, `${cc} apunta a "${loc}", que no está en LOCALE_META`).toContain(loc);
    }
  });

  it("un país de la UE con idioma aún no listo cae a un locale SERVIDO, nunca a uno roto", () => {
    for (const cc of Object.keys(EU_COUNTRY_TO_LOCALE)) {
      const resolved = localeFromCountry(cc);
      expect(isReadyLocale(resolved), `${cc} devolvió "${resolved}"`).toBe(true);
    }
  });

  it("Malta recibe maltés, pero Irlanda sigue en inglés a propósito", () => {
    expect(localeFromCountry("ES")).toBe("es");
    // Malta: ya existe mt.json, así que recibe su idioma.
    expect(localeFromCountry("MT")).toBe("mt");
    // Irlanda NO. El irlandés está listo y servible, pero `IE → en` es una
    // decisión de producto, no una carencia: el inglés es la lengua de trabajo
    // de la práctica totalidad de la población. Si alguien "arregla" esto
    // apuntando IE a `ga`, este test se lo dice.
    expect(isReadyLocale("ga")).toBe(true);
    expect(localeFromCountry("IE")).toBe("en");
  });

  it("Portugal recibe pt-PT, y el parentesco con pt-BR sigue en pie", () => {
    // pt-PT ya existe, así que Portugal recibe SU variante y no la brasileña.
    expect(localeFromCountry("PT")).toBe("pt-PT");
    expect(nearestReadyLocale("pt-PT")).toBe("pt-PT");
    // La cadena de parentesco no es decorativa: es la red que evita que, si una de las
    // dos variantes se cayera, sus hablantes acabaran en inglés en vez de en la otra.
    expect(nearestReadyLocale("pt-BR")).toBe("pt-BR");
  });

  it("no toca los países de LatAm ni el resto del mundo", () => {
    expect(localeFromCountry("MX")).toBe("es");
    expect(localeFromCountry("BR")).toBe("pt-BR");
    expect(localeFromCountry("US")).toBe("en");
    // Un país sin idioma propio en Vibra sigue cayendo a inglés. Suiza es el
    // caso de control: no está en la UE y no tiene entrada propia, así que
    // recibe inglés aunque hablen alemán, francés e italiano, que sí servimos.
    expect(localeFromCountry("CH")).toBe("en");
    expect(localeFromCountry(null)).toBeNull();
  });

  /**
   * Regla de producto: un país que NO está registrado recibe inglés. Siempre.
   *
   * Está escrita en la última línea de `localeFromCountry`, que es fácil de
   * perder de vista al añadir países: basta con meter un `return null` o un
   * `switch` que no cubra el caso, y a partir de ahí medio mundo empieza a
   * depender de lo que diga el navegador. Este test lo fija.
   *
   * La lista de abajo son códigos ISO 3166-1 reales que hoy no están en ninguna
   * de las tablas, más basura, más códigos inventados. Si alguien DA DE ALTA uno
   * de estos países, el test falla y hay que sacarlo de aquí — que es
   * exactamente el aviso que se quiere.
   */
  it("un país no registrado recibe inglés, y la basura también", () => {
    const sinRegistrar = [
      "AF", "AM", "BD", "BJ", "BF", "BI", "KM", "CG", "CD", "DJ", "ER", "ET",
      "GM", "GE", "GH", "GN", "KZ", "KE", "KG", "LA", "LS", "LR", "MG", "MW",
      "ML", "MR", "MM", "NA", "NE", "NG", "PG", "RW", "SL", "SB", "SO", "SS",
      "SD", "SZ", "TJ", "TZ", "TG", "TM", "UG", "UZ", "YE", "ZM", "ZW", "BT",
      "PS", "IQ", "SY", "LY", "TD", "CF", "GA", "SN", "CM", "BW", "MU", "SC",
      "FJ", "KI", "NR", "PW", "FM", "MH", "CK", "NU", "TK", "AS", "GU", "MP",
      "VI", "AI", "AG", "BS", "BB", "BZ", "BM", "VG", "KY", "DM", "GD", "GY",
      "JM", "MS", "KN", "LC", "VC", "TT", "TC",
    ];
    const distintos = sinRegistrar
      .map((cc) => [cc, localeFromCountry(cc)] as const)
      .filter(([, loc]) => loc !== "en")
      .map(([cc, loc]) => `${cc}→${String(loc)}`);
    expect(
      distintos,
      "o se dieron de alta (sácalos de la lista) o se rompió el respaldo a inglés",
    ).toEqual([]);

    // Códigos que no existen y entradas mal formadas: mismo destino.
    for (const basura of ["ZZ", "XX", "QQ", "aa", "  ", "1", "esp"]) {
      expect(localeFromCountry(basura), `${JSON.stringify(basura)}`).toBe("en");
    }

    // Distinto caso, a propósito: aquí NO sabemos el país (no llegó la cabecera),
    // no es que el país no esté registrado. Devolver null deja que decida el
    // Accept-Language del navegador, que es mejor información que ninguna, y si
    // su idioma tampoco lo servimos el defaultLocale ya es inglés. Ver Canadá.
    expect(localeFromCountry(null)).toBeNull();
    expect(localeFromCountry(undefined)).toBeNull();
    expect(localeFromCountry("")).toBeNull();
  });

  it("un país de fuera de la UE con idioma propio lo recibe", () => {
    // Japón es el primero. Va por NON_EU_COUNTRY_TO_LOCALE, no por el mapa de la UE.
    expect(localeFromCountry("JP")).toBe("ja");
    for (const [cc, loc] of Object.entries(NON_EU_COUNTRY_TO_LOCALE)) {
      expect(
        isReadyLocale(loc),
        `${cc} apunta a "${loc}", que no está servido`
      ).toBe(true);
      expect(
        EU_COUNTRY_TO_LOCALE[cc],
        `${cc} está en los DOS mapas; debe estar solo en uno`
      ).toBeUndefined();
    }
  });

  it("un país reutiliza un idioma que ya servíamos en vez de caer a inglés", () => {
    // Ninguno de estos trajo traducción propia: aprovechan una que ya existía.
    // Se comprueban uno a uno, y no con el bucle de arriba, porque el bucle valida
    // que el mapa sea COHERENTE, no que estas entradas SIGAN estando. Se perdieron
    // una vez y el síntoma —el usuario ve inglés— se lee como comportamiento
    // normal, no como fallo; por eso no basta con una comprobación genérica.
    const REUSED: Record<string, string> = {
      MD: "ro", // Moldavia
      ME: "bs", // Montenegro
      HK: "zh-TW", // Hong Kong
      IC: "es", // Canarias
      EA: "es", // Ceuta y Melilla
      VA: "it", // Ciudad del Vaticano
      SM: "it", // San Marino
      GP: "fr", // Guadalupe
      MQ: "fr", // Martinica
      GF: "fr", // Guayana Francesa
      YT: "fr", // Mayotte
      RE: "fr", // Reunión
      PM: "fr", // San Pedro y Miquelón
      PF: "fr", // Polinesia Francesa
      WF: "fr", // Wallis y Futuna
      NC: "fr", // Nueva Caledonia
      MC: "fr", // Mónaco
      CI: "fr", // Costa de Marfil
      HT: "fr", // Haití
      BQ: "nl", // Caribe Neerlandés
      SR: "nl", // Surinam
      SJ: "nb", // Svalbard y Jan Mayen
      GL: "da", // Groenlandia — su lengua es el groenlandés, que no servimos
      FO: "da", // Islas Feroe — su lengua es el feroés, que no servimos
      BN: "ms", // Brunéi
    };
    for (const [cc, locale] of Object.entries(REUSED)) {
      expect(localeFromCountry(cc), `${cc} debería recibir "${locale}"`).toBe(locale);
    }

    // ⚠️ Surinam es "SR" y el serbio es "sr". Si alguien confunde el código de país
    // con el del idioma, Surinam empieza a servirse en serbio y nadie lo nota.
    expect(localeFromCountry("SR")).not.toBe("sr");

    // Serbia SÍ tiene idioma propio: el serbio es ekavo y no le servía el bosnio,
    // así que `sr` se derivó aparte en vez de reutilizar `bs` como hizo Montenegro.
    expect(localeFromCountry("RS")).toBe("sr");
  });

  it("Canadá delega en el navegador en vez de fijar un idioma", () => {
    // Devolver null aquí NO es un olvido: es lo que hace que el middleware NO
    // fije la cookie y deje decidir al Accept-Language, que sí distingue fr-CA
    // de en-CA. Con "en" un quebequés vería inglés a la fuerza; con "fr" el
    // 75 % anglófono vería francés. Cualquiera de los dos valores fijos se
    // equivoca con millones de personas, así que si alguien mapea CA a un idioma
    // "para completar la tabla", este test lo para.
    expect(localeFromCountry("CA")).toBeNull();
    expect(NON_EU_COUNTRY_TO_LOCALE["CA"]).toBeUndefined();
    expect(EU_COUNTRY_TO_LOCALE["CA"]).toBeUndefined();
  });

  it("el inglés de estos países está DECIDIDO, no heredado del fallback", () => {
    // El inglés es el respaldo por defecto, así que estos expects pasarían igual
    // sin las entradas del mapa. Lo que comprueban de verdad es que las entradas
    // SIGAN existiendo: son la única señal de que aquí se revisó el idioma y se
    // eligió el inglés. Si alguien las borra por redundantes, estos países vuelven
    // a ser indistinguibles de los que nadie ha mirado nunca.
    for (const cc of ["WS", "TO", "VU", "TV", "BT"]) {
      expect(NON_EU_COUNTRY_TO_LOCALE[cc], `${cc} perdió su entrada explícita`).toBe("en");
      expect(localeFromCountry(cc)).toBe("en");
    }
  });

  it("la dirección del documento sale de la tabla, no de una heurística", () => {
    // `dir` en el <html> se calcula con esto (app/layout.tsx). Si `ar` deja de
    // marcarse como RTL, el árabe no se ve "sin espejar": se rompe a nivel de
    // CARÁCTER —orden invertido, puntuación al lado contrario, inputs escribiendo
    // al revés— y eso no lo detecta ningún test de traducción.
    // El conjunto va fijado entero, no derivado de RTL_LOCALES: si el bucle de
    // abajo se limitara a saltarse lo que hay en la tabla, sacar un idioma de
    // ella lo mandaría a la rama LTR y el test seguiría pasando. Así, añadir o
    // quitar un RTL obliga a tocar esta línea a propósito.
    expect([...RTL_LOCALES].sort()).toEqual(["ar", "dv"]);
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("dv")).toBe("rtl");
    for (const code of READY_LOCALES) {
      if (RTL_LOCALES.has(code)) continue;
      expect(localeDir(code), `${code} no debería ser RTL`).toBe("ltr");
    }
    // Sin locale (petición sin resolver todavía) el documento no puede quedarse
    // sin dirección: LTR es el único valor seguro por defecto.
    expect(localeDir(null)).toBe("ltr");
    expect(localeDir(undefined)).toBe("ltr");

    // Un RTL que no se sirva sería una entrada muerta: la dirección se aplicaría
    // a un locale que nadie puede seleccionar.
    for (const code of RTL_LOCALES) {
      expect(isReadyLocale(code), `${code} está en RTL_LOCALES pero no se sirve`).toBe(true);
    }
  });

  it("intlLocale da un BCP-47 que Intl acepta, para todos los del catálogo", () => {
    for (const m of LOCALE_META) {
      expect(() => new Intl.DateTimeFormat(intlLocale(m.code)), `locale ${m.code}`).not.toThrow();
    }
  });
});

// El backend compila aparte y mantiene su propia copia de la lista.
describe("i18n / paridad con el backend", () => {
  it("READY_LOCALES del backend está en sync con el del frontend", () => {
    const src = readFileSync(root("backend/src/locales.ts"), "utf8");
    const block = src.match(/export const READY_LOCALES = \[([\s\S]*?)\];/);
    expect(block, "no se encontró READY_LOCALES en backend/src/locales.ts").not.toBeNull();
    const backendList = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...backendList].sort()).toEqual([...READY_LOCALES].sort());
  });
});
