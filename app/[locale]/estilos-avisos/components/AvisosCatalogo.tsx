"use client";

import { useState } from "react";

import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

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
  const [confirmResultado, setConfirmResultado] = useState<string | null>(null);

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
        .cat-tag--fuera { color: rgba(255,255,255,0.35); }
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

        {/* ── PENDIENTE ─────────────────────────────────────────────────── */}
        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--pend">Pendiente</span>
            <h2 className="cat-sec-t">window.confirm nativo</h2>
            <span className="cat-count">19 llamadas · 6 archivos</span>
          </div>
          <p className="cat-src">
            PostCommentThread.parts.tsx (12) · SessionsOverlay.tsx ·
            GroupPostCard.tsx · admin/refunds · experiencias · ProfileMoreMenu.tsx
          </p>
          <div className="cat-box">
            <div className="cat-row">
              <button
                className="cat-btn"
                onClick={() =>
                  setConfirmResultado(
                    window.confirm("¿Eliminar este comentario?") ? "Aceptó" : "Canceló"
                  )
                }
              >
                Ver el diálogo del sistema
              </button>
              {confirmResultado ? (
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                  {confirmResultado}
                </span>
              ) : null}
            </div>
            <p className="cat-note">
              No son avisos, son preguntas: necesitan dos botones. Van a
              `VibraResponsivePanel`, que ya hace este trabajo en el chat.
            </p>
          </div>
        </section>

        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--pend">Pendiente</span>
            <h2 className="cat-sec-t">Condiciones permanentes</h2>
            <span className="cat-count">revisión una por una</span>
          </div>
          <div className="cat-box">
            <p className="cat-note">
              No se migraron porque no son eventos: siguen siendo verdad mientras
              estés en la pantalla. Un toast de cuatro segundos las perdería.
            </p>
            <ul className="cat-lista">
              <li>Comunidad pausada y baneo — groups/[groupId]/page.tsx</li>
              <li>Bloqueo y solicitud pendiente — ConversationThread.tsx</li>
              <li>Transmisión finalizada, con reintento — LiveViewerModal.tsx</li>
              <li>Invitación inválida — invite/[token]/page.tsx</li>
              <li>Motivo de rechazo y de devolución — sessions y overlays</li>
              <li>Pantalla de error de ruta — RouteError.tsx</li>
            </ul>
          </div>
        </section>

        {/* ── FUERA ─────────────────────────────────────────────────────── */}
        <section className="cat-sec">
          <div className="cat-sec-h">
            <span className="cat-tag cat-tag--fuera">Eliminados</span>
            <h2 className="cat-sec-t">Los siete que se fueron</h2>
          </div>
          <div className="cat-box">
            <ul className="cat-lista">
              <li>
                <b>WalletErrorBox</b> — el único componente reutilizable, encerrado
                en wallet. Borrado, con sus tres consumidores migrados.
              </li>
              <li>
                <b>Cajas rojas a mano</b> — seis rojos distintos en ~25 archivos.
              </li>
              <li>
                <b>Caja gris neutra</b> — donde el error y el acierto se veían
                idénticos y no había forma de saber qué pasó.
              </li>
              <li>
                <b>Cajas verdes de acierto</b> — dos verdes distintos.
              </li>
              <li>
                <b>noticeStyles con cuatro tonos</b> — la idea correcta, encerrada
                en un módulo.
              </li>
              <li>
                <b>Tipo deducido del emoji</b> — en el toast y también en
                admin/refunds, que lo decidía con un ✓.
              </li>
              <li>
                <b>Doble pintado</b> — el mismo error en dos cajas de distinto
                color, en saludos y en mis comunidades.
              </li>
            </ul>
          </div>
        </section>
      </div>

      <VibraToast toast={toast} />
    </div>
  );
}
