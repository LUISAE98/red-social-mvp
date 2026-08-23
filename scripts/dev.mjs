// Dev server con auto-reinicio.
//
// Next 16 usa Turbopack, que ocasionalmente crashea al procesar el CSS de
// Tailwind (panic: "unable to handle stdout from the Node.js process… stream
// closed unexpectedly"). Cuando eso pasa, el proceso muere y hay que levantar
// el server de nuevo a mano. Este wrapper detecta la caída, avisa en la
// terminal y vuelve a levantar el server solo. Ctrl+C lo detiene de verdad.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Por qué antes "nunca levantaba" (2026-08-23)
//
// El auto-reinicio convertía cualquier fallo PERMANENTE en un bucle infinito.
// El caso real: si quedaba un `next dev` huérfano —el wrapper muere de golpe y
// su hijo sobrevive—, ese huérfano se quedaba con el puerto Y con el fichero
// `.next/dev/lock`. Cada arranque nuevo moría al segundo con "Unable to acquire
// lock", el wrapper lo reiniciaba, y así para siempre. En pantalla solo se veía
// «Reiniciando automáticamente…» una y otra vez, sin la causa a la vista.
//
// Cuatro arreglos, y cada uno tapa un agujero distinto:
//
//   1. Se suelta también el LOCK, no solo el puerto. Liberar el puerto no servía
//      de nada si lo que estaba tomado era el lock.
//   2. El bucle tiene tope. Tres caídas seguidas en menos de 15s significa que
//      no es un crash pasajero de Turbopack, es algo que no se va a arreglar
//      solo: se para y se enseña la salida real en vez de seguir girando.
//   3. Al hijo se le mata el ÁRBOL entero (`taskkill /T`). En Windows matar solo
//      al hijo dejaba vivos al servidor y a los workers, que son justo los que
//      se quedaban con el puerto y el lock.
//   4. Se limpia también cuando el wrapper se va por las malas, no solo con
//      Ctrl+C. Los huérfanos salían de ahí.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || "3000";
const LOCK = path.join(process.cwd(), ".next", "dev", "lock");

/** Caídas seguidas que se consideran "no se arregla solo". */
const MAX_FALLOS_SEGUIDOS = 3;
/** Por debajo de esto, la caída no cuenta como "estuvo levantado". */
const ARRANQUE_MINIMO_MS = 15_000;

let child = null;
let stopping = false;
let manual = false;
let restarts = 0;
let fallosSeguidos = 0;

/** Mata un proceso y TODA su descendencia. Los workers son los que estorban. */
function matarArbol(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    /* ya no existe */
  }
}

// Libera el puerto por si el proceso caído dejó hijos (Turbopack/PostCSS)
// colgados que lo sigan ocupando; si no, el reinicio fallaría con EADDRINUSE.
function freePort() {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano", { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (!/LISTENING/i.test(line)) continue;
        // La dirección local es la SEGUNDA columna; mirar la línea entera hacía
        // que un puerto remoto igual al nuestro matara a un proceso inocente.
        const cols = line.trim().split(/\s+/);
        const local = cols[1] || "";
        if (!local.endsWith(`:${PORT}`)) continue;
        const pid = cols[cols.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) matarArbol(pid);
    } else {
      try {
        execSync(`lsof -ti tcp:${PORT} | xargs -r kill -9`, {
          stdio: "ignore",
          shell: "/bin/bash",
        });
      } catch {
        /* nada escuchando */
      }
    }
  } catch {
    /* netstat/lsof no disponible: seguimos igual */
  }
}

/**
 * Suelta el lock de Next.
 *
 * Se llama SIEMPRE después de `freePort()`, nunca antes: para entonces ya no
 * queda vivo nadie que pueda tenerlo tomado de verdad, así que lo que haya en
 * el disco es basura de una caída anterior. Borrarlo mientras otro dev server
 * legítimo corre sería pisarle el turno, y por eso el orden importa.
 */
