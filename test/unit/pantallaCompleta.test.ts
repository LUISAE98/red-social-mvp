import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Seguro contra el escalón negro de la PWA iOS.
 *
 * En la app instalada de iPhone el LIENZO mide la pantalla entera pero el ÁREA
 * DE DIBUJO mide menos, exactamente lo que ocupa la barra de estado. Todo lo que
 * se ancle con `100dvh`, `inset: 0` o `bottom: 0` se resuelve contra la segunda
 * y se queda corto, dejando ver el lienzo en negro por abajo.
 *
 * La compensación vive en `app/globals.css` (`--vb-lienzo-extra` y
 * `--vb-alto-pantalla`) y vale 0 en todas partes menos ahí.
 *
 * Historia completa, con las medidas del aparato y los cuatro intentos que
 * buscaron en el sitio equivocado, en `docs/ios-pwa-viewport.md`.
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

const GLOBALS = readFileSync(root("app/globals.css"), "utf8");

describe("alto de pantalla en la PWA de iOS", () => {
  it("define la compensación una sola vez y en cero por defecto", () => {
    // Vale 0 fuera de la app instalada: si alguien la pone a otra cosa en el
    // caso general, se descuadra toda la plataforma en navegador.
    const extra = [...GLOBALS.matchAll(/--vb-lienzo-extra\s*:\s*([^;]+);/g)].map((m) =>
      m[1].trim()
    );
    expect(extra).toEqual(["0px", "calc(100lvh - 100dvh)"]);

    const alto = [...GLOBALS.matchAll(/--vb-alto-pantalla\s*:\s*([^;]+);/g)].map((m) =>
      m[1].trim()
    );
    expect(alto).toEqual(["calc(100dvh + var(--vb-lienzo-extra))"]);
  });

  it("acota la compensación a la app instalada, en sus DOS modos", () => {
    // 🚨 Sin acotar, en Safari `lvh` ignora la barra del navegador y la resta
    // valdría el alto de esa barra, escondiendo contenido por debajo.
    //
    // 🚨 Y tienen que estar los dos modos. Cubrir solo `standalone` costó un
    // ciclo entero: iOS reporta `fullscreen` aunque enseñe la barra de estado,
    // así que la regla no casaba, la compensación se quedaba en 0 y parecía que
    // el arreglo no servía cuando ni siquiera se estaba ejecutando.
    const query = GLOBALS.match(/@media([^{]*)\{\s*:root\s*\{\s*--vb-lienzo-extra/)?.[1];
    expect(query).toBeDefined();
    expect(query).toContain("display-mode: standalone");
    expect(query).toContain("display-mode: fullscreen");
  });

  it("no reintroduce `100dvh` suelto", () => {
    // `100dvh` es el área de dibujo, que en la PWA de iPhone NO es la pantalla.
    // Lo que quiera medir la pantalla usa `var(--vb-alto-pantalla)`.
    //
    // Dos excepciones, las dos en `app/`: `globals.css`, que es donde se define
    // la variable a partir de `100dvh`; y `layout.tsx`, cuyo splash se pinta
    // ANTES de que cargue la hoja de estilos y por eso lleva su propia regla
    // `@media (display-mode: standalone)` escrita a mano.
    // El lector del DM también: ahí `100dvh` no se consume para maquetar, se
    // MIDE, para poder distinguir "la compensación no se aplicó" de "se aplicó
    // y aun así queda corto".
    const PERMITIDOS = new Set([
      "app/globals.css",
      "app/layout.tsx",
      "app/[locale]/(protected)/mensajes/[conversationId]/page.tsx",
    ]);
    const culpables = FUENTES.filter(
      (f) => !PERMITIDOS.has(f.ruta) && /\b100dvh\b/.test(sinComentarios(f.texto))
    ).map((f) => f.ruta);
    expect(culpables).toEqual([]);
  });
});

describe("superficies que deben llegar al borde", () => {
  /**
   * `app/layout.tsx` lleva su propia regla, con su media query aparte: el splash
   * se pinta antes de que cargue `globals.css` y ahí la variable no existe.
   * El lector del DM mide en vez de maquetar.
   */
  const EXENTOS = new Set([
    "app/layout.tsx",
    "app/[locale]/(protected)/mensajes/[conversationId]/page.tsx",
  ]);

  it("todo `position: fixed` con `inset: 0` declara el alto de pantalla", () => {
    // `inset: 0` se resuelve contra el ÁREA DE DIBUJO, que en la PWA de iPhone
    // mide 62px menos que la pantalla. Sin el alto, el elemento se queda corto y
    // deja ver el lienzo desnudo por abajo: eso es el escalón negro.
    //
    // Con el alto queda sobre-restringido —`top`, `bottom` y `height`— y CSS
    // descarta `bottom`. Es justo lo que se busca.
    const culpables: string[] = [];
    for (const f of FUENTES) {
      if (EXENTOS.has(f.ruta)) continue;
      const L = f.texto.split(/\r?\n/);
      L.forEach((linea, i) => {
        if (!/^\s*inset:\s*0\s*[,;]\s*$/.test(linea)) return;
        const antes = L.slice(Math.max(0, i - 4), i).join("\n");
        if (!/position:\s*["']?fixed/.test(antes)) return;
        const despues = L.slice(i + 1, i + 6).join("\n");
        if (/vb-alto-pantalla/.test(despues)) return;
        culpables.push(`${f.ruta}:${i + 1}`);
      });
    }
    expect(culpables).toEqual([]);
  });
});

describe("configuración de pantalla completa", () => {
  it("declara `viewport` y `appleWebApp` en un solo sitio", () => {
    // Dos declaraciones es como empezó todo: cada una manda sobre una parte de
    // la geometría y nadie ve la contradicción.
    const conViewport = FUENTES.filter((f) =>
      /export const viewport\b/.test(sinComentarios(f.texto))
    ).map((f) => f.ruta);
    const conApple = FUENTES.filter((f) =>
      /\bappleWebApp\s*:/.test(sinComentarios(f.texto))
    ).map((f) => f.ruta);

    expect(conViewport).toEqual(["app/layout.tsx"]);
    expect(conApple).toEqual(["app/layout.tsx"]);
  });

  it("mantiene el lienzo por debajo de la barra de estado", () => {
    // `black-translucent` es lo que da el traslúcido de arriba: sin él,
    // `env(safe-area-inset-top)` vale 0, `.safeAreaGlass` se queda en 22px
    // sueltos y el contenido se corta en seco contra una barra negra opaca.
    // Es también lo que descuadra el área de dibujo — por eso existe
    // `--vb-lienzo-extra`, para poder tener las dos cosas.
    const layout = readFileSync(root("app/layout.tsx"), "utf8");
    expect(layout).toMatch(/statusBarStyle:\s*"black-translucent"/);
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
