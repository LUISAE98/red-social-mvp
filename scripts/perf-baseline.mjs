// Línea base de peso de JavaScript por ruta.
//
// Mide cuánto JavaScript descarga el navegador para pintar cada pantalla, y
// guarda el resultado para poder comparar contra él más adelante. Es el
// instrumento con el que se cierran los bloques 1 a 5 del plan de rendimiento:
// sin un "antes" guardado, cualquier mejora es una opinión.
//
//   node scripts/perf-baseline.mjs                    → mide y escribe docs/perf/
//   node scripts/perf-baseline.mjs --compare          → mide y compara contra lo guardado
//   node scripts/perf-baseline.mjs --save             → sobrescribe la línea base guardada
//
// Requiere un `npm run build` previo: lee de `.next`, no compila nada.
//
// ─────────────────────────────────────────────────────────────────────────────
// De dónde salen los números
//
// Next 16 con Turbopack NO emite `app-build-manifest.json`. Lo que sí emite es
// un `_client-reference-manifest.js` por ruta dentro de `.next/server/app/`,
// que asigna a `globalThis.__RSC_MANIFEST[ruta]` un objeto con todos los
// módulos de cliente de esa ruta y los fragmentos que los contienen. Ese es el
// conjunto que el navegador tiene que descargar, así que sumar el tamaño de sus
// fragmentos ÚNICOS es la medida honesta del peso de la pantalla.
//
// Se reportan las dos cifras: el tamaño en disco y el comprimido con gzip. La
// que importa para el usuario es la segunda —es lo que viaja por la red— pero
// la primera es la que hay que analizar y ejecutar, y esa es justo la parte que
// más duele en un celular de gama media.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const RAIZ = process.cwd();
const DIR_NEXT = path.join(RAIZ, ".next");
const DIR_DOCS = path.join(RAIZ, "docs", "perf");
const RUTA_JSON = path.join(DIR_DOCS, "baseline.json");
const RUTA_MD = path.join(DIR_DOCS, "baseline.md");

const args = new Set(process.argv.slice(2));
const comparar = args.has("--compare");
const guardar = args.has("--save") || !comparar;

/** Rutas internas que no son producto: no ensucian el informe. */
const RUTAS_INTERNAS = [
  "/[locale]/paneles",
  "/[locale]/dev/",
  "/[locale]/diagnostico-fx",
  "/[locale]/egress/",
  "/_global-error",
  "/_not-found",
];

// ── recolección ──────────────────────────────────────────────────────────────

function buscarManifiestos(dir, salida = []) {
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return salida;
  }
  for (const entrada of entradas) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) buscarManifiestos(p, salida);
    else if (entrada.name.endsWith("_client-reference-manifest.js")) salida.push(p);
  }
  return salida;
}

/**
 * Los manifiestos son scripts que escriben en `globalThis.__RSC_MANIFEST`. Se
 * evalúan en vez de parsearse porque el formato es de Next y no hay contrato:
 * un cambio de comillas o de orden rompería cualquier expresión regular, y en
 * cambio ejecutarlos funciona mientras el formato siga siendo "asignar a esa
 * variable global". Son ficheros generados por nuestro propio build.
 */
function leerManifiestos() {
  globalThis.__RSC_MANIFEST = {};
  const ficheros = buscarManifiestos(path.join(DIR_NEXT, "server", "app"));

  if (ficheros.length === 0) {
    console.error(
      "\x1b[31m✖  No hay manifiestos en .next/server/app.\x1b[0m\n" +
        "   Corre `npm run build` antes de medir."
    );
    process.exit(1);
  }

  for (const fichero of ficheros) {
    try {
      (0, eval)(fs.readFileSync(fichero, "utf8"));
    } catch {
      // Un manifiesto ilegible se salta: mejor un informe incompleto y avisado
      // que ninguno.
      console.warn(`\x1b[33m⚠  Manifiesto ilegible, se omite: ${path.relative(RAIZ, fichero)}\x1b[0m`);
    }
  }

  return globalThis.__RSC_MANIFEST;
}

const cacheTamanos = new Map();
const faltantes = new Set();

