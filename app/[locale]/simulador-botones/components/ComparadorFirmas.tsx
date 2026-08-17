"use client";

/**
 * Antes y después de las 451 pintas de botón que existen hoy.
 *
 * Columna ANTES: el estilo REAL sacado del archivo donde vive ese botón. Es
 * exactamente como se ve hoy en la app, no una interpretación.
 *
 * Columna DESPUÉS: cómo se vería con el sistema propuesto. Se dibuja aquí con
 * los valores propuestos en vez de importar un primitivo nuevo, porque los
 * primitivos nuevos NO EXISTEN todavía: no se crea nada en `components/ui`
 * hasta que la propuesta esté aprobada. El único que sí es real es `Button`,
 * que ya vive en el repo.
 *
 * Nada de esta pantalla toca el estilo del producto. Es solo para mirar.
 */

import { useMemo, useState, type CSSProperties } from "react";

import { CENSO, MIGRADOS, TOTAL_BOTONES, type Destino, type EntradaCenso, type FirmaActual } from "./censoFirmas";

/* ── Contenido real del botón ─────────────────────────────────────────── */

/**
 * Dibuja lo que el botón lleva dentro de verdad: su icono o su texto.
 *
 * El SVG viene del propio repositorio, ya recortado a formas con atributos
 * literales por el barrido que generó `censoFirmas.ts`, así que se inyecta tal
 * cual. Esta pantalla no existe en producción.
 */
function Contenido({ e }: { e: EntradaCenso }) {
  if (e.svg) {
    return (
      <svg
        viewBox={e.svg.viewBox}
        fill={e.svg.relleno}
        stroke={e.svg.trazo}
        strokeWidth={e.svg.grosor}
        strokeLinecap="round"
        strokeLinejoin="round"
        width="1em"
        height="1em"
        aria-hidden="true"
        style={{ display: "block", flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: e.svg.html }}
      />
    );
  }
  if (e.etiqueta) return <span className="c-txt">{etiquetaCorta(e.etiqueta)}</span>;
  if (e.componente) return <span className="c-comp">{e.componente}</span>;
  return <>◍</>;
}

/**
 * Un botón enseña un texto a la vez. El barrido recoge todos los estados
 * ("Guardando… / Confirmar"), así que aquí se pinta el último, que es el de
 * reposo; los demás quedan en el `title` de la celda.
 */
function etiquetaCorta(etiqueta: string): string {
  const partes = etiqueta.split(" / ");
  return partes[partes.length - 1];
}

/* ── ANTES: reconstruye el estilo real de la firma ────────────────────── */

/** Un valor que sale de un ternario se pinta con su primera rama. */
function pintable(v?: string): string | null {
  if (!v) return null;
  if (v.includes(" ⇄ ")) return v.split(" ⇄ ")[0];
  if (/^«.*»$/.test(v)) return null;
  return v;
}
function esAproximado(f: FirmaActual): boolean {
  return Object.values(f).some((v) => typeof v === "string" && (v.includes(" ⇄ ") || /^«.*»$/.test(v)));
}
function estiloActual(f: FirmaActual): CSSProperties {
  const s: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    border: "none",
    background: "transparent",
    color: "#fff",
    fontSize: 13,
  };
  const asignar = (k: keyof CSSProperties, v: string | null) => {
    if (v) (s as Record<string, unknown>)[k as string] = v;
  };
  asignar("borderRadius", pintable(f.borderRadius));
  asignar("padding", pintable(f.padding));
  asignar("background", pintable(f.background));
  asignar("border", pintable(f.border));
  asignar("color", pintable(f.color));
  asignar("fontSize", pintable(f.fontSize));
  asignar("width", pintable(f.width));
  asignar("height", pintable(f.height));
  const peso = pintable(f.fontWeight);
  if (peso) s.fontWeight = Number(peso.replace("px", "")) || undefined;
  return s;
}

