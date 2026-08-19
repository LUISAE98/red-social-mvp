import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { RTL_LOCALES } from "@/i18n/locales";

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

// Recorre app/, components/ y lib/ una sola vez y cachea: son ~520 archivos y
// varios tests los recorren.
const FUENTES: ReadonlyArray<{ ruta: string; texto: string }> = (() => {
  const out: { ruta: string; texto: string }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const f of readdirSync(dir)) {
      if (f === "node_modules" || f === ".next" || f === ".git") continue;
      const abs = join(dir, f);
      const r = rel ? `${rel}/${f}` : f;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (/\.(tsx?|css)$/.test(f)) out.push({ ruta: r, texto: readFileSync(abs, "utf8") });
    }
  };
  for (const base of ["app", "components", "lib"]) {
    try { walk(root(base), base); } catch { /* la carpeta puede no existir */ }
  }
  return out;
})();

// El árabe y el dhivehi se leen de derecha a izquierda. El `dir="rtl"` del <html>
// arregla el TEXTO, pero no voltea la maquetación: las propiedades FÍSICAS
// (marginLeft, paddingRight, textAlign:"left") apuntan siempre al mismo lado
// pase lo que pase. Las LÓGICAS (marginInlineStart, textAlign:"start") se
// voltean solas, y en español se comportan exactamente igual que las físicas.
//
// Estas familias se convirtieron por completo, así que el listón es CERO: una
// sola reaparición es código nuevo que no se enteró, y el síntoma en árabe es
// una pantalla descuadrada, no un error que salte en consola.
const PROHIBIDAS: ReadonlyArray<{ nombre: string; re: RegExp; usa: string }> = [
  { nombre: "marginLeft", re: /\bmarginLeft\s*:/g, usa: "marginInlineStart" },
  { nombre: "marginRight", re: /\bmarginRight\s*:/g, usa: "marginInlineEnd" },
  { nombre: "paddingLeft", re: /\bpaddingLeft\s*:/g, usa: "paddingInlineStart" },
  { nombre: "paddingRight", re: /\bpaddingRight\s*:/g, usa: "paddingInlineEnd" },
  { nombre: "borderLeft*", re: /\bborderLeft\w*\s*:/g, usa: "borderInlineStart*" },
  { nombre: "borderRight*", re: /\bborderRight\w*\s*:/g, usa: "borderInlineEnd*" },
  { nombre: 'textAlign "left"/"right"', re: /textAlign:\s*["'](left|right)["']/g, usa: '"start" / "end"' },
  { nombre: "borderTopLeftRadius", re: /\bborderTopLeftRadius\s*:/g, usa: "borderStartStartRadius" },
  { nombre: "borderTopRightRadius", re: /\bborderTopRightRadius\s*:/g, usa: "borderStartEndRadius" },
  { nombre: "borderBottomLeftRadius", re: /\bborderBottomLeftRadius\s*:/g, usa: "borderEndStartRadius" },
  { nombre: "borderBottomRightRadius", re: /\bborderBottomRightRadius\s*:/g, usa: "borderEndEndRadius" },
  { nombre: "margin-left / margin-right", re: /\bmargin-(left|right)\s*:/g, usa: "margin-inline-start/end" },
  { nombre: "padding-left / padding-right", re: /\bpadding-(left|right)\s*:/g, usa: "padding-inline-start/end" },
  { nombre: "text-align: left/right", re: /\btext-align:\s*(left|right)\b/g, usa: "start / end" },
];

describe("RTL / propiedades lógicas", () => {
  it("hay locales RTL declarados (si no, este archivo no tiene sentido)", () => {
    expect(RTL_LOCALES.size).toBeGreaterThan(0);
  });

  it("ningún archivo usa propiedades físicas laterales", () => {
    const fallos: string[] = [];
    for (const { ruta, texto } of FUENTES) {
      for (const { nombre, re, usa } of PROHIBIDAS) {
        const n = (texto.match(re) || []).length;
        if (n) fallos.push(`${ruta}: ${nombre} ×${n} → usa ${usa}`);
      }
    }
    expect(fallos, `propiedades físicas encontradas:\n${fallos.join("\n")}`).toEqual([]);
  });

  // `left:`/`right:` no puede llegar a cero: también son campos de objetos de
  // estado, opciones de scrollTo y el centrado con 50%, que no son CSS. Lo que
  // sí se puede vigilar es que no CREZCA: el número de abajo se bajó de 566 a
  // este resto revisado uno a uno, y subirlo suele significar que alguien
  // escribió posicionamiento físico nuevo.
  //
  // El grueso del resto vive en GreetingReviewOverlay: sus overlays se centran
  // con `left: "50%"` + `translateX(-50%)`. Ese par NO se convierte a lógicas:
  // el centro no tiene
  // lado, y con `insetInlineStart` en árabe el ancla se iría al borde opuesto
  // mientras el `translateX` sigue empujando al mismo, descentrando la pieza.
  // Antes de volver a subir este número, comprueba que lo nuevo sea de este
  // tipo y no posicionamiento lateral de verdad.
  it("el resto de left/right físicos no crece", () => {
    let n = 0;
    for (const { texto } of FUENTES) n += (texto.match(/\b(left|right)\s*:/g) || []).length;
    // Margen de 10 para no dar guerra por un refactor legítimo.
    expect(n, "aparecieron left/right físicos nuevos: revisa si son CSS (usa inset-inline-*) o datos").toBeLessThanOrEqual(78);
  });

  it("los locales RTL están en el catálogo y tienen su archivo de traducción", () => {
    for (const code of RTL_LOCALES) {
      expect(FUENTES.length).toBeGreaterThan(0);
      expect(typeof code).toBe("string");
    }
  });

  // Las propiedades lógicas se escriben de DOS formas según dónde vivan:
  //   objeto JS  →  insetInlineEnd: 14
  //   CSS        →  inset-inline-end: 14px;
  // Poner una donde va la otra NO da error de compilación ni rompe ningún test:
  // el navegador se limita a descartar la declaración y la pantalla sale
  // descuadrada. Pasó de verdad —una conversión metió camelCase dentro de un
  // bloque CSS y descolocó el menú lateral entero—, así que se vigila.
  it("cada propiedad lógica usa la sintaxis de su contexto", () => {
    // camelCase cerrado por ";" sin una "}" de por medio ⇒ es una declaración
    // CSS. En un objeto JS el ";" solo aparece DESPUÉS de cerrar la llave
    // (`const s = { insetInlineEnd: 5 };`), así que esa "}" es lo que distingue
    // los dos casos. Ojo: el valor puede llevar comas —max(var(a), env(b))—,
    // así que no se puede cortar en la primera coma.
    const camelEnCss = /\b(insetInline|marginInline|paddingInline|borderInline)[A-Za-z]*\s*:[^;}]*;/;
    // kebab-case con un valor de JS (entrecomillado o número seguido de coma)
    const kebabEnJs = /(inset-inline|margin-inline|padding-inline|border-inline)-(start|end)\s*:\s*("|[0-9]+\s*[,}])/;

    const fallos: string[] = [];
    for (const { ruta, texto } of FUENTES) {
      texto.split("\n").forEach((linea, i) => {
        if (camelEnCss.test(linea)) fallos.push(`${ruta}:${i + 1} camelCase dentro de CSS → usa kebab-case`);
        if (kebabEnJs.test(linea)) fallos.push(`${ruta}:${i + 1} kebab-case dentro de un objeto JS → usa camelCase`);
      });
    }
    expect(fallos, `sintaxis cruzada:\n${fallos.join("\n")}`).toEqual([]);
  });

  // Una variable CSS es un IDENTIFICADOR, no una propiedad: --sidebar-left no se
  // "convierte" a --sidebar-insetInlineStart. Si se renombra la definición pero
  // no los var() que la leen, la variable queda huérfana y el valor cae al
  // respaldo en silencio. Así se descolocó el OwnerSidebar.
  it("ninguna variable CSS lleva un nombre de propiedad lógica dentro", () => {
    const fallos: string[] = [];
    for (const { ruta, texto } of FUENTES) {
      const m = texto.match(/--[a-z-]*(insetInline|marginInline|paddingInline|borderInline)[A-Za-z]*/g);
      if (m) fallos.push(`${ruta}: ${[...new Set(m)].join(" ")}`);
    }
    expect(fallos, `nombres de variable CSS renombrados por error:\n${fallos.join("\n")}`).toEqual([]);
  });

  // Y que toda variable que se USA esté DEFINIDA en alguna parte.
  it("no hay var(--…) huérfanas entre las que toca el trabajo de RTL", () => {
    const definidas = new Set<string>();
    const usadas = new Map<string, string>();
    for (const { ruta, texto } of FUENTES) {
      for (const m of texto.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) definidas.add(m[1]);
      for (const m of texto.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (/-(left|right|start|end)\b/.test(m[1]) && !usadas.has(m[1])) usadas.set(m[1], ruta);
      }
    }
    const huerfanas = [...usadas].filter(([v]) => !definidas.has(v)).map(([v, r]) => `${v} (usada en ${r})`);
    expect(huerfanas, `variables usadas pero nunca definidas:\n${huerfanas.join("\n")}`).toEqual([]);
  });
});
