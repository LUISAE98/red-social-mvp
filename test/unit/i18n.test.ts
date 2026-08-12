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

function readMessages(locale: string): unknown {
  return JSON.parse(readFileSync(root(`messages/${locale}.json`), "utf8"));
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
    const base = leafKeys(readMessages("en")).sort();
    expect(base.length).toBeGreaterThan(2000); // sanity: el archivo se leyó de verdad

    for (const code of READY_LOCALES) {
      if (code === "en") continue;
      const keys = leafKeys(readMessages(code)).sort();
      const faltan = base.filter((k) => !keys.includes(k));
      const sobran = keys.filter((k) => !base.includes(k));
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
    // Estos cuatro no trajeron traducción propia: aprovechan una que ya existía.
    // Se comprueban por separado del bucle de arriba porque el bucle valida que el
    // mapa sea coherente, no que estas cuatro entradas SIGAN estando. Se perdieron
    // una vez (los usuarios veían inglés sin motivo) y es fácil volver a perderlas.
    expect(localeFromCountry("MD")).toBe("ro"); // Moldavia
    expect(localeFromCountry("NC")).toBe("fr"); // Nueva Caledonia
    expect(localeFromCountry("ME")).toBe("bs"); // Montenegro
    expect(localeFromCountry("HK")).toBe("zh-TW"); // Hong Kong

    // Serbia queda fuera a propósito: el serbio es ekavo y a menudo cirílico, así
    // que el bosnio NO le sirve. Si algún día entra `sr`, este expect debe cambiar.
    expect(localeFromCountry("RS")).toBe("en");
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
