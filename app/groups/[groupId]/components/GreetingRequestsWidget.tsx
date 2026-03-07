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
  return ts.toDate().toLocaleString();
}

export default function GreetingRequestsWidget() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const storageKey = uid ? `gr_widget_open_${uid}` : "gr_widget_open";

  const [open, setOpen] = useState<boolean>(true);
  const [openReady, setOpenReady] = useState<boolean>(false);

  const [incoming, setIncoming] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);
  const [buyerPending, setBuyerPending] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);

  const [loadingIncoming, setLoadingIncoming] = useState(false);
  const [loadingBuyer, setLoadingBuyer] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as GreetingRequestDoc,
        }));
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
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as GreetingRequestDoc,
        }));
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
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    overflow: "hidden",
    color: "#fff",
    backdropFilter: "blur(10px)",
  };

  const innerPanel: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 10,
  };

  const itemPanel: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 10,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: -0.2,
    color: "#fff",
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    letterSpacing: -0.1,
  };

  const textStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 400,
    color: "rgba(255,255,255,0.9)",
    lineHeight: 1.4,
  };

  const subtle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 400,
    color: "rgba(255,255,255,0.68)",
    lineHeight: 1.35,
  };

  const badge: React.CSSProperties = {
    height: 22,
    minWidth: 22,
    padding: "0 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const statusBadge: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    padding: "2px 8px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  };

  const buttonPrimary: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "#fff",
    color: "#000",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.1,
    cursor: "pointer",
  };

  const buttonSecondary: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.1,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        width: "min(340px, calc(100vw - 28px))",
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
            padding: "11px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            border: "none",
            background: "rgba(255,255,255,0.04)",
            color: "#fff",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "grid", gap: 3 }}>
            <div style={titleStyle}>Saludos</div>
            <div style={subtle}>Solicitudes y estado reciente</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {pendingBadge > 0 && (
              <span style={badge} title="Solicitudes pendientes recibidas">
                {pendingBadge}
              </span>
            )}
            <span
              style={{
                ...subtle,
                fontSize: 11,
                color: "rgba(255,255,255,0.82)",
              }}
            >
              {open ? "Ocultar" : "Ver"}
            </span>
          </div>
        </button>

        {!open ? null : (
          <div
            style={{
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            {err && (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  padding: "10px 12px",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.35,
                }}
              >
                {err}
              </div>
            )}

            {hasIncoming && (
              <div style={innerPanel}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={sectionTitle}>Solicitudes recibidas</div>
                  <div style={subtle}>{loadingIncoming ? "Cargando..." : `${incoming.length}`}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {incoming.map((r) => {
                    const d = r.data;
                    const disabled = actionLoadingId === r.id;

                    return (
                      <div key={r.id} style={itemPanel}>
                        <div
                          style={{
                            display: "grid",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "#fff",
                              lineHeight: 1.3,
                            }}
                          >
                            {typeLabel(d.type)} para{" "}
                            <span style={{ color: "rgba(255,255,255,0.88)" }}>{d.toName}</span>
                          </div>

                          {d.createdAt ? (
                            <div style={subtle}>{fmtDate(d.createdAt)}</div>
                          ) : null}
                        </div>

                        {d.instructions ? (
                          <div
                            style={{
                              marginTop: 8,
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(0,0,0,0.18)",
                              padding: "8px 9px",
                              whiteSpace: "pre-wrap",
                              ...textStyle,
                            }}
                          >
                            {d.instructions}
                          </div>
                        ) : null}

                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            marginTop: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => act(r.id, "accept")}
                            disabled={disabled}
                            style={{
                              ...buttonPrimary,
                              background: disabled ? "rgba(255,255,255,0.18)" : "#fff",
                              color: disabled ? "rgba(255,255,255,0.92)" : "#000",
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
              <div style={innerPanel}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={sectionTitle}>Mis solicitudes</div>
                  <div style={subtle}>{loadingBuyer ? "Cargando..." : `${buyerPending.length}`}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {buyerPending.map((r) => {
                    const d = r.data;

                    return (
                      <div key={r.id} style={itemPanel}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "#fff",
                              lineHeight: 1.3,
                            }}
                          >
                            {typeLabel(d.type)} para{" "}
                            <span style={{ color: "rgba(255,255,255,0.88)" }}>{d.toName}</span>
                          </div>

                          <div style={statusBadge}>{statusLabel(d.status)}</div>
                        </div>

                        {d.createdAt ? <div style={{ ...subtle, marginTop: 6 }}>{fmtDate(d.createdAt)}</div> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!hasIncoming && loadingIncoming && (
              <div style={innerPanel}>
                <div style={subtle}>Cargando solicitudes recibidas...</div>
              </div>
            )}

            {!hasBuyer && loadingBuyer && (
              <div style={innerPanel}>
                <div style={subtle}>Cargando tus solicitudes...</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}