// Copia `shared/` dentro de `backend/src/shared/` antes de compilar las Cloud
// Functions.
//
// Por qué existe: el backend tiene `rootDir: "src"`, así que no puede importar
// nada de fuera de esa carpeta. Cambiar el rootDir para alcanzar `shared/` mueve
// TODO el compilado (`lib/index.js` → `lib/backend/src/index.js`) y obliga a
// reverificar cómo Firebase descubre las 165 funciones. Un error ahí no rompe
// una función, rompe el despliegue entero.
//
// Copiar es la salida sin riesgo: `shared/` sigue siendo la ÚNICA fuente, el
// destino está en .gitignore y se regenera en cada build, así que no puede
// divergir. Si alguien edita la copia, el siguiente build se la lleva por
// delante — que es justo lo que se quiere.

// Script de build en CommonJS: lo ejecuta `node` directamente desde el `build`
// del backend, sin pasar por ningún bundler.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const origen = path.join(root, "shared");
const destino = path.join(root, "backend", "src", "shared");

const AVISO = `// ⚠️ GENERADO — NO EDITAR.
// Copia de \`shared/\` hecha por scripts/sync-shared.js en cada build del backend.
// Edita el original en la carpeta \`shared/\` de la raíz del repositorio.

`;

function copiar(dirOrigen, dirDestino) {
  fs.mkdirSync(dirDestino, { recursive: true });

  for (const entrada of fs.readdirSync(dirOrigen, { withFileTypes: true })) {
    const desde = path.join(dirOrigen, entrada.name);
    const hasta = path.join(dirDestino, entrada.name);

    if (entrada.isDirectory()) {
      copiar(desde, hasta);
      continue;
    }
    if (!entrada.name.endsWith(".ts")) continue;

    fs.writeFileSync(hasta, AVISO + fs.readFileSync(desde, "utf8"), "utf8");
  }
}

if (!fs.existsSync(origen)) {
  console.error("sync-shared: no existe la carpeta shared/");
  process.exit(1);
}

// Se borra primero para que un archivo eliminado en `shared/` desaparezca aquí.
fs.rmSync(destino, { recursive: true, force: true });
copiar(origen, destino);

console.log("sync-shared: shared/ → backend/src/shared/");