/* ── DESPUÉS: el sistema propuesto ────────────────────────────────────── */

const TAM_CAJA = {
  sm: { padding: "6px 12px", fontSize: 13, borderRadius: 10 },
  md: { padding: "10px 16px", fontSize: 14, borderRadius: 12 },
  lg: { padding: "13px 20px", fontSize: 16, borderRadius: 14 },
} as const;

const TAM_ICONO = { sm: 32, md: 40, lg: 48 } as const;

const FONDOS: Record<string, CSSProperties> = {
  primary: { background: "#ffffff", color: "#08111d", fontWeight: 700 },
  brand: { background: "var(--brand)", color: "rgba(255,255,255,0.98)", fontWeight: 600 },
  gradient: {
    background: "linear-gradient(135deg, var(--pink) 0%, var(--brand-strong) 52%, #3b82f6 100%)",
    color: "#fff",
    fontWeight: 600,
  },
  secondary: { background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 600 },
  ghost: { background: "transparent", color: "rgba(255,255,255,0.86)", fontWeight: 600 },
  "ghost-borde": {
    background: "transparent",
    color: "rgba(255,255,255,0.86)",
    fontWeight: 600,
    border: "1px solid rgba(255,255,255,0.16)",
  },
  danger: { background: "var(--error)", color: "#fff", fontWeight: 600 },
  success: { background: "var(--brand)", color: "#fff", fontWeight: 600 },
  pill: { background: "var(--brand)", color: "#fff", fontWeight: 600 },
};

const BASE_CAJA: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

function estiloPropuesto(e: EntradaCenso): CSSProperties | null {
  const d = e.destino;
  if (d === "fuera" || d === "dinamico" || d === "otro") return null;

  if (d === "icon" || d === "icon-solid" || d === "close") {
    const lado = TAM_ICONO[e.tamano];
    return {
      ...BASE_CAJA,
      width: lado,
      height: lado,
      borderRadius: "50%",
      padding: 0,
      fontSize: d === "close" ? Math.round(lado * 0.62) : Math.round(lado * 0.45),
      fontWeight: d === "close" ? 300 : 400,
      background: d === "icon-solid" ? "rgba(255,255,255,0.10)" : "transparent",
      color: "rgba(255,255,255,0.86)",
    };
  }
  if (d === "text-brand" || d === "text-mute") {
    return {
      ...BASE_CAJA,
      padding: 0,
      background: "transparent",
      fontWeight: 600,
      fontSize: d === "text-brand" ? 13 : 12,
      color: d === "text-brand" ? "var(--brand)" : "rgba(255,255,255,0.58)",
    };
  }
  const tam = TAM_CAJA[e.tamano];
  return {
    ...BASE_CAJA,
    ...tam,
    ...FONDOS[d],
    ...(d === "pill" ? { borderRadius: 999, padding: tam.padding.replace(/(\d+)px$/, (_, n) => `${Number(n) + 2}px`) } : null),
  };
}

/* ── Etiquetas y nombres ──────────────────────────────────────────────── */

const NOMBRE_DESTINO: Record<Destino, string> = {
  primary: "Button · primary",
  brand: "Button · brand",
  gradient: "Button · gradient",
  secondary: "Button · secondary",
  ghost: "Button · ghost",
  "ghost-borde": "Button · ghost con borde",
  danger: "Button · danger",
  success: "Button · brand (era success)",
  pill: "Button · píldora",
  icon: "IconButton",
  "icon-solid": "IconButton · sólido",
  close: "CloseButton",
  "text-brand": "TextButton · marca",
  "text-mute": "TextButton · discreto",
  fuera: "Color fuera de la paleta",
  dinamico: "Fondo calculado",
  otro: "Sin clasificar",
};

