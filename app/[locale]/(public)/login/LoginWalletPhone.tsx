"use client";

import { useEffect, useRef, useState } from "react";
import { TextButton, IconButton } from "@/components/ui";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
  type VibraNavigationIconType,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

/**
 * La wallet REAL, simulada dentro de un celular, para el panel de creador del
 * login.
 *
 * Copia la interfaz de `app/[locale]/(protected)/wallet` —encabezado, subnav de
 * cinco pestañas con su indicador deslizante, tarjeta de finanzas, cifras y
 * listas— con datos de ejemplo. Se puede cambiar de pestaña, ocultar el saldo y
 * alternar neto/bruto; lo que NO hay es nada real detrás, ni Firestore, ni
 * funciones, ni dinero que se mueva.
 *
 * ⚠️ Se escribe a TAMAÑO REAL (título de 34px, iconos de 28px, saldo de 40px) en
 * un lienzo de 360px de ancho —un celular de verdad— y se reduce con `scale` para que
 * quepa en el mockup. Así es una miniatura fiel y no una versión reproporcionada
 * que se parecería de lejos pero no de cerca. Si cambia la wallet real, aquí se
 * cambian los mismos valores, no unos equivalentes.
 */

/**
 * Geometría del mockup y del lienzo. La escala SALE de aquí, no de un número
 * escrito a ojo: si cambia el ancho del celular, todo lo demás se recalcula.
 */
const PHONE_W = 236;
const PHONE_PAD = 8;
/** Ancho y alto de la pantalla del mockup (marco 9:19 menos su relleno). */
const SCREEN_W = PHONE_W - PHONE_PAD * 2;
const SCREEN_H = Math.round((PHONE_W * 19) / 9) - PHONE_PAD * 2;
/** Lienzo interno, en píxeles de celular real. */
const VP_W = 360;
const SCALE = SCREEN_W / VP_W;
const VP_H = Math.round(SCREEN_H / SCALE);

type TabKey = "finances" | "statistics" | "calendar" | "pending" | "history";

const TABS: { key: TabKey; icon: VibraNavigationIconType }[] = [
  { key: "finances", icon: "coin" },
  { key: "statistics", icon: "finance" },
  { key: "calendar", icon: "calendar" },
  { key: "pending", icon: "history" },
  { key: "history", icon: "pending" },
];

const MOVIMIENTOS = [
  { nombre: "Sesión exclusiva", detalle: "Hoy · 18:40", monto: "$1,200.00" },
  { nombre: "Ticket de live", detalle: "Hoy · 17:02", monto: "$350.00" },
  { nombre: "Saludo personalizado", detalle: "Ayer · 21:15", monto: "$230.00" },
  { nombre: "Consejo", detalle: "Ayer · 12:30", monto: "$180.00" },
  { nombre: "Donación", detalle: "12 sep · 20:05", monto: "$120.00" },
  { nombre: "Suscripción", detalle: "11 sep · 09:12", monto: "$99.00" },
  { nombre: "Supercomentario", detalle: "10 sep · 22:48", monto: "$60.00" },
];

const PENDIENTES = [
  { nombre: "Meet & greet", detalle: "Se libera el 18 de septiembre", monto: "$900.00" },
  { nombre: "Sesión exclusiva", detalle: "Se libera el 20 de septiembre", monto: "$1,200.00" },
  { nombre: "Saludo personalizado", detalle: "Se libera el 22 de septiembre", monto: "$230.00" },
];

const RETIROS = [
  { nombre: "Retiro a cuenta ···· 4821", detalle: "1 sep · Completado", monto: "$8,400.00" },
  { nombre: "Retiro a cuenta ···· 4821", detalle: "1 ago · Completado", monto: "$6,150.00" },
  { nombre: "Retiro a cuenta ···· 4821", detalle: "1 jul · Completado", monto: "$5,020.00" },
];

/** Ingresos por mes (altura relativa) y su etiqueta. */
const MESES = [
  { label: "abr", alto: 42 },
  { label: "may", alto: 58 },
  { label: "jun", alto: 50 },
  { label: "jul", alto: 72 },
  { label: "ago", alto: 63 },
  { label: "sep", alto: 88 },
];

