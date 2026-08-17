"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/i18n/locales";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  limit,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { resolveCashout, devCaptureAndCredit, type CashoutRequestDoc } from "@/lib/wallet/cashout";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast, type ToastType } from "@/lib/hooks/useVibraToast";
import { useAdminPreview } from "../context";
import { useConfirm } from "@/lib/hooks/useConfirm";

const TYPE_LABELS: Record<string, string> = {
  greetingRequest: "Saludo / consejo",
  greeting: "Saludo / consejo",
  advice: "Consejo",
  exclusiveSessionRequest: "Sesión exclusiva",
  exclusive_session: "Sesión exclusiva",
  meetGreetRequest: "Tiempo contigo",
  meet_greet: "Tiempo contigo",
  live_session: "Tiempo contigo",
};

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  pending: { label: "Pendiente", color: "#f59e0b", dot: "#f59e0b" },
  approved: { label: "Aprobada", color: "#34d399", dot: "#34d399" },
  rejected: { label: "Rechazada", color: "#f87171", dot: "#f87171" },
};

function money(n: number, locale: string): string {
  return `$${(n ?? 0).toLocaleString(intlLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rel(date: Date | null): string {
  if (!date) return "";
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

export default function AdminRefundsPage() {
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { setPreviewUrl } = useAdminPreview();
  const [requests, setRequests] = useState<CashoutRequestDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { confirm, confirmPanel } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [devPi, setDevPi] = useState("");
  const [devBusy, setDevBusy] = useState(false);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const [devMsgType, setDevMsgType] = useState<ToastType>("success");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (devMsg) showToast(devMsg, devMsgType); }, [devMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDevCapture() {
    const pi = devPi.trim();
    if (!pi || devBusy) return;
    setDevBusy(true);
    setDevMsg(null);
    try {
      const res = await devCaptureAndCredit(pi);
      setDevMsgType("success");
      setDevMsg(`Capturado y acreditado $${(res.credited ?? 0).toFixed(2)} (${res.externalReference}), ahora el comprador puede pedir efectivo.`);
      setDevPi("");
    } catch (e: unknown) {
      setDevMsgType("error");
      setDevMsg(e instanceof Error ? e.message : "No se pudo capturar/acreditar.");
    } finally {
      setDevBusy(false);
    }
  }

  useEffect(() => {
    const q = query(
      collection(db, "cashoutRequests"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<CashoutRequestDoc, "id">) })
        );
        // Pendientes primero, luego el resto por fecha (ya viene desc).
        rows.sort((a, b) => {
          const pa = a.status === "pending" ? 0 : 1;
          const pb = b.status === "pending" ? 0 : 1;
          return pa - pb;
        });
        setRequests(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId]
  );

  // Resolver los nombres de los creadores del detalle seleccionado.
  useEffect(() => {
    if (!selected) return;
    const ids = Array.from(
      new Set((selected.origins ?? []).map((o) => o.creatorId).filter(Boolean))
    ).filter((id) => !(id in creatorNames));
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const s = await getDoc(doc(db, "users", id));
            const d = s.data() ?? {};
            const name =
              (d.displayName as string) ||
              (d.name as string) ||
              (d.username as string) ||
              id;
            return [id, name] as const;
          } catch {
            return [id, id] as const;
          }
        })
      );
      if (!cancelled) {
        setCreatorNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, creatorNames]);

  async function handleResolve(action: "approve" | "reject", note?: string) {
    if (!selected) return;
    if (action === "approve") {
      // Rojo: aqui SI sale el dinero. Dispara el reembolso en Stripe y no se
      // puede deshacer.
      const ok = await confirm({
        title: "Aprobar el reembolso",
        body: `Se devolvera a la tarjeta original de ${selected.buyerName || "el comprador"}. Esta accion dispara el reembolso en Stripe y no se puede deshacer.`,
        highlight: money(selected.amount, locale),
        confirmLabel: "Reembolsar",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      await resolveCashout(selected.id, action, note);
      setRejectingId(null);
      setRejectNote("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon("errorUpdateRequest"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>
          Devoluciones en efectivo
        </h1>
        <p style={{ fontSize: 13, color: "#555", margin: "6px 0 0" }}>
          Solicitudes de reembolso a tarjeta del saldo a favor. Reembolso solo a la tarjeta
          original.
        </p>
      </div>

      {/* 🧪 Herramienta de PRUEBA (QA): captura un hold por su pi_... y emite crédito
          reembolsable, para poder probar el cash-out sin esperar el día-6 ni el rechazo. */}
      <div style={{ padding: "12px 14px", background: "#0d0d0d", border: "1px dashed #2a2a2a", borderRadius: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 8, letterSpacing: "0.04em" }}>
          🧪 PRUEBA — capturar hold + acreditar (pega el <code>pi_…</code> del dashboard de Stripe)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={devPi}
            onChange={(e) => setDevPi(e.target.value)}
            placeholder="pi_3U3h..."
            spellCheck={false}
            style={{ flex: 1, background: "#111", border: "1px solid #222", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#ddd", outline: "none", fontFamily: "monospace" }}
          />
          <button
            onClick={handleDevCapture}
            disabled={devBusy || !devPi.trim()}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #2a2a2a", background: "#1a1a1a", color: "#aaa", fontSize: 12, fontWeight: 600, cursor: devBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}
          >
            {devBusy ? "…" : "Capturar + acreditar"}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "#555", fontSize: 14 }}>Cargando…</div>
      ) : requests.length === 0 ? (
        <div style={{ color: "#555", fontSize: 14 }}>No hay solicitudes de efectivo.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {requests.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.pending;
            const isOpen = r.id === selectedId;
            return (
              <div
                key={r.id}
                style={{
                  background: isOpen ? "#141018" : "#111",
                  border: `1px solid ${isOpen ? "#3a2a4f" : "#1e1e1e"}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  transition: "background 150ms, border-color 150ms",
                }}
              >
                {/* Fila resumen */}
                <button
                  onClick={() => setSelectedId(isOpen ? null : r.id)}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    textAlign: "start",
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                      {r.buyerName || r.buyerUsername || r.buyerId}
                    </div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>
                      {rel(r.createdAt?.toDate?.() ?? null)}
                    </div>
                  </div>
                  <div style={{ textAlign: "end", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#34d399" }}>
                      {money(r.amount, locale)}
                    </div>
                    <div style={{ fontSize: 11, color: meta.color, fontWeight: 600, marginTop: 2 }}>
                      {meta.label}
                    </div>
                  </div>
                </button>

                {/* Detalle */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid #1e1e1e", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Comprador */}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                        Quién compra
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>
                          {r.buyerName || r.buyerUsername || r.buyerId}
                        </span>
                        {r.buyerUsername && (
                          <button
                            onClick={() => setPreviewUrl(`/u/${r.buyerUsername}`)}
                            style={linkBtn}
                          >
                            ver perfil →
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Orígenes: a quién compró + por qué se rechazó */}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
                        A quién compró · por qué se rechazó
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {(r.origins ?? []).map((o, i) => (
                          <div key={`${o.sourceType}__${o.sourceId}__${i}`} style={{ background: "#0d0d0d", border: "1px solid #191919", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontSize: 12, color: "#ddd", fontWeight: 600 }}>
                                {TYPE_LABELS[o.type] ?? TYPE_LABELS[o.sourceType] ?? o.type}
                              </span>
                              <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>
                                {money(o.chargedAmount, locale)}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                              a <span style={{ color: "#cbb6e6" }}>{creatorNames[o.creatorId] ?? "…"}</span>
                            </div>
                            <div style={{ fontSize: 12, color: "#7a7a7a", marginTop: 3, fontStyle: "italic" }}>
                              «{o.reason}»
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Estado resuelto / error */}
                    {r.status === "approved" && (
                      <div style={{ fontSize: 12, color: "#34d399" }}>
                        Reembolsado {money(r.refundedAmount ?? r.amount, locale)} a la tarjeta original.
                      </div>
                    )}
                    {r.status === "rejected" && (
                      <div style={{ fontSize: 12, color: "#f87171" }}>
                        Rechazada — el saldo se devolvió al comprador.
                      </div>
                    )}
                    {r.lastError && r.status === "pending" && (
                      <div style={{ fontSize: 12, color: "#f59e0b" }}>
                        Último error: {r.lastError}. Vuelve a aprobar para reintentar (los reembolsos ya hechos no se duplican).
                      </div>
                    )}

                    {/* Acciones */}
                    {r.status === "pending" && (
                      rejectingId === r.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <textarea
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder="Explica al comprador por qué se rechaza. Lo verá junto a su crédito, así que sé claro…"
                            rows={3}
                            autoFocus
                            style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: "#ddd", outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={() => handleResolve("reject", rejectNote.trim())}
                              disabled={busy || !rejectNote.trim()}
                              style={{ ...actionBtn, background: "#7f1d1d", color: "#fff", opacity: busy || !rejectNote.trim() ? 0.5 : 1 }}
                            >
                              {busy ? "…" : "Confirmar rechazo"}
                            </button>
                            <button
                              onClick={() => { setRejectingId(null); setRejectNote(""); }}
                              disabled={busy}
                              style={{ ...actionBtn, background: "transparent", color: "#888", border: "1px solid #2a2a2a" }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => handleResolve("approve")}
                            disabled={busy}
                            style={{ ...actionBtn, background: "#7c3aed", color: "#fff", opacity: busy ? 0.6 : 1 }}
                          >
                            {busy ? "…" : "Aprobar y reembolsar"}
                          </button>
                          <button
                            onClick={() => { setRejectingId(r.id); setRejectNote(""); }}
                            disabled={busy}
                            style={{ ...actionBtn, background: "transparent", color: "#f87171", border: "1px solid #3d1515", opacity: busy ? 0.6 : 1 }}
                          >
                            Rechazar
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmPanel}
      <VibraToast toast={toast} />
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#a855f7",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};

const actionBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
