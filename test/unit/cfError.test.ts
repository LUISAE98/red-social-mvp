import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import ts from "typescript";

/**
 * Vigilancia del traductor de errores del backend.
 *
 * POR QUÉ HACE FALTA
 * ==================
 * Las Cloud Functions lanzan sus `HttpsError` con el mensaje escrito en español.
 * `lib/i18n/cfError.ts` los traduce con un mapa cuya LLAVE es ese mensaje
 * literal. Es un acoplamiento por texto, y por eso es frágil de una manera muy
 * concreta: cuando alguien cambia una coma en el backend o añade un error
 * nuevo, no se rompe nada. Simplemente el mapa deja de reconocerlo y el mensaje
 * sale en español crudo a los 47 idiomas, en silencio, sin que falle ni un test
 * ni el build.
 *
 * Este test convierte ese silencio en un fallo.
 *
 * ALCANCE: SOLO EL FLUJO DE COBRO
 * ===============================
 * De momento cubre los archivos de pagos, impuestos y facturación, que están al
 * 100%. El resto de la plataforma todavía tiene mensajes sin mapear, así que
 * exigirlo entero haría fallar la suite por trabajo que aún no está hecho.
 *
 * Al terminar cada bloque de traducción, añade su carpeta a `AMBITO`. El día que
 * estén todos, esto se convierte en la red de toda la plataforma.
 */

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

/** Rutas del backend que ya deben estar traducidas al 100%. */
const AMBITO = /payments|stripe|tax|checkout|refund|donation|ticket|invoice|facturapi/i;

function archivosTs(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (/node_modules/.test(f) || f.endsWith(".d.ts")) continue;
    if (e.isDirectory()) archivosTs(f, salida);
    else if (f.endsWith(".ts")) salida.push(f);
  }
  return salida;
}

/**
 * Mensajes de texto FIJO de `new HttpsError(codigo, "mensaje")`.
 *
 * Se leen del árbol de TypeScript, no con una expresión regular: en este repo
 * los comentarios están en español y llenos de frases entrecomilladas que un
 * regex confundiría con mensajes de error.
 *
 * Los construidos con plantilla (`${...}`) se dejan fuera a propósito: no tienen
 * un texto fijo que mapear, y hacen falta cambios en el backend, no traducción.
 */
function mensajesDelBackend(): Map<string, string> {
  const encontrados = new Map<string, string>();
  for (const f of archivosTs(root("backend/src"))) {
    if (!AMBITO.test(f)) continue;
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const visitar = (n: ts.Node): void => {
      if (
        ts.isNewExpression(n) &&
        n.expression.getText(sf).includes("HttpsError") &&
        n.arguments?.[1] &&
        ts.isStringLiteral(n.arguments[1])
      ) {
        encontrados.set((n.arguments[1] as ts.StringLiteral).text, f);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
  }
  return encontrados;
}

const FUENTE_CF = readFileSync(root("lib/i18n/cfError.ts"), "utf8");

/** Llaves del mapa: el mensaje español normalizado. */
const MAPEADAS = new Set(
  [...FUENTE_CF.matchAll(/^\s*"([^"]+)":\s*"/gm)].map((m) => m[1])
);

/** Valores del mapa: la clave de traducción a la que apunta cada mensaje. */
const DESTINOS = new Set(
  [...FUENTE_CF.matchAll(/^\s*"[^"]+":\s*"([^"]+)"/gm)].map((m) => m[1])
);

const EN = JSON.parse(readFileSync(root("messages/en.json"), "utf8")) as {
  cf: Record<string, string>;
  common: Record<string, string>;
};

describe("cfError / errores del backend", () => {
  it("todo mensaje del flujo de cobro tiene traducción", () => {
    const sinMapear: string[] = [];
    for (const [msg, archivo] of mensajesDelBackend()) {
      if (!MAPEADAS.has(msg.toLowerCase().trim())) {
        sinMapear.push(`${msg}   ← ${archivo.replace(/.*backend/, "backend")}`);
      }
    }

    expect(
      sinMapear,
      "estos mensajes saldrían en español a los 47 idiomas. " +
        "Añádelos a MSG_TO_KEY en lib/i18n/cfError.ts y crea la clave en messages/*.json"
    ).toEqual([]);
  });

  it("toda clave a la que apunta el mapa existe en el catálogo", () => {
    // Un destino mal escrito no rompe el build: next-intl devuelve la clave cruda
    // y en pantalla se lee "cf.paymetNotFound" en mitad de un cobro.
    const huerfanas = [...DESTINOS].filter((destino) =>
      destino.startsWith("common:")
        ? !(destino.slice("common:".length) in EN.common)
        : !(destino in EN.cf)
    );

    expect(huerfanas, "claves que el mapa usa pero que no existen en messages/en.json").toEqual([]);
  });
});
