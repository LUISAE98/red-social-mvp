import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Seguro contra el escalón negro de la PWA iOS.
 *
 * Este fallo se intentó arreglar cuatro veces y volvió cuatro veces, porque cada
 * intento fue a buscarlo al safe-area INFERIOR, donde no había nada que tocar.
 * Salía de tener declarados a la vez los DOS mecanismos de pantalla completa:
 * `black-translucent` (el viejo de Apple) y `viewport-fit: cover` (el moderno).
 *
 * La historia completa, con las medidas del aparato, está en
 * `docs/ios-pwa-viewport.md`. Estas comprobaciones son para que no vuelva por
 * quinta vez sin que nadie se entere.
 */

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

/** Quita comentarios de bloque y de línea: si no, un aviso cuenta como uso. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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
  for (const base of ["app", "components", "lib"]) walk(root(base), base);
  return out;
})();

describe("pantalla completa en la PWA de iOS", () => {
  it("no pide un modo de pantalla que iOS no implementa", () => {
    // `fullscreen` es de donde salía el escalón. iOS lo reportaba por
    // `display-mode` mientras enseñaba la barra de estado: daba al lienzo el
    // tamaño de fullscreen y hacía las cuentas de standalone, y los 62px de la
    // barra se caían por abajo. `standalone` sí lo implementa.
    const manifest = JSON.parse(readFileSync(root("public/manifest.json"), "utf8"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override ?? []).not.toContain("fullscreen");
  });

  it("mantiene emparejados el lienzo a pantalla completa y `standalone`", () => {
    // Van juntos o no van. `black-translucent` mete el lienzo por debajo de la
    // barra de estado, que es lo que hace que `.safeAreaGlass` tenga un inset
    // que cubrir; sin él ese cristal se queda en 22px y el contenido se corta
    // en seco. Y con `fullscreen` en vez de `standalone`, vuelve el escalón.
    const layout = readFileSync(root("app/layout.tsx"), "utf8");
    const manifest = JSON.parse(readFileSync(root("public/manifest.json"), "utf8"));

    expect(layout).toMatch(/statusBarStyle:\s*"black-translucent"/);
    expect(manifest.display).toBe("standalone");
  });

  it("declara la configuración de pantalla en un solo sitio", () => {
    // Dos declaraciones es exactamente como empezó el problema: cada una manda
    // sobre una parte de la geometría y nadie ve la contradicción.
    const conViewport = FUENTES.filter((f) =>
      /export const viewport\b/.test(sinComentarios(f.texto))
    ).map((f) => f.ruta);
    const conApple = FUENTES.filter((f) =>
      /\bappleWebApp\s*:/.test(sinComentarios(f.texto))
    ).map((f) => f.ruta);

    expect(conViewport).toEqual(["app/layout.tsx"]);
    expect(conApple).toEqual(["app/layout.tsx"]);
  });

  it("mantiene `viewport-fit: cover`, que es el mecanismo bueno", () => {
    const layout = readFileSync(root("app/layout.tsx"), "utf8");
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });
});

describe("safe-area inferior", () => {
  /**
   * Ya no existe y no debe volver: el subnav es flotante y no reserva nada.
   * Cualquier hueco que aparezca abajo viene de otro sitio — mirar primero el
   * inset de ARRIBA antes de tocar nada de esto.
   */

  /**
   * El lector de geometría del DM: ahí el `env()` no se CONSUME para maquetar,
   * se MIDE. Es una sonda oculta y fuera del flujo, y es el instrumento con el
   * que se encontró la causa; sin ella no hay forma de leer estos valores desde
   * JavaScript. Ver `docs/ios-pwa-viewport.md`.
   */
  const SONDA = "app/[locale]/(protected)/mensajes/[conversationId]/page.tsx";

  it("no usa `env(safe-area-inset-bottom)` en ningún sitio activo", () => {
    const culpables = FUENTES.filter(
      (f) =>
        f.ruta !== SONDA &&
        /env\(\s*safe-area-inset-bottom/.test(sinComentarios(f.texto))
    ).map((f) => f.ruta);
    expect(culpables).toEqual([]);
  });

  it("define `--vb-safe-bottom` una sola vez y en cero", () => {
    const definiciones: string[] = [];
    for (const f of FUENTES) {
      for (const m of sinComentarios(f.texto).matchAll(/--vb-safe-bottom\s*:\s*([^;]+);/g)) {
        definiciones.push(`${f.ruta} → ${m[1].trim()}`);
      }
    }
    expect(definiciones).toEqual(["app/globals.css → 0px"]);
  });
});
