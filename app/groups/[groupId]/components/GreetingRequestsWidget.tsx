"use client";

import { useAuth } from "@/app/providers";
import { db } from "@/lib/firebase";
import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

type GreetingStatus = "pending" | "accepted" | "rejected" | "delivered" | string;
type GreetingType = "saludo" | "consejo" | "mensaje" | string;

type GreetingRequestDoc = {
  buyerId: string;
  creatorId: string;
  groupId: string;
  type: GreetingType;
  toName: string;
  instructions: string;
  source: "group" | "profile" | string;
  status: GreetingStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function typeLabel(t: string) {
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  if (t === "mensaje") return "Mensaje";
  return t;
}

function statusLabel(s: string) {
  if (s === "pending") return "Pendiente";
  if (s === "accepted") return "Aceptada";
  if (s === "rejected") return "Rechazada";
  if (s === "delivered") return "Entregada";
  return s;
}

function fmtDate(ts?: Timestamp) {
  if (!ts) return "";
  const d = ts.toDate();
  return d.toLocaleString();
}

export default function GreetingRequestsWidget() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const storageKey = uid ? `gr_widget_open_${uid}` : "gr_widget_open";

  const [open, setOpen] = useState<boolean>(true);
  const [openReady, setOpenReady] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "0") setOpen(false);
      else if (raw === "1") setOpen(true);
    } catch {
      // ignore
    } finally {
      setOpenReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!openReady) return;
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open, openReady, storageKey]);

  const [incoming, setIncoming] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);
  const [buyerPending, setBuyerPending] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);

  const [loadingIncoming, setLoadingIncoming] = useState(false);
  const [loadingBuyer, setLoadingBuyer] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasIncoming = incoming.length > 0;
  const hasBuyer = buyerPending.length > 0;

  const showWidget = useMemo(() => hasIncoming || hasBuyer, [hasIncoming, hasBuyer]);

  const pendingBadge = incoming.length;

  useEffect(() => {
    if (!uid) {
      setIncoming([]);
      setBuyerPending([]);
      return;
    }

    setErr(null);

    setLoadingIncoming(true);
    const incomingQ = query(
      collection(db, "greetingRequests"),
      where("creatorId", "==", uid),
      where("status", "==", "pending"),
      limit(10)
    );

    const unsubIncoming = onSnapshot(
      incomingQ,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() as GreetingRequestDoc }));
        setIncoming(rows);
        setLoadingIncoming(false);
      },
      (e) => {
        setErr(e.message);
        setIncoming([]);
        setLoadingIncoming(false);
      }
    );

    setLoadingBuyer(true);
    const buyerQ = query(
      collection(db, "greetingRequests"),
      where("buyerId", "==", uid),
      where("status", "==", "pending"),
      limit(10)
    );

    const unsubBuyer = onSnapshot(
      buyerQ,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() as GreetingRequestDoc }));
        setBuyerPending(rows);
        setLoadingBuyer(false);
      },
      (e) => {
        setErr(e.message);
        setBuyerPending([]);
        setLoadingBuyer(false);
      }
    );

    return () => {
      unsubIncoming();
      unsubBuyer();
    };
  }, [uid]);

  async function act(requestId: string, action: "accept" | "reject") {
    if (!uid) return;
    setErr(null);
    setActionLoadingId(requestId);

    try {
      await respondGreetingRequest({ requestId, action });
    } catch (e: any) {
      setErr(e?.message ?? "No se pudo actualizar la solicitud.");
    } finally {
      setActionLoadingId(null);
    }
  }

  if (!uid) return null;
  if (!openReady) return null;
  if (!showWidget && !loadingIncoming && !loadingBuyer) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const card: React.CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    overflow: "hidden",
    color: "#fff",
    backdropFilter: "blur(10px)",
  };

  const panel: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(255,255,255,0.03)",
  };

  const subtle: React.CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.72)",
  };

  const buttonPrimary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
  };

  const buttonSecondary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 500,
    cursor: "pointer",
    fontSize: 13,
  };

  const badge: React.CSSProperties = {
    fontSize: 12,
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 999,
    padding: "2px 8px",
    fontWeight: 600,
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 360,
        zIndex: 9999,
        fontFamily: fontStack,
      }}
    >
      <div style={card}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: "100%",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            border: "none",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          <span>Notificaciones — Saludos</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {pendingBadge > 0 && (
              <span style={badge} title="Solicitudes pendientes (recibidas)">
                {pendingBadge}
              </span>
            )}
            <span style={{ fontSize: 12, opacity: 0.9 }}>{open ? "▲" : "▼"}</span>
          </span>
        </button>

        {!open ? null : (
          <div style={{ padding: 12, display: "grid", gap: 12 }}>
            {err && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 12,
                }}
              >
                ❌ {err}
              </div>
            )}

            {hasIncoming && (
              <div style={panel}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Solicitudes recibidas</div>
                  <div style={subtle}>{loadingIncoming ? "Cargando..." : `${incoming.length}`}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {incoming.map((r) => {
                    const d = r.data;
                    const disabled = actionLoadingId === r.id;

                    return (
                      <div
                        key={r.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.14)",
                          borderRadius: 12,
                          padding: 10,
                          background: "rgba(0,0,0,0.22)",
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#fff" }}>
                          {typeLabel(d.type)} — Para:{" "}
                          <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>
                            {d.toName}
                          </span>
                        </div>

                        <div style={{ ...subtle, marginTop: 4 }}>{fmtDate(d.createdAt)}</div>

                        <div
                          style={{
                            fontSize: 12,
                            marginTop: 8,
                            whiteSpace: "pre-wrap",
                            color: "rgba(255,255,255,0.88)",
                            lineHeight: 1.35,
                          }}
                        >
                          {d.instructions}
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => act(r.id, "accept")}
                            disabled={disabled}
                            style={{
                              ...buttonPrimary,
                              background: disabled ? "rgba(255,255,255,0.15)" : "#fff",
                              color: disabled ? "#fff" : "#000",
                              cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.8 : 1,
                            }}
                          >
                            {disabled ? "Procesando..." : "Aceptar"}
                          </button>

                          <button
                            type="button"
                            onClick={() => act(r.id, "reject")}
                            disabled={disabled}
                            style={{
                              ...buttonSecondary,
                              cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.7 : 1,
                            }}
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {hasBuyer && (
              <div style={panel}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Mis solicitudes</div>
                  <div style={subtle}>{loadingBuyer ? "Cargando..." : `${buyerPending.length}`}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {buyerPending.map((r) => {
                    const d = r.data;
                    return (
                      <div
                        key={r.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.14)",
                          borderRadius: 12,
                          padding: 10,
                          background: "rgba(0,0,0,0.22)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {typeLabel(d.type)} — Para:{" "}
                            <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>
                              {d.toName}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: "rgba(255,255,255,0.85)",
                              border: "1px solid rgba(255,255,255,0.16)",
                              background: "rgba(255,255,255,0.06)",
                              padding: "2px 8px",
                              borderRadius: 999,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {statusLabel(d.status)}
                          </div>
                        </div>

                        <div style={{ ...subtle, marginTop: 6 }}>{fmtDate(d.createdAt)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}