/** Devuelve { bytes, gzip } de un fragmento, cacheado: se repite mucho entre rutas. */
function medirFragmento(chunk) {
  if (cacheTamanos.has(chunk)) return cacheTamanos.get(chunk);

  const relativo = chunk.replace(/^\/_next\//, "");
  const absoluto = path.join(DIR_NEXT, relativo);
  let medida = { bytes: 0, gzip: 0 };

  try {
    const contenido = fs.readFileSync(absoluto);
    medida = { bytes: contenido.length, gzip: zlib.gzipSync(contenido).length };
  } catch {
    // Un fragmento listado que no está en disco cuenta como 0 y se avisa al
    // final; suele significar que el build está a medias.
    faltantes.add(chunk);
  }

  cacheTamanos.set(chunk, medida);
  return medida;
}

function esInterna(ruta) {
  return RUTAS_INTERNAS.some((prefijo) => ruta.startsWith(prefijo));
}

/** Nombre legible de la ruta: sin el segmento de idioma ni los grupos de Next. */
function nombreLegible(ruta) {
  const limpia = ruta
    .replace(/^\/\[locale\]/, "")
    .replace(/\/\([^)]+\)/g, "")
    .replace(/\/page$/, "");
  return limpia === "" ? "/" : limpia;
}

function medir() {
  const manifiesto = leerManifiestos();
  const rutas = [];

  for (const [ruta, datos] of Object.entries(manifiesto)) {
    if (!ruta.endsWith("/page")) continue;
    if (esInterna(ruta)) continue;

    const fragmentos = new Set();
    for (const modulo of Object.values(datos.clientModules || {})) {
      for (const chunk of modulo.chunks || []) {
        if (typeof chunk === "string" && chunk.endsWith(".js")) fragmentos.add(chunk);
      }
    }

    let bytes = 0;
    let gzip = 0;
    for (const chunk of fragmentos) {
      const medida = medirFragmento(chunk);
      bytes += medida.bytes;
      gzip += medida.gzip;
    }

    rutas.push({
      ruta: nombreLegible(ruta),
      rutaInterna: ruta,
      fragmentos: fragmentos.size,
      bytes,
      gzip,
      chunks: [...fragmentos].sort(),
    });
  }

  rutas.sort((a, b) => b.gzip - a.gzip);

  // Lo COMPARTIDO: fragmentos presentes en todas las rutas. Es el suelo que
  // paga cualquier pantalla, y el que bajan los bloques 1 y 2.
  const comun =
    rutas.length > 0
      ? rutas.reduce(
          (acc, r) => acc.filter((chunk) => r.chunks.includes(chunk)),
          [...rutas[0].chunks]
        )
      : [];

  let bytesComun = 0;
  let gzipComun = 0;
  for (const chunk of comun) {
    const medida = medirFragmento(chunk);
    bytesComun += medida.bytes;
    gzipComun += medida.gzip;
  }

  return {
    generado: new Date().toISOString(),
    buildId: leerBuildId(),
    compartido: { fragmentos: comun.length, bytes: bytesComun, gzip: gzipComun },
    // Se sueltan los nombres de los fragmentos: el fichero guardado es para
    // comparar tamaños, y la lista los multiplicaría por cuarenta rutas.
    rutas: rutas.map((r) => ({
      ruta: r.ruta,
      rutaInterna: r.rutaInterna,
      fragmentos: r.fragmentos,
      bytes: r.bytes,
      gzip: r.gzip,
    })),
  };
}

function leerBuildId() {
  try {
    return fs.readFileSync(path.join(DIR_NEXT, "BUILD_ID"), "utf8").trim();
  } catch {
    return "desconocido";
  }
}

// ── presentación ─────────────────────────────────────────────────────────────

const kb = (n) => (n / 1024).toFixed(0);
const kb1 = (n) => (n / 1024).toFixed(1);

function firma(n) {
  return n > 0 ? `+${kb1(n)}` : kb1(n);
}