export default function LoginWalletPhone() {
  const [tab, setTab] = useState<TabKey>("finances");
  const [modo, setModo] = useState<"net" | "gross">("net");
  const [saldoOculto, setSaldoOculto] = useState(false);

  // Indicador deslizante del subnav, igual que en la wallet real: una sola
  // barra que se mueve entre pestañas en vez de una por pestaña.
  const navRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicador, setIndicador] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const i = TABS.findIndex((t) => t.key === tab);
    const el = tabRefs.current[i];
    const nav = navRef.current;
    if (!el || !nav) return;
    const r = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    // El ancho medido viene ya reducido por el scale del contenedor; se corrige
    // con la proporción del propio nav para trabajar en píxeles del lienzo.
    const escala = r.width === 0 ? 1 : nav.offsetWidth / nr.width;
    const ancho = Math.min(72, r.width * escala - 20);
    setIndicador({
      left: (r.left - nr.left) * escala + (r.width * escala - ancho) / 2,
      width: ancho,
    });
  }, [tab]);

  const cifra = (texto: string) => (saldoOculto ? "•".repeat(Math.max(4, texto.length - 4)) : texto);

  return (
    <div className="phone">
      <style jsx>{`
        .phone {
          position: relative;
          flex-shrink: 0;
          width: ${PHONE_W}px;
          aspect-ratio: 9 / 19;
          border-radius: 34px;
          padding: ${PHONE_PAD}px;
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
          background: #000;
        }


        /* A la altura del título "Wallet". La cuenta es en píxeles de PANTALLA:
           la barra de estado y media línea del título, del lienzo, por la escala.
           Va fuera del lienzo para que no se encoja con él y siga legible. */
        .demo {
          position: absolute;
          top: ${Math.round((52 + 17) * SCALE) - 7}px;
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
      `}</style>

      <div className="screen">
        <span className="demo">Demo</span>
        <Viewport
          tab={tab}
          setTab={setTab}
          navRef={navRef}
          tabRefs={tabRefs}
          indicador={indicador}
          modo={modo}
          setModo={setModo}
          saldoOculto={saldoOculto}
          setSaldoOculto={setSaldoOculto}
          cifra={cifra}
        />
      </div>
    </div>
  );
}

