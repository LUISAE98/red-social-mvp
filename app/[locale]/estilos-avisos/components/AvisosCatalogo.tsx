"use client";

import { useState } from "react";

import VibraToast from "@/app/components/VibraToast/VibraToast";
import ConfirmPanel, { type ConfirmTone } from "@/components/ui/ConfirmPanel";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import {
  CONDICIONES,
  TOTAL_CONDICIONES,
  type Formato,
} from "./condicionesPermanentes";

/**
 * Catálogo de los avisos de error y acierto de la plataforma.
 *
 * Empezó como inventario de las nueve formas distintas que había. Ahora sirve
 * para lo contrario: ver las que quedan y comprobar que se ven como deben.
 *
 * Lo que se monta aquí es el componente REAL, así que lo que se ve es lo que ve
 * el usuario.
 */

const TEXTO_ERROR = "No se pudo guardar. Intenta de nuevo.";
const TEXTO_EXITO = "Se guardó correctamente.";

export default function AvisosCatalogo() {
  const { toast, showToast } = useVibraToast();
  const [confirmAbierto, setConfirmAbierto] = useState<number | null>(null);

  return (
    <div style={{ minHeight: "100dvh", background: "#0b0b0d", color: "#eeecf2" }}>
      <style>{`
        .cat-wrap { max-width: 860px; margin: 0 auto; padding: 28px 20px 80px; }
        .cat-h1 { margin: 0; font-size: 26px; font-weight: 680; line-height: 1.15; }
        .cat-lead { margin: 6px 0 0; font-size: 13.5px; color: rgba(255,255,255,0.58); max-width: 640px; line-height: 1.5; }
        .cat-sec { margin-top: 34px; }
        .cat-sec-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
        .cat-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
        .cat-tag--vive { color: #4ade80; }
        .cat-tag--pend { color: #fbbf24; }
        .cat-sec-t { margin: 0; font-size: 15.5px; font-weight: 650; }
        .cat-count { font-size: 11.5px; color: rgba(255,255,255,0.45); }
        .cat-src { font-size: 11px; color: rgba(255,255,255,0.38); line-height: 1.5; margin: 2px 0 10px; word-break: break-word; }
        .cat-box { border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; background: rgba(255,255,255,0.02); display: grid; gap: 10px; }
        .cat-note { font-size: 11.5px; line-height: 1.45; color: rgba(251,191,36,0.9); margin: 0; }
        .cat-ok { font-size: 11.5px; line-height: 1.45; color: rgba(134,239,172,0.85); margin: 0; }
        .cat-btn { border: 1px solid rgba(255,255,255,0.16); background: transparent; color: inherit; border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 12.5px; cursor: pointer; }
        .cat-btn:hover { border-color: #a855f7; }
        .cat-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .cat-lista { margin: 0; padding-inline-start: 18px; font-size: 12px; line-height: 1.7; color: rgba(255,255,255,0.6); }
        .cond-chip { font-size: 10px; font-weight: 600; letter-spacing: 0.02em; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
        .cond-chip--pantalla { background: rgba(239,68,68,0.14); color: #fca5a5; }
        .cond-chip--overlay { background: rgba(251,191,36,0.14); color: #fbbf24; }
        .cond-chip--bloque { background: rgba(147,197,253,0.14); color: #93c5fd; }
        .cond-chip--linea { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
        .cond-chip--accion { background: rgba(74,222,128,0.14); color: #4ade80; }
        .cond-chip--sin { background: rgba(168,85,247,0.16); color: #d8b4fe; }
        .cond-texto { margin: 0; font-size: 13px; line-height: 1.5; color: #fff; }
        .cond-cuando { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.62); }
        .cond-cuando b, .cond-accion b { color: rgba(255,255,255,0.85); font-weight: 650; }
        .cond-accion { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(134,239,172,0.85); }
        .cond-sin-accion { margin: 0; font-size: 12px; color: rgba(255,255,255,0.35); }
      `}</style>

      <div className="cat-wrap">
        <header>
          <span className="cat-tag cat-tag--vive">Catálogo interno</span>
          <h1 className="cat-h1">Avisos de error y acierto</h1>
          <p className="cat-lead">
            Había nueve formas distintas de decir que algo falló o que algo salió
            bien. Quedan dos, y una cosa por decidir.
          </p>
        </header>

        {/* ── VIVE ──────────────────────────────────────────────────────── */}
        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--vive">Se queda</span>
            <h2 className="cat-sec-t">VibraToast</h2>
            <span className="cat-count">resultado de una acción</span>
          </div>
          <p className="cat-src">
            app/components/VibraToast/VibraToast.tsx · lib/hooks/useVibraToast.ts
          </p>
          <div className="cat-box">
            <div className="cat-row">
              <button className="cat-btn" onClick={() => showToast(TEXTO_EXITO, "success")}>
                Acierto
              </button>
              <button className="cat-btn" onClick={() => showToast(TEXTO_ERROR, "error")}>
                Error
              </button>
              <button className="cat-btn" onClick={() => showToast("Revisa los datos.", "warning")}>
                Aviso
              </button>
            </div>
            <p className="cat-ok">
              El fondo se oscurece de abajo hacia arriba y el aviso sale sobre él,
              sin caja. Icono y texto entran y salen con pop; el degradado no, se
              apaga suave. Cuatro segundos.
            </p>
            <p className="cat-ok">
              El tipo va como argumento explícito. Ya no se deduce del emoji del
              texto, que era frágil en los 47 idiomas.
            </p>
          </div>
        </section>

        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--vive">Se queda</span>
            <h2 className="cat-sec-t">Error bajo el campo</h2>
            <span className="cat-count">validación de formulario</span>
          </div>
          <p className="cat-src">
            RegisterPanel.tsx · components/profile/SocialLinksEditor.tsx
          </p>
          <div className="cat-box">
            <div style={{ display: "grid", gap: 4 }}>
              <input
                readOnly
                value="mivibra@@"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: "#fff",
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: 10, color: "rgba(255,120,120,0.95)" }}>
                El usuario de Instagram no es válido
              </span>
            </div>
            <p className="cat-ok">
              Se queda mientras el campo siga mal y dice CUÁL falla. Un toast no
              sirve aquí: desaparece y no señala el campo.
            </p>
            <p className="cat-note">
              Pendiente de unificar: hoy cada formulario define su propio tamaño y
              su propio rojo.
            </p>
          </div>
        </section>


        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--vive">Se queda</span>
            <h2 className="cat-sec-t">ConfirmPanel</h2>
            <span className="cat-count">preguntas · 10 distintas, 19 sitios</span>
          </div>
          <p className="cat-src">components/ui/ConfirmPanel.tsx</p>
          <div className="cat-box">
            <p className="cat-ok">
              Cancelar a la izquierda y en gris, confirmar a la derecha y con
              color. Rojo para lo que destruye o no se deshace; morado para el
              resto. Con el destructivo a la derecha, el pulgar que va rápido cae
              antes en cancelar.
            </p>
            <div className="cat-row">
              {CONFIRMACIONES.map((c, i) => (
                <button key={c.title} className="cat-btn" onClick={() => setConfirmAbierto(i)}>
                  {c.corto}
                </button>
              ))}
            </div>
            <p className="cat-ok">
              Los dos de dinero llevan el importe destacado aparte: dentro de una
              frase larga se pasa por alto justo el dato que hay que leer.
            </p>
          </div>
        </section>

        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--pend">Por revisar</span>
            <h2 className="cat-sec-t">Condiciones permanentes</h2>
            <span className="cat-count">
              {TOTAL_CONDICIONES} en {CONDICIONES.length} áreas
            </span>
          </div>
          <div className="cat-box">
            <p className="cat-note">
              No son eventos: siguen siendo verdad mientras estés en la pantalla,
              y casi siempre explican por qué algo no se puede hacer. Un aviso de
              cuatro segundos las perdería.
            </p>
            <p className="cat-ok">
              Las que llevan una acción dentro difícilmente pueden irse: ese botón
              suele ser el único camino que le queda a la persona. Las que son
              solo texto son las candidatas.
            </p>
            <div className="cat-row">
              <span className="cond-chip cond-chip--pantalla">pantalla completa</span>
              <span className="cond-chip cond-chip--overlay">sobre el contenido</span>
              <span className="cond-chip cond-chip--bloque">bloque</span>
              <span className="cond-chip cond-chip--linea">línea suelta</span>
              <span className="cond-chip cond-chip--accion">con acción</span>
              <span className="cond-chip cond-chip--sin">sin traducir</span>
            </div>
          </div>
        </section>

        {CONDICIONES.map((area) => (
          <section className="cat-sec" key={area.area}>
            <div className="cat-sec-h">
              <h2 className="cat-sec-t">{area.area}</h2>
              <span className="cat-count">{area.items.length}</span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {area.items.map((c) => (
                <div className="cat-box" key={c.ruta + c.nombre}>
                  <div className="cat-row">
                    <b style={{ fontSize: 13.5 }}>{c.nombre}</b>
                    <span className={`cond-chip cond-chip--${c.formato}`}>
                      {FORMATO_TEXTO[c.formato]}
                    </span>
                    {c.accion ? (
                      <span className="cond-chip cond-chip--accion">con acción</span>
                    ) : null}
                    {c.sinTraducir ? (
                      <span className="cond-chip cond-chip--sin">sin traducir</span>
                    ) : null}
                  </div>

                  <p className="cond-texto">{c.texto}</p>

                  <p className="cond-cuando">
                    <b>Cuándo aparece.</b> {c.cuando}
                  </p>

                  {c.accion ? (
                    <p className="cond-accion">
                      <b>Salida.</b> {c.accion}
                    </p>
                  ) : (
                    <p className="cond-sin-accion">Sin salida: solo texto.</p>
                  )}

                  <p className="cat-src" style={{ margin: 0 }}>
                    {c.ruta}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}

      </div>

      {confirmAbierto !== null ? (
        <ConfirmPanel
          open
          onClose={() => setConfirmAbierto(null)}
          onConfirm={() => {
            showToast(CONFIRMACIONES[confirmAbierto].corto + ": confirmado", "success");
            setConfirmAbierto(null);
          }}
          title={CONFIRMACIONES[confirmAbierto].title}
          body={CONFIRMACIONES[confirmAbierto].body}
          highlight={CONFIRMACIONES[confirmAbierto].highlight}
          confirmLabel={CONFIRMACIONES[confirmAbierto].confirmLabel}
          cancelLabel="Cancelar"
          tone={CONFIRMACIONES[confirmAbierto].tone}
        />
      ) : null}

      <VibraToast toast={toast} />
    </div>
  );
}

/**
 * Los nueve casos reales que hoy salen por `window.confirm`. Los textos son
 * los que están en los catálogos de idioma, sin retocar: la propuesta es de
 * forma, no de copy.
 */
const CONFIRMACIONES: Array<{
  corto: string;
  title: string;
  body?: string;
  highlight?: string;
  confirmLabel: string;
  tone: ConfirmTone;
}> = [
  {
    corto: "Bloquear",
    title: "Bloquear a este usuario",
    body: "¿Seguro que quieres bloquear a este usuario? Dejará de poder escribirte y de ver lo que publiques.",
    confirmLabel: "Bloquear",
    tone: "danger",
  },
  {
    corto: "Bloquear el perfil",
    title: "Bloquear de mi perfil",
    body: "¿Seguro que quieres bloquear el perfil de este usuario?",
    confirmLabel: "Bloquear",
    tone: "danger",
  },
  {
    corto: "Bloquear en la comunidad",
    title: "Bloquear en esta comunidad",
    body: "¿Seguro que quieres bloquear a este usuario en este grupo?",
    confirmLabel: "Bloquear",
    tone: "danger",
  },
  {
    corto: "Quitar silencio",
    title: "Quitar el silencio",
    body: "¿Quitar el mute a este usuario? Volverá a poder comentar.",
    confirmLabel: "Quitar",
    tone: "neutral",
  },
  {
    corto: "Banear",
    title: "Banear de la comunidad",
    body: "¿Seguro que quieres banear a este usuario de la comunidad?",
    confirmLabel: "Banear",
    tone: "danger",
  },
  {
    corto: "Quitar ban",
    title: "Quitar el ban",
    body: "¿Quitar el ban a este usuario? Podrá volver a entrar.",
    confirmLabel: "Quitar",
    tone: "neutral",
  },
  {
    corto: "Expulsar",
    title: "Expulsar de la comunidad",
    body: "¿Seguro que quieres expulsar a este usuario de la comunidad?",
    confirmLabel: "Expulsar",
    tone: "danger",
  },
  {
    corto: "Cerrar sesiones",
    title: "Cerrar todas las sesiones",
    body: "Se cerrará la sesión en todos tus dispositivos, incluido este. Tendrás que volver a entrar.",
    confirmLabel: "Cerrar todas",
    tone: "danger",
  },
  {
    corto: "Pedir reembolso",
    title: "Pedir tu saldo de vuelta",
    body: "Se devolverá a tu tarjeta original. Un administrador lo revisará, y mientras tanto ese saldo queda apartado.",
    highlight: "$1,240.00 MXN",
    confirmLabel: "Solicitar",
    tone: "neutral",
  },
  {
    corto: "Aprobar reembolso",
    title: "Aprobar el reembolso",
    body: "Se devolverá a la tarjeta original de Daniel Tapia. Esta acción dispara el reembolso en Stripe y no se puede deshacer.",
    highlight: "$450.00 MXN",
    confirmLabel: "Reembolsar",
    tone: "danger",
  },
];

/** Cómo se llama cada formato en la etiqueta. */
const FORMATO_TEXTO: Record<Formato, string> = {
  pantalla: "pantalla completa",
  overlay: "sobre el contenido",
  bloque: "bloque",
  linea: "línea suelta",
};
