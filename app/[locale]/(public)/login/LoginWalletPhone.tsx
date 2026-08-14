"use client";

import { useEffect, useState } from "react";

/**
 * Wallet SIMULADA dentro de un celular, para el panel de creador del login.
 *
 * Los datos son de ejemplo, pero la interfaz funciona de verdad: se cambia de
 * pestaña, se abre la hoja de retiro, se elige monto y se confirma. Lo único
 * que no ocurre es el movimiento de dinero — no hay ninguna llamada a la wallet
 * real ni a Firestore, es una demostración cerrada en este componente.
 *
 * Vive en el login (y no junto a la wallet real) a propósito: así ningún cambio
 * de esta demo puede tocar la infraestructura financiera.
 */

const MOVIMIENTOS = [
  { etiqueta: "Sesión exclusiva", detalle: "Hoy, 18:40", monto: "+$1,200" },
  { etiqueta: "Ticket de live", detalle: "Hoy, 17:02", monto: "+$350" },
  { etiqueta: "Saludo personalizado", detalle: "Ayer", monto: "+$230" },
  { etiqueta: "Consejo", detalle: "Ayer", monto: "+$180" },
  { etiqueta: "Donación", detalle: "Ayer", monto: "+$120" },
  { etiqueta: "Suscripción", detalle: "2 días", monto: "+$99" },
  { etiqueta: "Supercomentario", detalle: "2 días", monto: "+$60" },
];

/** Alturas relativas de las barras de ingresos por mes. */
const BARRAS = [42, 58, 50, 72, 63, 88];

const MONTOS = ["$1,000", "$5,000", "Todo"] as const;

type Pestana = "finanzas" | "estadisticas";
type PasoRetiro = "cerrado" | "monto" | "enviando" | "listo";

