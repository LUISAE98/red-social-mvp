// Dev server con auto-reinicio.
//
// Next 16 usa Turbopack, que ocasionalmente crashea al procesar el CSS de
// Tailwind (panic: "unable to handle stdout from the Node.js process… stream
// closed unexpectedly"). Cuando eso pasa, el proceso muere y hay que levantar
// el server de nuevo a mano. Este wrapper detecta la caída, avisa en la
// terminal y vuelve a levantar el server solo. Ctrl+C lo detiene de verdad.

import { spawn, execSync } from "node:child_process";

const PORT = process.env.PORT || "3000";
let child = null;
let stopping = false;
let manual = false;
let restarts = 0;

// Libera el puerto por si el proceso caído dejó hijos (Turbopack/PostCSS)
// colgados que lo sigan ocupando; si no, el reinicio fallaría con EADDRINUSE.
function freePort() {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano", { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (line.includes(`:${PORT} `) && /LISTENING/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && /^\d+$/.test(pid)) pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        } catch {
          /* ya no existe */
        }
      }
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

function start() {
  freePort();
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
    child = null;
    if (stopping) return;
    restarts += 1;
    if (manual) {
      manual = false;
      console.log(`\n\x1b[36m♻  Reiniciando a mano… (reinicio #${restarts})\x1b[0m\n`);
    } else {
      const upSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `\n\x1b[33m⚠  El dev server se detuvo (code=${code}, signal=${signal}) ` +
          `tras ${upSec}s. Reiniciando automáticamente… (reinicio #${restarts})\x1b[0m\n`
      );
    }
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
  try { child.kill("SIGINT"); } catch { /* ya murió */ }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  const cmd = String(data).trim().toLowerCase();
  if (cmd === "r" || cmd === "rs" || cmd === "restart") manualRestart();
});

function stop() {
  stopping = true;
  if (child) {
    try {
      child.kill("SIGINT");
    } catch {
      /* ya murió */
    }
  }
  freePort();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(
  "\x1b[36m▶  Dev con auto-reinicio activo (se levanta solo si se cae).\x1b[0m\n" +
  "\x1b[36m   Escribe 'r' + Enter para reiniciar a mano si se cuelga · Ctrl+C para detener.\x1b[0m"
);
start();