function imprimirTabla(informe, anterior) {
  const previas = new Map((anterior?.rutas || []).map((r) => [r.ruta, r]));

  console.log("");
  console.log(`\x1b[1mPeso de JavaScript por pantalla\x1b[0m  ·  build ${informe.buildId}`);
  console.log("");
  console.log(
    "  " +
      "gzip".padStart(8) +
      "disco".padStart(10) +
      "frag".padStart(7) +
      (anterior ? "  Δ gzip".padStart(12) : "") +
      "   pantalla"
  );
  console.log("  " + "─".repeat(anterior ? 62 : 50));

  for (const r of informe.rutas) {
    let delta = "";
    if (anterior) {
      const previa = previas.get(r.ruta);
      if (!previa) {
        delta = "nueva".padStart(12);
      } else {
        const d = r.gzip - previa.gzip;
        const texto = `${firma(d)} KB`;
        const color = d < -1024 ? "\x1b[32m" : d > 1024 ? "\x1b[31m" : "\x1b[90m";
        delta = color + texto.padStart(12) + "\x1b[0m";
      }
    }

    console.log(
      "  " +
        `${kb(r.gzip)} KB`.padStart(8) +
        `${kb(r.bytes)} KB`.padStart(10) +
        String(r.fragmentos).padStart(7) +
        delta +
        "   " +
        r.ruta
    );
  }

  console.log("  " + "─".repeat(anterior ? 62 : 50));
  const c = informe.compartido;
  console.log(
    "  " +
      `${kb(c.gzip)} KB`.padStart(8) +
      `${kb(c.bytes)} KB`.padStart(10) +
      String(c.fragmentos).padStart(7) +
      (anterior ? "".padStart(12) : "") +
      "   \x1b[2mcompartido por todas\x1b[0m"
  );
  console.log("");
}

function escribirMarkdown(informe) {
  const lineas = [];
  lineas.push("# Línea base de rendimiento — peso de JavaScript por pantalla");
  lineas.push("");
  lineas.push(
    "Generado por `node scripts/perf-baseline.mjs`. **No editar a mano**: se sobrescribe."
  );
  lineas.push("");
  lineas.push(`- Build: \`${informe.buildId}\``);
  lineas.push(`- Generado: ${informe.generado}`);
  lineas.push("");
  lineas.push(
    "`gzip` es lo que viaja por la red. `disco` es lo que el navegador tiene que " +
      "analizar y ejecutar, que es lo que se nota en un celular de gama media."
  );
  lineas.push("");
  lineas.push("| Pantalla | gzip | disco | Fragmentos |");
  lineas.push("| --- | ---: | ---: | ---: |");
  for (const r of informe.rutas) {
    lineas.push(`| \`${r.ruta}\` | ${kb(r.gzip)} KB | ${kb(r.bytes)} KB | ${r.fragmentos} |`);
  }
  const c = informe.compartido;
  lineas.push(
    `| **compartido por todas** | **${kb(c.gzip)} KB** | **${kb(c.bytes)} KB** | **${c.fragmentos}** |`
  );
  lineas.push("");

  fs.mkdirSync(DIR_DOCS, { recursive: true });
  fs.writeFileSync(RUTA_MD, lineas.join("\n"), "utf8");
}

// ── ejecución ────────────────────────────────────────────────────────────────

const informe = medir();

let anterior = null;
if (comparar) {
  try {
    anterior = JSON.parse(fs.readFileSync(RUTA_JSON, "utf8"));
  } catch {
    console.warn(
      "\x1b[33m⚠  No hay línea base guardada todavía; se muestra solo la medición actual.\x1b[0m"
    );
  }
}

imprimirTabla(informe, anterior);

if (faltantes.size > 0) {
  console.warn(
    `\x1b[33m⚠  ${faltantes.size} fragmento(s) listados en el manifiesto no están en disco. ` +
      `El build puede estar incompleto; las cifras se quedan cortas.\x1b[0m\n`
  );
}

if (guardar) {
  fs.mkdirSync(DIR_DOCS, { recursive: true });
  fs.writeFileSync(RUTA_JSON, JSON.stringify(informe, null, 2), "utf8");
  escribirMarkdown(informe);
  console.log(
    `\x1b[32m✔  Guardado en docs/perf/baseline.json y docs/perf/baseline.md\x1b[0m\n` +
      `   Para comparar tras un cambio:  node scripts/perf-baseline.mjs --compare\n`
  );
}