function Viewport({
  tab,
  setTab,
  navRef,
  tabRefs,
  indicador,
  modo,
  setModo,
  saldoOculto,
  setSaldoOculto,
  cifra,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  navRef: React.RefObject<HTMLDivElement | null>;
  tabRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  indicador: { left: number; width: number } | null;
  modo: "net" | "gross";
  setModo: (m: "net" | "gross") => void;
  saldoOculto: boolean;
  setSaldoOculto: (v: boolean) => void;
  cifra: (t: string) => string;
}) {
  return (
    <div className="vp">
      <style jsx>{`
        /* Lienzo de celular real, encogido hasta el ancho de la pantalla del
           mockup. El alto se deriva de la escala, así que llena el marco exacto. */
        .vp {
          position: absolute;
          top: 0;
          left: 0;
          width: ${VP_W}px;
          height: ${VP_H}px;
          /* zoom y NO transform: scale(). Con scale, el navegador dibuja el
             texto a tamaño completo y luego encoge esa imagen, así que las
             letras salen borrosas y tiemblan en cuanto algo se mueve o se
             desplaza. Con zoom se vuelve a maquetar al tamaño reducido y cada
             letra se dibuja nítida, que es como se ve un celular de verdad. */
          zoom: ${SCALE};
          display: flex;
          flex-direction: column;
          padding: 0 12px;
          box-sizing: border-box;
          background: radial-gradient(120% 80% at 50% 0%, #14111f 0%, #000 62%);
          color: #fff;
        }

        /* Barra de estado del sistema. Ocupa la zona segura de arriba, que en un
           celular de verdad no es del contenido sino de la hora y la batería. */
        .status {
          flex-shrink: 0;
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 6px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #fff;
        }
        .statusIcons {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: rgba(255, 255, 255, 0.9);
        }

        /* Encabezado: mismas medidas que la wallet en celular. */
        .head {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 4px;
          flex-shrink: 0;
        }
        .title {
          margin: 0;
          font-size: 34px;
          line-height: 0.98;
          letter-spacing: -0.04em;
          font-weight: 700;
        }

        /* Subnav de 5 pestañas con indicador deslizante. */
        .nav {
          position: relative;
          width: 100%;
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          align-items: stretch;
        }
        .tab {
          min-width: 0;
          min-height: 52px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 8px 10px;
          border: none;
          background: transparent;
          color: rgba(168, 85, 247, 0.55);
          cursor: pointer;
          transition: color 0.18s ease;
        }
        .tabOn {
          color: #c084fc;
        }
        .indicator {
          position: absolute;
          bottom: 7px;
          height: 3px;
          border-radius: 999px;
          background: #a855f7;
          transition:
            left 0.28s cubic-bezier(0.4, 0, 0.2, 1),
            width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Cuerpo desplazable. */
        .body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: none;
          padding-bottom: 18px;
        }
        .body::-webkit-scrollbar {
          display: none;
        }

        .card {
          border-radius: 22px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 22px;
          padding-top: 4px;
        }

        .controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .toggle {
          display: inline-flex;
          padding: 3px;
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          gap: 2px;
        }
        .toggleBtn {
          border: none;
          cursor: pointer;
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: rgba(255, 255, 255, 0.6);
          background: transparent;
          transition:
            color 150ms ease,
            background 150ms ease;
        }
        .toggleOn {
          color: #fff;
          background: linear-gradient(135deg, #4f46ff, #a855f7);
        }
        /* Un switch a cada extremo, igual que en la wallet real: a la izquierda
           cómo se lee el dinero (neto o bruto), a la derecha en qué moneda. */
        .controlsStart {
          flex: 1;
          min-width: 0;
          display: flex;
          justify-content: flex-start;
        }
        .controlsEnd {
          flex: 1;
          min-width: 0;
          display: flex;
          justify-content: flex-end;
        }

        /* La moneda comparte la pastilla del switch de neto/bruto, que es como
           se ve en la wallet real, pero aquí es DECORATIVA — de ahí que sean
           spans y no botones, sin cursor ni foco.

           Cambiarla de verdad obligaría a convertir cada cifra de la pantalla, y
           detrás de este mockup no hay tipo de cambio ninguno. Un botón que no
           hace nada miente más que un rótulo que no invita a pulsarlo. */
        .monedaBtn {
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: rgba(255, 255, 255, 0.6);
          font-variant-numeric: tabular-nums;
        }
        .monedaOn {
          color: #fff;
          background: linear-gradient(135deg, #4f46ff, #a855f7);
        }

        .availWrap {
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: center;
          text-align: center;
        }
        .availRow {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        .availAmount {
          font-size: 40px;
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.05;
          color: #4ade80;
          font-variant-numeric: tabular-nums;
        }
        .eye {
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.55);
          cursor: pointer;
          padding: 6px;
          border-radius: 8px;
          display: inline-flex;
          line-height: 0;
        }

        /* El color, el tamaño y el peso salen de TextButton; aquí solo lo que
           el primitivo no sabe: cómo se coloca en su sitio. */
        .altaCta {
          width: 100%;
          margin-top: -14px;
          line-height: 1.35;
          text-align: center;
          justify-content: center;
        }

        .tres {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .col {
          flex: 1;
          min-width: 0;
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .colLabel {
          font-size: 12px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.6);
          letter-spacing: -0.01em;
        }
        .colValue {
          font-size: 17px;
          font-weight: 640;
          letter-spacing: -0.02em;
          color: rgba(255, 255, 255, 0.9);
        }
        .colFoot {
          font-size: 10.5px;
          color: rgba(255, 255, 255, 0.4);
        }

        .legend {
          font-size: 11.5px;
          line-height: 1.45;
          color: rgba(255, 255, 255, 0.42);
          text-align: center;
          margin-top: -12px;
        }

        .listTitle {
          font-size: 18px;
          font-weight: 600;
          color: #fff;
          padding: 0 18px;
          margin-bottom: 8px;
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .rowName {
          font-size: 13.5px;
          font-weight: 600;
          color: #fff;
        }
        .rowMeta {
          margin-top: 2px;
          font-size: 11.5px;
          color: rgba(255, 255, 255, 0.45);
        }
        .rowAmount {
          flex-shrink: 0;
          font-size: 14px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: #fff;
        }

        /* Estadísticas */
        .chart {
          display: flex;
          align-items: flex-end;
          gap: 10px;
          height: 180px;
          padding: 0 18px;
        }
        .barWrap {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .bar {
          width: 100%;
          border-radius: 8px 8px 3px 3px;
          background: linear-gradient(180deg, #a855f7, #4f46ff);
        }
        .barLabel {
          font-size: 10.5px;
          color: rgba(255, 255, 255, 0.45);
        }

        /* Calendario */
        .cal {
          padding: 0 18px;
        }
        .calGrid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
          margin-top: 10px;
        }
        .calDay {
          aspect-ratio: 1 / 1;
          display: grid;
          place-items: center;
          border-radius: 10px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.65);
          background: rgba(255, 255, 255, 0.04);
        }
        .calBusy {
          color: #fff;
          font-weight: 700;
          background: linear-gradient(135deg, #4f46ff, #a855f7);
        }
        .calHead {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          text-align: center;
        }
      `}</style>

      <VibraNavigationIconsStyles />

      <div className="status">
        <span>9:41</span>
        <span className="statusIcons" aria-hidden="true">
          {/* Cobertura */}
          <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
            <rect x="0" y="8" width="3" height="4" rx="1" />
            <rect x="4.5" y="5.5" width="3" height="6.5" rx="1" />
            <rect x="9" y="3" width="3" height="9" rx="1" />
            <rect x="13.5" y="0" width="3" height="12" rx="1" opacity="0.4" />
          </svg>
          {/* Wifi */}
          <svg width="15" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M2.6 8.6a15 15 0 0 1 18.8 0" />
            <path d="M6.2 12.4a10 10 0 0 1 11.6 0" />
            <path d="M9.8 16.2a5 5 0 0 1 4.4 0" />
            <circle cx="12" cy="19.6" r="1" fill="currentColor" stroke="none" />
          </svg>
          {/* Batería */}
          <svg width="24" height="12" viewBox="0 0 26 12" fill="none">
            <rect x="0.6" y="0.6" width="21" height="10.8" rx="3" stroke="currentColor" strokeOpacity="0.5" />
            <rect x="2.2" y="2.2" width="16" height="7.6" rx="1.8" fill="currentColor" />
            <path d="M23.4 4.2v3.6a2 2 0 0 0 0-3.6Z" fill="currentColor" fillOpacity="0.5" />
          </svg>
        </span>
      </div>

      <div className="head">
        <h1 className="title">Wallet</h1>

        <div className="nav" ref={navRef}>
          {TABS.map((t, i) => (
            <button
              key={t.key}
              type="button"
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              className={`tab${tab === t.key ? " tabOn" : ""}`}
              onClick={() => setTab(t.key)}
              aria-label={t.key}
              aria-current={tab === t.key ? "page" : undefined}
            >
              <VibraNavigationIcon type={t.icon} size={28} strokeWidth={2} />
            </button>
          ))}

          {indicador ? (
            <span
              className="indicator"
              style={{ left: indicador.left, width: indicador.width }}
            />
          ) : null}
        </div>
      </div>

      <div className="body">
        {tab === "finances" && (
          <>
            <div className="card">
              <div className="controls">
                <div className="controlsStart">
                  <div className="toggle" role="tablist">
                    {(["net", "gross"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={modo === k}
                        className={`toggleBtn${modo === k ? " toggleOn" : ""}`}
                        onClick={() => setModo(k)}
                      >
                        {k === "net" ? "Neto" : "Bruto"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="controlsEnd">
                  {/* Decorativo; ver .monedaBtn. Va oculto a los lectores de
                      pantalla porque no es un control, es un dibujo de uno. */}
                  <div className="toggle" aria-hidden="true">
                    <span className="monedaBtn">USD</span>
                    <span className="monedaBtn monedaOn">MXN</span>
                  </div>
                </div>
              </div>

              <div className="availWrap">
                <div className="availRow">
                  <div className="availAmount">
                    {cifra(modo === "net" ? "$12,450.00" : "$16,600.00")}
                  </div>
                  <IconButton label={saldoOculto ? "Mostrar monto" : "Ocultar monto"} size="sm" tone="bare" shape="square" className="eye" onClick={() => setSaldoOculto(!saldoOculto)} aria-pressed={saldoOculto}>
                    {saldoOculto ? (
                      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </IconButton>
                </div>
              </div>

              {/* El mismo texto que la wallet real (clave `kycWithdrawCta`). Decía
                  "registro de cuenta Stripe", que se quedó viejo — la identidad ya no
                  se verifica en el alta de Stripe. */}
              <TextButton tone="brand" size="sm" className="altaCta">
                Realiza tu registro KYC para poder hacer retiros y facturas
              </TextButton>

              {/* Sin "monto por liberar": en la wallet real esa columna solo aparece
                  cuando hay algo que liberar, y un creador que llega al login no tiene
                  nada. Las dos que quedan son `flex: 1` y se reparten el ancho solas. */}
              <div className="tres">
                <div className="col">
                  <div className="colLabel">Mejor mes</div>
                  <div className="colValue">{cifra("$18,940.00")}</div>
                  <div className="colFoot">agosto 2026</div>
                </div>
                <div className="col">
                  <div className="colLabel">Ganado histórico</div>
                  <div className="colValue">{cifra("$96,120.00")}</div>
                </div>
              </div>

              <div className="legend">
                {modo === "net"
                  ? "Estos montos ya incluyen el descuento del 25% de comisión de Vibra."
                  : "A estos montos aún no se les descuenta el 25% de comisión de Vibra."}
              </div>
            </div>

            <div className="listTitle">Movimientos</div>
            {MOVIMIENTOS.map((m) => (
              <div key={m.nombre} className="row">
                <div style={{ minWidth: 0 }}>
                  <div className="rowName">{m.nombre}</div>
                  <div className="rowMeta">{m.detalle}</div>
                </div>
                <span className="rowAmount">{cifra(m.monto)}</span>
              </div>
            ))}
          </>
        )}

        {tab === "statistics" && (
          <>
            <div className="listTitle" style={{ marginTop: 10 }}>
              Ingresos por mes
            </div>
            <div className="chart">
              {MESES.map((m) => (
                <span key={m.label} className="barWrap">
                  <span className="bar" style={{ height: `${m.alto}%` }} />
                  <span className="barLabel">{m.label}</span>
                </span>
              ))}
            </div>

            <div className="card" style={{ gap: 14, paddingTop: 18 }}>
              <div className="tres">
                <div className="col">
                  <div className="colLabel">Este mes</div>
                  <div className="colValue">{cifra("$18,940.00")}</div>
                  <div className="colFoot" style={{ color: "#22c55e" }}>
                    +18%
                  </div>
                </div>
                <div className="col">
                  <div className="colLabel">Compradores</div>
                  <div className="colValue">142</div>
                </div>
                <div className="col">
                  <div className="colLabel">Ticket medio</div>
                  <div className="colValue">{cifra("$133.00")}</div>
                </div>
              </div>
            </div>

            <div className="listTitle">Por experiencia</div>
            {[
              { nombre: "Sesiones exclusivas", detalle: "38%", monto: "$7,200.00" },
              { nombre: "Suscripciones", detalle: "24%", monto: "$4,540.00" },
              { nombre: "Tickets de live", detalle: "19%", monto: "$3,600.00" },
              { nombre: "Saludos y consejos", detalle: "19%", monto: "$3,600.00" },
            ].map((s) => (
              <div key={s.nombre} className="row">
                <div style={{ minWidth: 0 }}>
                  <div className="rowName">{s.nombre}</div>
                  <div className="rowMeta">{s.detalle}</div>
                </div>
                <span className="rowAmount">{cifra(s.monto)}</span>
              </div>
            ))}
          </>
        )}

        {tab === "calendar" && (
          <div className="cal">
            <div className="listTitle" style={{ padding: 0, marginTop: 10 }}>
              Septiembre
            </div>
            <div className="calHead">
              {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="calGrid">
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                <span key={d} className={`calDay${d === 15 || d === 20 || d === 26 ? " calBusy" : ""}`}>
                  {d}
                </span>
              ))}
            </div>

            <div className="listTitle" style={{ padding: 0, marginTop: 18 }}>
              Agendadas
            </div>
            {[
              { nombre: "Sesión exclusiva", detalle: "15 sep · 19:00", monto: "60 min" },
              { nombre: "Meet & greet", detalle: "20 sep · 18:30", monto: "15 min" },
              { nombre: "Sesión exclusiva", detalle: "26 sep · 20:00", monto: "45 min" },
            ].map((s) => (
              <div key={s.detalle} className="row" style={{ paddingInline: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="rowName">{s.nombre}</div>
                  <div className="rowMeta">{s.detalle}</div>
                </div>
                <span className="rowAmount" style={{ fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                  {s.monto}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "pending" && (
          <>
            <div className="listTitle" style={{ marginTop: 10 }}>
              Por liberar
            </div>
            {PENDIENTES.map((p) => (
              <div key={p.detalle} className="row">
                <div style={{ minWidth: 0 }}>
                  <div className="rowName">{p.nombre}</div>
                  <div className="rowMeta">{p.detalle}</div>
                </div>
                <span className="rowAmount">{cifra(p.monto)}</span>
              </div>
            ))}
            <div className="legend" style={{ marginTop: 16, padding: "0 18px" }}>
              El dinero de cada experiencia se libera cuando se completa y pasa su plazo de
              garantía.
            </div>
          </>
        )}

        {tab === "history" && (
          <>
            <div className="listTitle" style={{ marginTop: 10 }}>
              Retiros
            </div>
            {RETIROS.map((r) => (
              <div key={r.detalle} className="row">
                <div style={{ minWidth: 0 }}>
                  <div className="rowName">{r.nombre}</div>
                  <div className="rowMeta">{r.detalle}</div>
                </div>
                <span className="rowAmount">{cifra(r.monto)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
