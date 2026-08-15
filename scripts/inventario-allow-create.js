// Inventario de las declaraciones `allow create` de firestore.rules (M01, Bloque 4).
// Clasifica cada una en: cerrada al cliente, con esquema fijado, o sin esquema.
// Resuelve los esquemas definidos en funciones auxiliares, no solo los `hasOnly`
// escritos dentro del propio `allow`.

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = process.argv[2] || "firestore.rules";
const src = fs.readFileSync(path, "utf8");
const lines = src.split("\n");

// ── Cuerpo de cada función declarada en el archivo ──────────────────────────
const funcs = {};
const fnRe = /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
let m;
while ((m = fnRe.exec(src))) {
  let depth = 0;
  let i = m.index + m[0].length - 1;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  funcs[m[1]] = src.slice(start, i);
}

const llamada = (nombre) => new RegExp("\\b" + nombre + "\\s*\\(");

// ¿Esta función fija el esquema, directa o indirectamente?
const cache = {};
function fijaEsquema(nombre, vistas = new Set()) {
  if (cache[nombre] !== undefined) return cache[nombre];
  if (vistas.has(nombre) || !funcs[nombre]) return false;
  vistas.add(nombre);

  const cuerpo = funcs[nombre];
  let resultado = cuerpo.includes("hasOnly");
  if (!resultado) {
    for (const otra of Object.keys(funcs)) {
      if (otra !== nombre && llamada(otra).test(cuerpo) && fijaEsquema(otra, vistas)) {
        resultado = true;
        break;
      }
    }
  }
  cache[nombre] = resultado;
  return resultado;
}

// ── Cada `allow … create …` con su cuerpo hasta el `;` ──────────────────────
const entradas = [];
for (let i = 0; i < lines.length; i++) {
  if (/allow\s+[a-z,\s]*\bcreate\b[a-z,\s]*:/.test(lines[i])) {
    const cuerpo = [];
    let j = i;
    while (j < lines.length) {
      cuerpo.push(lines[j]);
      if (lines[j].trimEnd().endsWith(";")) break;
      j++;
    }
    entradas.push({ linea: i + 1, cuerpo: cuerpo.join("\n") });
    i = j;
  }
}

/** El `match` más cercano por encima, que es la colección que gobierna la regla. */
function coleccion(numeroLinea) {
  for (let i = numeroLinea - 1; i >= 0; i--) {
    const hit = lines[i].match(/match\s+(\S+)/);
    if (hit) return hit[1];
  }
  return "?";
}

const cerradas = [];
const conEsquema = [];
const sinEsquema = [];

for (const e of entradas) {
  if (/:\s*if\s+false\s*;/.test(e.cuerpo)) {
    cerradas.push(e);
    continue;
  }
  let tiene = e.cuerpo.includes("hasOnly");
  if (!tiene) {
    for (const n of Object.keys(funcs)) {
      if (llamada(n).test(e.cuerpo) && fijaEsquema(n)) {
        tiene = true;
        break;
      }
    }
  }
  (tiene ? conEsquema : sinEsquema).push(e);
}

console.log("TOTAL allow create:", entradas.length);
console.log("  cerradas al cliente (if false):", cerradas.length);
console.log("  con esquema fijado:", conEsquema.length);
console.log("  SIN esquema:", sinEsquema.length);
console.log("");
console.log("── SIN esquema ──────────────────────────────────────────────");
for (const e of sinEsquema) {
  console.log(String(e.linea).padStart(5) + "  " + coleccion(e.linea));
}
