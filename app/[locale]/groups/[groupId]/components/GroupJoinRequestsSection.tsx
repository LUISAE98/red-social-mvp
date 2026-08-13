"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { approveJoinRequest, rejectJoinRequest } from "@/lib/groups/joinRequests.admin";

type Requester = {
  uid: string;
  displayName: string;
  handle: string | null;
  photoURL: string | null;
  createdAtMs: number;
};

/**
 * Lista de solicitudes de unión pendientes de una comunidad, con aceptar/rechazar.
 * Solo owner/mods. Vive dentro de la pestaña Integrantes. Se abre con el texto
 * "Ver solicitudes (N)" o automáticamente vía deep-link (`?requests=1`).
 *
 * Solo tiene sentido en una comunidad PRIVADA normal: es el único modelo donde
 * alguien pide entrar y el dueño aprueba o rechaza. En pública se entra directo,
 * en oculta se entra por invitación y en suscripción se entra pagando.
 *
 * Si no hay ninguna solicitud pendiente, la sección no se dibuja.
 */
export default function GroupJoinRequestsSection({
  groupId,
  canManage,
  defaultOpen = false,
  enabled = true,
}: {
  groupId: string;
  canManage: boolean;
  defaultOpen?: boolean;
  /** false en comunidades pública / oculta / de suscripción. */
  enabled?: boolean;
}) {
  const tGroups = useTranslations("groups");
  const tNotif = useTranslations("notifications");
  const locale = useLocale();
  const timeAgo = (ms: number): string => {
    if (!ms) return "";
    const rtf = new Intl.RelativeTimeFormat(locale === "pt-BR" ? "pt" : locale, {
      numeric: "auto",
    });
    const diff = Math.round((ms - Date.now()) / 1000);
    const abs = Math.abs(diff);
    if (abs < 60) return rtf.format(Math.round(diff), "second");
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    if (abs < 604800) return rtf.format(Math.round(diff / 86400), "day");
    if (abs < 2629800) return rtf.format(Math.round(diff / 604800), "week");
    return rtf.format(Math.round(diff / 2629800), "month");
  };
  const [open, setOpen] = useState(defaultOpen);
  const [requests, setRequests] = useState<Requester[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!canManage || !enabled) return;
    const qy = query(
      collection(db, "groups", groupId, "joinRequests"),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
      void (async () => {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data() as {
              userId?: string;
              createdAt?: { toMillis?: () => number };
            };
            const uid = data.userId ?? d.id;
            let displayName = "Usuario";
            let handle: string | null = null;
            let photoURL: string | null = null;
            try {
              const us = await getDoc(doc(db, "users", uid));
              if (us.exists()) {
                const u = us.data() as Record<string, string | undefined>;
                displayName =
                  u.displayName ?? u.name ?? u.username ?? u.handle ?? "Usuario";
                handle = u.handle ?? u.username ?? null;
                photoURL = u.avatarUrl ?? u.photoURL ?? null;
              }
            } catch {
              /* perfil no legible */
            }
            return {
              uid,
              displayName,
              handle,
              photoURL,
              createdAtMs: data.createdAt?.toMillis?.() ?? 0,
            };
          })
        );
        rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setRequests(rows);
      })();
      },
      (err) => {
        console.error("[JoinRequests] snapshot error", err);
      }
    );
    return unsub;
  }, [groupId, canManage, enabled]);

  if (!canManage || !enabled) return null;

  const act = async (uid: string, kind: "approve" | "reject") => {
    if (busy[uid]) return;
    setBusy((b) => ({ ...b, [uid]: true }));
    setRequests((rs) => rs.filter((r) => r.uid !== uid)); // optimista
    try {
      if (kind === "approve") await approveJoinRequest(groupId, uid);
      else await rejectJoinRequest(groupId, uid);
    } catch {
      /* el snapshot re-sincroniza si falló */
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[uid];
        return next;
      });
    }
  };

  const count = requests.length;

  // Sin solicitudes pendientes no hay nada que administrar: no se dibuja.
  if (count === 0) return null;

  return (
    <div className="jrSection">
      <button type="button" className="jrToggle" onClick={() => setOpen((v) => !v)}>
        <span className="jrToggleText">
          {tGroups("viewJoinRequests")} ({count})
        </span>
        <span className={open ? "jrCaret jrCaretOpen" : "jrCaret"} aria-hidden />
      </button>

      {/* El contenido queda montado y se despliega con una transición: de golpe
          se sentía brusco. `grid-template-rows: 0fr → 1fr` anima la altura real
          sin tener que medirla ni inventar un max-height. */}
      <div className={open ? "jrPanel jrPanelOpen" : "jrPanel"} aria-hidden={!open}>
        <div className="jrPanelInner">
          <ul className="jrList">
            {requests.map((r) => (
              <li key={r.uid} className="jrRow">
                <span className="jrAvatar">
                  {r.photoURL ? (
                    <Image src={r.photoURL} alt="" width={40} height={40} />
                  ) : (
                    <span className="jrAvatarFallback">
                      {r.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="jrInfo">
                  {r.handle ? (
                    <Link href={`/u/${r.handle}`} className="jrName">
                      {r.displayName}
                    </Link>
                  ) : (
                    <span className="jrName">{r.displayName}</span>
                  )}
                  <span className="jrHandle">{timeAgo(r.createdAtMs)}</span>
                </span>
                <span className="jrRowActions">
                  <button
                    type="button"
                    className="jrBtn jrApprove"
                    disabled={!!busy[r.uid]}
                    onClick={() => act(r.uid, "approve")}
                  >
                    {tNotif("accept")}
                  </button>
                  <button
                    type="button"
                    className="jrBtn jrReject"
                    disabled={!!busy[r.uid]}
                    onClick={() => act(r.uid, "reject")}
                  >
                    {tNotif("reject")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style jsx>{`
        /* Limpieza de UI: sin caja alrededor de la sección ni relleno de color
           en el encabezado — la lista de solicitudes va plana como el resto del
           feed de integrantes. */
        .jrSection {
          margin-top: 12px;
        }
        .jrToggle {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 0;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: start;
        }
        /* Mismo peso que el título de la pestaña: el conteo va en el propio
           texto, así que ya no hace falta la píldora morada. */
        .jrToggleText {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #fff;
        }
        .jrCaret {
          margin-inline-start: auto;
          width: 8px;
          height: 8px;
          border-inline-end: 1.7px solid rgba(255, 255, 255, 0.6);
          border-bottom: 1.7px solid rgba(255, 255, 255, 0.6);
          transform: rotate(45deg);
          transition: transform 180ms ease;
        }
        .jrCaretOpen {
          transform: rotate(225deg);
        }
        /* Despliegue suave. La fila del grid pasa de 0fr a 1fr, así que la
           altura se interpola sola sin conocerla de antemano. */
        .jrPanel {
          display: grid;
          grid-template-rows: 0fr;
          opacity: 0;
          transition:
            grid-template-rows var(--duration-normal) var(--ease-smooth),
            opacity var(--duration-fast) var(--ease-smooth);
        }
        .jrPanelOpen {
          grid-template-rows: 1fr;
          opacity: 1;
        }
        .jrPanelInner {
          overflow: hidden;
          min-height: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .jrPanel {
            transition: none;
          }
        }
        .jrList {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .jrRow {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
        }
        .jrAvatar {
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          background: #1a1a1a;
          display: grid;
          place-items: center;
        }
        .jrAvatar :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .jrAvatarFallback {
          color: #a855f7;
          font-weight: 800;
        }
        .jrInfo {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1 1 auto;
        }
        .jrInfo :global(.jrName) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          text-decoration: none;
        }
        .jrHandle {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.45);
        }
        .jrRowActions {
          display: flex;
          gap: 8px;
          flex: 0 0 auto;
        }
        .jrBtn {
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          border: none;
        }
        .jrBtn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .jrApprove {
          background: #a855f7;
          color: #fff;
        }
        .jrReject {
          background: rgba(255, 255, 255, 0.1);
          color: #f2f2f2;
        }
      `}</style>
    </div>
  );
}