function freeLock() {
  try {
    rmSync(LOCK, { force: true, recursive: true });
  } catch {
    /* no estaba, o lo tiene un proceso que ya no responde */
  }
}

function start() {
  freePort();
  freeLock();
  const startedAt = Date.now();

  child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev"],
    {
      // stdin "ignore": el padre se queda con el teclado para el comando de
      // reinicio (r + Enter); Next dev no necesita stdin.
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        // Un poco más de heap por si el worker de PostCSS se queda sin memoria.
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=8192`.trim(),
      },
    }
  );

  child.on("exit", (code, signal) => {
    const pid = child?.pid;
    child = null;
    if (stopping) return;

    // Que el hijo haya muerto no significa que sus workers también.
    matarArbol(pid);

    const upSec = Math.round((Date.now() - startedAt) / 1000);
    restarts += 1;

    if (manual) {
      manual = false;
      fallosSeguidos = 0;
      console.log(`\n\x1b[36m♻  Reiniciando a mano… (reinicio #${restarts})\x1b[0m\n`);
      setTimeout(start, 800);
      return;
    }

    // Si aguantó un rato, fue un crash pasajero: se reinicia y a otra cosa.
    if (Date.now() - startedAt >= ARRANQUE_MINIMO_MS) fallosSeguidos = 0;
    else fallosSeguidos += 1;

    if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
      console.error(
        `\n\x1b[31m✖  El dev server se cayó ${fallosSeguidos} veces seguidas sin llegar a ` +
          `levantar (la última en ${upSec}s, code=${code}, signal=${signal}).\x1b[0m\n` +
          `\x1b[31m   No es un crash pasajero de Turbopack: reiniciar otra vez daría lo mismo, ` +
          `así que paro aquí para que se vea el error de arriba en vez de taparlo.\x1b[0m\n\n` +
          `   Lo más común:\n` +
          `     · Un dev server huérfano de antes con el puerto ${PORT} o el lock tomados.\n` +
          `       Compruébalo con:  netstat -ano | findstr :${PORT}\n` +
          `     · Un error de compilación en el arranque — sale unas líneas más arriba.\n\n` +
          `   Cuando esté resuelto, vuelve a lanzar:  npm run dev\n`
      );
      stopping = true;
      freePort();
      freeLock();
      process.exit(1);
    }

    console.log(
      `\n\x1b[33m⚠  El dev server se detuvo (code=${code}, signal=${signal}) ` +
        `tras ${upSec}s. Reiniciando automáticamente… (reinicio #${restarts})\x1b[0m\n`
    );
    setTimeout(start, 800);
  });
}

// Reinicio manual instantáneo: 'r' + Enter mata el server y el handler de exit
// lo vuelve a levantar. Sirve cuando Turbopack se CUELGA (sin crashear) y la
// navegación deja de responder — el auto-reinicio por caída no lo detecta.
function manualRestart() {
  if (stopping) return;
  if (!child) { start(); return; }
  manual = true;
  matarArbol(child.pid);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  const cmd = String(data).trim().toLowerCase();
  if (cmd === "r" || cmd === "rs" || cmd === "restart") manualRestart();
});

function stop() {
  stopping = true;
  matarArbol(child?.pid);
  child = null;
  freePort();
  freeLock();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// Última red: si el wrapper se va por cualquier otra vía —excepción, cierre de
// terminal, el proceso padre que lo lanzó— el hijo NO puede quedarse vivo. De
// ahí salían los huérfanos que dejaban el puerto y el lock tomados.
process.on("exit", () => {
  if (!stopping) matarArbol(child?.pid);
});
process.on("uncaughtException", (err) => {
  console.error(err);
  stop();
});

console.log(
  "\x1b[36m▶  Dev con auto-reinicio activo (se levanta solo si se cae).\x1b[0m\n" +
  "\x1b[36m   Escribe 'r' + Enter para reiniciar a mano si se cuelga · Ctrl+C para detener.\x1b[0m"
);
start();