const GRUPOS: { id: string; nombre: string; destinos: Destino[] }[] = [
  { id: "caja", nombre: "Botones con caja", destinos: ["primary", "brand", "gradient", "secondary", "ghost", "ghost-borde", "danger", "success", "pill"] },
  { id: "icono", nombre: "Iconos", destinos: ["icon", "icon-solid", "close"] },
  { id: "texto", nombre: "Texto pulsable", destinos: ["text-brand", "text-mute"] },
  { id: "pendiente", nombre: "Sin destino, hay que decidir", destinos: ["fuera", "dinamico", "otro"] },
];

const PROPS: { k: keyof FirmaActual; n: string }[] = [
  { k: "borderRadius", n: "radio" },
  { k: "padding", n: "relleno" },
  { k: "background", n: "fondo" },
  { k: "border", n: "borde" },
  { k: "color", n: "texto" },
  { k: "fontSize", n: "tamaño" },
  { k: "fontWeight", n: "peso" },
  { k: "width", n: "ancho" },
  { k: "height", n: "alto" },
];

export default function ComparadorFirmas() {
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState<string>("todos");
  const [soloRepetidas, setSoloRepetidas] = useState(false);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return CENSO.filter((e) => {
      if (soloRepetidas && e.total < 2) return false;
      if (grupo !== "todos") {
        const g = GRUPOS.find((x) => x.id === grupo);
        if (g && !g.destinos.includes(e.destino)) return false;
      }
      if (!t) return true;
      const heno = (e.archivos.join(" ") + " " + Object.values(e.firma).join(" ") + " " + NOMBRE_DESTINO[e.destino]).toLowerCase();
      return heno.includes(t);
    });
  }, [q, grupo, soloRepetidas]);

  const botonesVisibles = visibles.reduce((s, e) => s + e.total, 0);

  return (
    <div style={{ minHeight: "100dvh", background: "#0b0b0d", color: "#eeecf2" }}>
      <style>{`
        .cmp-wrap { max-width: 1180px; margin: 0 auto; padding: 28px 20px 96px; }
        .cmp-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #fbbf24; }
        .cmp-h1 { margin: 4px 0 0; font-size: 26px; font-weight: 680; line-height: 1.15; }
        .cmp-lead { margin: 8px 0 0; font-size: 13.5px; color: rgba(255,255,255,0.58); max-width: 720px; line-height: 1.55; }
        .cmp-lead b { color: rgba(255,255,255,0.86); font-weight: 650; }
        .cmp-aviso { margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(74,222,128,0.28); background: rgba(74,222,128,0.07); font-size: 12.5px; line-height: 1.55; color: rgba(134,239,172,0.95); }
        .cmp-prog { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 18px; }
        .cmp-pr { border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; padding: 13px 15px; background: rgba(255,255,255,0.02); }
        .cmp-pr-h { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .cmp-pr-h b { font-size: 14px; font-weight: 680; font-family: ui-monospace, monospace; }
        .cmp-pr-h span { font-size: 15px; font-weight: 720; color: #4ade80; font-variant-numeric: tabular-nums; }
        .cmp-pr-b { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
        .cmp-pr-b i { display: block; height: 100%; background: linear-gradient(90deg, #a855f7, #4ade80); border-radius: 3px; }
        .cmp-pr-f { display: flex; justify-content: space-between; margin-top: 7px; font-size: 11.5px; color: rgba(255,255,255,0.45); font-variant-numeric: tabular-nums; }
        .cmp-pr-f .ok { color: rgba(134,239,172,0.9); font-weight: 650; }
        .cmp-ctrl { position: sticky; top: 0; z-index: 5; background: #0b0b0d; padding: 16px 0 12px; margin: 22px 0 0; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .cmp-ctrl input { flex: 1 1 220px; min-width: 170px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #fff; border-radius: 10px; padding: 9px 13px; font: inherit; font-size: 13.5px; }
        .cmp-ctrl input:focus { outline: 2px solid #a855f7; outline-offset: 1px; }
        .cmp-fb { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.68); border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 12.5px; cursor: pointer; font-weight: 600; }
        .cmp-fb[aria-pressed="true"] { background: rgba(168,85,247,0.2); border-color: #a855f7; color: #d8b4fe; }
        .cmp-fb:focus-visible { outline: 2px solid #a855f7; outline-offset: 2px; }
        .cmp-hits { margin-inline-start: auto; font-size: 12.5px; color: rgba(255,255,255,0.45); font-variant-numeric: tabular-nums; }
        .cmp-tw { margin-top: 14px; overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
        table.cmp { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; table-layout: fixed; }
        table.cmp th { text-align: start; font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: rgba(255,255,255,0.42); padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; background: rgba(255,255,255,0.02); }
        table.cmp td { padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.055); vertical-align: middle; }
        table.cmp tr:last-child td { border-bottom: none; }
        .c-n { width: 44px; color: rgba(255,255,255,0.3); font-size: 11.5px; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
        .col-dst { width: 230px; } .col-med { width: auto; } .col-tot { width: 62px; }
        .c-esp { width: 172px; }
        .c-tile { display: grid; place-items: center; width: 158px; min-height: 56px; padding: 9px; background: #000; border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; overflow: hidden; }
        .c-tile button { max-width: 100%; overflow: hidden; }
        .c-txt { display: block; max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .c-tile--ok { border-color: rgba(74,222,128,0.32); }
        .c-tile--no { border-color: rgba(251,191,36,0.35); background: repeating-linear-gradient(45deg, #000, #000 8px, rgba(251,191,36,0.06) 8px, rgba(251,191,36,0.06) 16px); }
        .c-tile button { pointer-events: none; max-width: 100%; }
        .c-nada { font-size: 11px; color: rgba(251,191,36,0.9); text-align: center; line-height: 1.4; }
        .c-props { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; }
        .c-pr { font-size: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; padding: 2px 6px; color: rgba(255,255,255,0.6); font-family: ui-monospace, monospace; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .c-pr b { color: rgba(255,255,255,0.38); font-weight: 700; margin-inline-end: 4px; font-family: system-ui, sans-serif; }
        .c-ap { font-size: 10px; color: #fbbf24; background: rgba(251,191,36,0.12); border-radius: 5px; padding: 2px 6px; }
        .c-dst { font-size: 11.5px; font-weight: 650; color: #d8b4fe; white-space: nowrap; }
        .c-dst--pend { color: #fbbf24; }
        .c-tam { font-size: 10px; color: rgba(255,255,255,0.35); }
        .c-files { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; margin-top: 5px; }
        .c-files code { font-size: 10px; color: rgba(255,255,255,0.42); background: rgba(255,255,255,0.04); border-radius: 4px; padding: 1px 5px; }
        .c-mas { font-size: 10px; color: #a855f7; font-weight: 700; }
        .c-tot { width: 1%; text-align: end; white-space: nowrap; }
        .c-tot b { font-size: 17px; font-weight: 720; font-variant-numeric: tabular-nums; display: block; line-height: 1; }
        .c-tot span { font-size: 10px; color: rgba(255,255,255,0.35); }
        .c-comp { font-size: 9.5px; font-family: ui-monospace, monospace; color: rgba(255,255,255,0.5); letter-spacing: -0.02em; }
      `}</style>

      <div className="cmp-wrap">
        <header>
          <span className="cmp-tag">Fase 2 · para aprobar</span>
          <h1 className="cmp-h1">Antes y después</h1>
          <p className="cmp-lead">
            Las <b>{CENSO.length} pintas</b> de botón que existen hoy en Vibra, con{" "}
            <b>{TOTAL_BOTONES} botones</b> repartidos entre ellas. A la izquierda, cómo se ve hoy,
            con el estilo real sacado de su archivo. A la derecha, cómo se vería con el sistema
            propuesto.
          </p>
          <p className="cmp-aviso">
            La columna de la derecha es la propuesta. Solo <code>TextButton</code> y{" "}
            <code>Button</code> existen de verdad; el resto se dibuja aquí para que lo mires. Si
            algún «después» no te gusta, se cambia antes de tocar nada más.
          </p>

          <div className="cmp-prog">
            {MIGRADOS.map((m) => {
              const total = m.usos + m.pendientes;
              const pct = total > 0 ? Math.round((m.usos / total) * 100) : 0;
              return (
                <div className="cmp-pr" key={m.primitivo}>
                  <div className="cmp-pr-h">
                    <b>{m.primitivo}</b>
                    <span>{pct}%</span>
                  </div>
                  <div className="cmp-pr-b">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="cmp-pr-f">
                    <span className="ok">{m.usos} migrados</span>
                    <span>{m.pendientes} pendientes</span>
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        <div className="cmp-ctrl">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por archivo, color o medida…"
            aria-label="Buscar firma"
          />
          {[{ id: "todos", nombre: "Todas" }, ...GRUPOS].map((g) => (
            <button
              key={g.id}
              type="button"
              className="cmp-fb"
              aria-pressed={grupo === g.id}
              onClick={() => setGrupo(g.id)}
            >
              {g.nombre}
            </button>
          ))}
          <button
            type="button"
            className="cmp-fb"
            aria-pressed={soloRepetidas}
            onClick={() => setSoloRepetidas((v) => !v)}
          >
            Solo repetidas
          </button>
          <span className="cmp-hits">
            {visibles.length} firmas · {botonesVisibles} botones
          </span>
        </div>

        <div className="cmp-tw">
          <table className="cmp">
            <thead>
              <tr>
                <th className="c-n">#</th>
                <th className="c-esp">Cómo se ve hoy</th>
                <th className="c-esp">Cómo se vería</th>
                <th className="col-dst">Destino</th>
                <th className="col-med">Medidas de hoy</th>
                <th className="col-tot">Usos</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((e) => {
                const propuesto = estiloPropuesto(e);
                const pendiente = propuesto === null;
                return (
                  <tr key={e.n} title={e.etiqueta && e.etiqueta.includes(" / ") ? `Estados: ${e.etiqueta}` : undefined}>
                    <td className="c-n">{e.n}</td>
                    <td className="c-esp">
                      <div className="c-tile">
                        <button type="button" style={estiloActual(e.firma)} tabIndex={-1}>
                          <Contenido e={e} />
                        </button>
                      </div>
                    </td>
                    <td className="c-esp">
                      <div className={`c-tile ${pendiente ? "c-tile--no" : "c-tile--ok"}`}>
                        {pendiente ? (
                          <span className="c-nada">sin destino,
                          <br />
                          hay que decidirlo</span>
                        ) : (
                          <button type="button" style={propuesto} tabIndex={-1}>
                            <Contenido e={e} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={`c-dst ${pendiente ? "c-dst--pend" : ""}`}>
                        {NOMBRE_DESTINO[e.destino]}
                      </div>
                      {!pendiente && e.destino !== "text-brand" && e.destino !== "text-mute" ? (
                        <div className="c-tam">tamaño {e.tamano}</div>
                      ) : null}
                      <div className="c-files">
                        {e.archivos.slice(0, 3).map((a) => (
                          <code key={a}>{a.split("/").pop()}</code>
                        ))}
                        {e.archivos.length > 3 ? (
                          <span className="c-mas">+{e.archivos.length - 3}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="c-props">
                        {PROPS.filter((p) => e.firma[p.k]).map((p) => (
                          <span className="c-pr" key={p.k}>
                            <b>{p.n}</b>
                            {e.firma[p.k]}
                          </span>
                        ))}
                        {esAproximado(e.firma) ? <span className="c-ap">aproximado</span> : null}
                      </div>
                    </td>
                    <td className="c-tot">
                      <b>{e.total}</b>
                      <span>{e.total === 1 ? "uso" : "usos"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