export default function LoginWalletPhone() {
  const [pestana, setPestana] = useState<Pestana>("finanzas");
  const [paso, setPaso] = useState<PasoRetiro>("cerrado");
  const [monto, setMonto] = useState<(typeof MONTOS)[number]>("Todo");

  // El "envío" es puro teatro: un momento de espera y listo. Sin él, confirmar
  // se sentiría falso; con él, se lee como una operación real.
  useEffect(() => {
    if (paso !== "enviando") return;
    const id = setTimeout(() => setPaso("listo"), 900);
    return () => clearTimeout(id);
  }, [paso]);

  return (
    <div className="phone">
      <style jsx>{`
        .phone {
          position: relative;
          flex-shrink: 0;
          width: 232px;
          aspect-ratio: 9 / 19;
          border-radius: 34px;
          padding: 8px;
          box-sizing: border-box;
          background: linear-gradient(155deg, #16131c 0%, #0a0810 100%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow:
            0 24px 60px rgba(0, 0, 0, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        /* Muesca superior. */
        .phone::before {
          content: "";
          position: absolute;
          top: 11px;
          left: 50%;
          transform: translateX(-50%);
          width: 52px;
          height: 5px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.16);
          z-index: 3;
        }

        .screen {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 27px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: radial-gradient(120% 90% at 50% 0%, #12101c 0%, #05040a 60%);
          color: #fff;
        }

        .status {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px 2px;
          font-size: 9px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.7);
        }

        .head {
          padding: 6px 14px 10px;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .saldoCard {
          margin: 0 12px;
          padding: 12px 14px;
          border-radius: 16px;
          background: linear-gradient(140deg, rgba(168, 85, 247, 0.22), rgba(79, 70, 255, 0.14));
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .saldoLabel {
          font-size: 9.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.6);
        }
        .saldoMonto {
          margin-top: 3px;
          font-size: 25px;
          font-weight: 800;
          letter-spacing: -0.03em;
        }
        .saldoPie {
          margin-top: 3px;
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.5);
        }

        .retirar {
          width: 100%;
          margin-top: 10px;
          padding: 8px 0;
          border: none;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
        }

        .tabs {
          display: flex;
          gap: 4px;
          width: fit-content;
          margin: 12px auto 8px;
          padding: 3px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
        }
        .tab {
          padding: 4px 12px;
          border: none;
          border-radius: 999px;
          background: transparent;
          font-size: 10px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.55);
          cursor: pointer;
        }
        .tabOn {
          background: rgba(255, 255, 255, 0.14);
          color: #fff;
        }

        .body {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          padding: 0 12px 12px;
        }

        .mov {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 0;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .movNombre {
          font-size: 10.5px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .movDetalle {
          margin-top: 1px;
          font-size: 8.5px;
          color: rgba(255, 255, 255, 0.45);
        }
        .movMonto {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
          color: #4ade80;
        }

        .grafica {
          display: flex;
          align-items: flex-end;
          gap: 7px;
          height: 96px;
          margin-top: 6px;
        }
        .barra {
          flex: 1;
          border-radius: 5px 5px 2px 2px;
          background: linear-gradient(180deg, #a855f7, #4f46ff);
        }
        .statTitulo {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.55);
        }
        .statPie {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          margin-top: 12px;
        }
        .statMes {
          font-size: 9px;
          color: rgba(255, 255, 255, 0.5);
        }
        .statValor {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .statCrece {
          font-size: 11px;
          font-weight: 700;
          color: #22c55e;
        }

        /* Hoja de retiro: sube desde abajo, dentro de la pantalla. */
        .hoja {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          background: rgba(0, 0, 0, 0.55);
          z-index: 2;
        }
        .hojaPanel {
          padding: 16px 14px 18px;
          border-radius: 22px 22px 27px 27px;
          background: #14121c;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          animation: subir 260ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes subir {
          from {
            transform: translateY(24px);
            opacity: 0;
          }
          to {
            transform: none;
            opacity: 1;
          }
        }
        .hojaTitulo {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .hojaTexto {
          margin-top: 4px;
          font-size: 9.5px;
          line-height: 1.45;
          color: rgba(255, 255, 255, 0.55);
        }
        .montos {
          display: flex;
          gap: 6px;
          margin-top: 12px;
        }
        .montoChip {
          flex: 1;
          padding: 7px 0;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          font-size: 10px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
        }
        .montoOn {
          border-color: #a855f7;
          background: rgba(168, 85, 247, 0.18);
          color: #fff;
        }
        .destino {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 12px;
          padding: 9px 11px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.05);
          font-size: 10px;
          color: rgba(255, 255, 255, 0.75);
        }
        .hojaAcciones {
          display: flex;
          gap: 8px;
          margin-top: 14px;
        }
        .btnFantasma {
          flex: 0 0 auto;
          padding: 9px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: transparent;
          font-size: 11px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.75);
          cursor: pointer;
        }
        .btnPrincipal {
          flex: 1;
          padding: 9px 0;
          border: none;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
        }
        .btnPrincipal[disabled] {
          opacity: 0.7;
          cursor: default;
        }

        .exito {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 6px 0 2px;
        }
        .exitoCheck {
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(34, 197, 94, 0.16);
          color: #4ade80;
        }

        /* Aviso permanente de que es una demostración: nadie debe creer que
           está operando su dinero de verdad. */
        .demo {
          position: absolute;
          top: 10px;
          right: 10px;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          font-size: 7.5px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.7);
          z-index: 3;
        }

        @media (max-width: 900px) {
          .phone {
            width: 210px;
          }
        }
      `}</style>

      <div className="screen">
        <span className="demo">Demo</span>

        <div className="status">
          <span>9:41</span>
          <span>•••</span>
        </div>

        <div className="head">Wallet</div>

        <div className="saldoCard">
          <div className="saldoLabel">Disponible</div>
          <div className="saldoMonto">$12,450</div>
          <div className="saldoPie">MXN · $1,200 en proceso</div>
          <button type="button" className="retirar" onClick={() => setPaso("monto")}>
            Retirar
          </button>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={`tab${pestana === "finanzas" ? " tabOn" : ""}`}
            onClick={() => setPestana("finanzas")}
          >
            Movimientos
          </button>
          <button
            type="button"
            className={`tab${pestana === "estadisticas" ? " tabOn" : ""}`}
            onClick={() => setPestana("estadisticas")}
          >
            Ingresos
          </button>
        </div>

        <div className="body">
          {pestana === "finanzas" ? (
            MOVIMIENTOS.map((m) => (
              <div key={m.etiqueta} className="mov">
                <div style={{ minWidth: 0 }}>
                  <div className="movNombre">{m.etiqueta}</div>
                  <div className="movDetalle">{m.detalle}</div>
                </div>
                <span className="movMonto">{m.monto}</span>
              </div>
            ))
          ) : (
            <>
              <div className="statTitulo">Últimos 6 meses</div>
              <div className="grafica">
                {BARRAS.map((h, i) => (
                  <span key={i} className="barra" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="statPie">
                <div>
                  <div className="statMes">Este mes</div>
                  <div className="statValor">$8,900</div>
                </div>
                <span className="statCrece">+18%</span>
              </div>
            </>
          )}
        </div>

        {paso !== "cerrado" && (
          <div className="hoja">
            <div className="hojaPanel">
              {paso === "listo" ? (
                <div className="exito">
                  <span className="exitoCheck">
                    <svg
                      width={20}
                      height={20}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <div className="hojaTitulo" style={{ marginTop: 10 }}>
                    Retiro solicitado
                  </div>
                  <div className="hojaTexto">
                    Llega a tu cuenta en 1 o 2 días hábiles. Aquí no se movió dinero, es una
                    demostración.
                  </div>
                  <button
                    type="button"
                    className="btnPrincipal"
                    style={{ marginTop: 14 }}
                    onClick={() => setPaso("cerrado")}
                  >
                    Entendido
                  </button>
                </div>
              ) : (
                <>
                  <div className="hojaTitulo">Retirar a tu cuenta</div>
                  <div className="hojaTexto">Sin comisión por retiro. Mínimo $100.</div>

                  <div className="montos">
                    {MONTOS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`montoChip${monto === m ? " montoOn" : ""}`}
                        onClick={() => setMonto(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  <div className="destino">
                    <span>Cuenta ···· 4821</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>Cambiar</span>
                  </div>

                  <div className="hojaAcciones">
                    <button
                      type="button"
                      className="btnFantasma"
                      onClick={() => setPaso("cerrado")}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btnPrincipal"
                      disabled={paso === "enviando"}
                      onClick={() => setPaso("enviando")}
                    >
                      {paso === "enviando" ? "Enviando…" : `Retirar ${monto}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
