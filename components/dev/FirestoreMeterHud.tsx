"use client";

/**
 * Marcador del medidor de lecturas de Firestore — SOLO DESARROLLO.
 *
 * Enseña, en vivo y por pantalla, cuántas consultas se abrieron, cuántas
 * escuchas quedan vivas, cuántos documentos llegaron y qué parte salió de la
 * caché local. Los números los cuenta `lib/dev/firestoreMeter.ts`; esto solo los
 * pinta.
 *
 * No se ve nada salvo que `NEXT_PUBLIC_FS_METER=1` esté en `.env.local`, que es
 * la misma bandera que enchufa el medidor en `next.config.ts`. Sin ella este
 * componente devuelve `null` antes de leer nada, así que en producción no pesa
 * más que su propia definición.
 *
 * El contador se pone a cero en cada cambio de pantalla, porque la pregunta que
 * responde es «¿cuánto cuesta ESTA pantalla?», no «¿cuánto llevamos hoy?».
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const ACTIVO = process.env.NEXT_PUBLIC_FS_METER === "1";

type Resumen = {
  pantalla: string;
  consultas: number;
  escuchasAbiertas: number;
  docs: number;
  desdeCache: number;
};

type MedidorGlobal = {
  reiniciar: (pantalla?: string) => void;
  resumen: () => Resumen;
  imprimir: () => void;
  suscribir: (fn: () => void) => () => void;
};

function leerMedidor(): MedidorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __vibraFsMeter?: MedidorGlobal }).__vibraFsMeter ?? null;
}

const VACIO: Resumen = {
  pantalla: "",
  consultas: 0,
  escuchasAbiertas: 0,
  docs: 0,
  desdeCache: 0,
};

export default function FirestoreMeterHud() {
  const pathname = usePathname();
  const [resumen, setResumen] = useState<Resumen>(VACIO);
  const [plegado, setPlegado] = useState(false);

  // El medidor se crea de forma perezosa, en la primera lectura: cuando este
  // componente monta puede no existir todavía. Por eso se sondea hasta que
  // aparece, en vez de suscribirse una sola vez y quedarse esperando siempre.
  useEffect(() => {
    if (!ACTIVO) return;

    let desuscribir: (() => void) | null = null;
    let intervalo: ReturnType<typeof setInterval> | null = null;

    const refrescar = () => {
      const m = leerMedidor();
      if (m) setResumen(m.resumen());
    };

    const intentarSuscribir = () => {
      const m = leerMedidor();
      if (!m) return false;
      desuscribir = m.suscribir(refrescar);
      refrescar();
      return true;
    };

    if (!intentarSuscribir()) {
      intervalo = setInterval(() => {
        if (intentarSuscribir() && intervalo) {
          clearInterval(intervalo);
          intervalo = null;
        }
      }, 250);
    }

    return () => {
      desuscribir?.();
      if (intervalo) clearInterval(intervalo);
    };
  }, []);

  // Cambiar de pantalla pone el contador a cero.
  useEffect(() => {
    if (!ACTIVO) return;
    // `reiniciar` avisa a sus suscriptores, y este componente es uno: el
    // refresco del estado llega por ahí, no hace falta un setState aquí.
    leerMedidor()?.reiniciar(pathname ?? undefined);
  }, [pathname]);

  if (!ACTIVO) return null;

  const porcentajeCache =
    resumen.consultas > 0
      ? Math.round((resumen.desdeCache / resumen.consultas) * 100)
      : 0;

  // Semáforo sobre el número de consultas de una pantalla. Los umbrales salen
  // de la auditoría: el envoltorio autenticado abría ~25 antes de que la página
  // pidiera su primer dato, así que 25 es «como estábamos» y 12 el objetivo del
  // bloque 2.
  const color =
    resumen.consultas <= 12 ? "#3dd68c" : resumen.consultas <= 25 ? "#f0b558" : "#ff8296";

  return (
    <div
      style={{
        position: "fixed",
        insetInlineEnd: 10,
        // Los 10px se cuentan desde el borde de la PANTALLA, no desde el área
        // de dibujo, que en la PWA de iPhone es más corta. Sin la resta el HUD
        // flota 62px por encima de donde debería.
        bottom: "calc(10px - var(--vb-lienzo-extra))",
        zIndex: 2147483000,
        background: "rgba(10, 8, 16, 0.92)",
        border: "1px solid rgba(168, 85, 247, 0.45)",
        borderRadius: 8,
        color: "#ece9f5",
        font: "500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: plegado ? "5px 9px" : "9px 11px",
        pointerEvents: "auto",
        backdropFilter: "blur(6px)",
        minWidth: plegado ? 0 : 168,
        userSelect: "none",
      }}
    >
      <button
        type="button"
        onClick={() => setPlegado((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
        }}
        aria-expanded={!plegado}
        title={plegado ? "Abrir el medidor" : "Plegar el medidor"}
      >
        <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
        <b style={{ color, fontWeight: 700 }}>{resumen.consultas}</b>
        <span style={{ opacity: 0.55 }}>{plegado ? "consultas" : "consultas Firestore"}</span>
      </button>

      {!plegado && (
        <>
          <div style={{ marginTop: 7, display: "grid", gap: 2, opacity: 0.8 }}>
            <div>escuchas vivas · {resumen.escuchasAbiertas}</div>
            <div>documentos · {resumen.docs}</div>
            <div>
              desde caché · {resumen.desdeCache}/{resumen.consultas}{" "}
              <span style={{ opacity: 0.6 }}>({porcentajeCache}%)</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => leerMedidor()?.imprimir()}
            style={{
              all: "unset",
              cursor: "pointer",
              marginTop: 8,
              display: "block",
              width: "100%",
              textAlign: "center",
              padding: "4px 0",
              borderRadius: 5,
              background: "rgba(168, 85, 247, 0.18)",
              color: "#d3b3ff",
            }}
          >
            Ver el desglose en consola
          </button>
        </>
      )}
    </div>
  );
}
