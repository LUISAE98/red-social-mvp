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

  // ==========================
  // Persistencia open/cerrado
  // ==========================
  const storageKey = uid ? `gr_widget_open_${uid}` : "gr_widget_open";

  const [open, setOpen] = useState<boolean>(true);
  const [openReady, setOpenReady] = useState<boolean>(false);

  // Carga preferencia al montar / cuando cambia uid
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "0") setOpen(false);
      else if (raw === "1") setOpen(true);
      // si no existe, queda por default true
    } catch {
      // ignore
    } finally {
      setOpenReady(true);
    }
  }, [storageKey]);

  // Guarda preferencia al cambiar open
  useEffect(() => {
    if (!openReady) return;
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open, openReady, storageKey]);

  // ==========================
  // Data (incoming + buyerPending)
  // ==========================
  const [incoming, setIncoming] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);
  const [buyerPending, setBuyerPending] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);

  const [loadingIncoming, setLoadingIncoming] = useState(false);
  const [loadingBuyer, setLoadingBuyer] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasIncoming = incoming.length > 0;
  const hasBuyer = buyerPending.length > 0;

  const showWidget = useMemo(() => hasIncoming || hasBuyer, [hasIncoming, hasBuyer]);

  const pendingBadge = incoming.length; // badge solo para recibidas

  useEffect(() => {
    if (!uid) {
      setIncoming([]);
      setBuyerPending([]);
      return;
    }

    setErr(null);

    // OWNER: solicitudes pendientes recibidas
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

    // BUYER: mis solicitudes pendientes
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

  // Evita “brinco” antes de leer localStorage
  if (!openReady) return null;

  // Si no hay nada real (y no estamos cargando), no se muestra
  if (!showWidget && !loadingIncoming && !loadingBuyer) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 360,
        zIndex: 9999,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <div
        style={{
          borderRadius: 14,
          border: "1px solid #ddd",
          background: "#fff",
          boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
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
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          <span>Notificaciones — Saludos</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {pendingBadge > 0 && (
              <span
                style={{
                  fontSize: 12,
                  background: "#ff3b30",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "2px 8px",
                  fontWeight: 900,
                }}
                title="Solicitudes pendientes (recibidas)"
              >
                {pendingBadge}
              </span>
            )}
            <span style={{ fontSize: 12, opacity: 0.9 }}>{open ? "▲" : "▼"}</span>
          </span>
        </button>

        {!open ? null : (
          <div style={{ padding: 12, display: "grid", gap: 12 }}>
            {err && <div style={{ fontSize: 12, color: "#b00020" }}>{err}</div>}

            {/* OWNER: recibidas */}
            {hasIncoming && (
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900 }}>Solicitudes recibidas</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {loadingIncoming ? "Cargando..." : `${incoming.length}`}
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {incoming.map((r) => {
                    const d = r.data;
                    const disabled = actionLoadingId === r.id;
                    return (
                      <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13 }}>
                          {typeLabel(d.type)} — Para: <span style={{ fontWeight: 900 }}>{d.toName}</span>
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                          {fmtDate(d.createdAt)}
                        </div>
                        <div style={{ fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>
                          {d.instructions}
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => act(r.id, "accept")}
                            disabled={disabled}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #111",
                              background: "#111",
                              color: "#fff",
                              fontWeight: 900,
                              cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.7 : 1,
                            }}
                          >
                            {disabled ? "Procesando..." : "Aceptar"}
                          </button>

                          <button
                            type="button"
                            onClick={() => act(r.id, "reject")}
                            disabled={disabled}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #d0d0d0",
                              background: "#fff",
                              fontWeight: 900,
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

            {/* BUYER: mis pendientes */}
            {hasBuyer && (
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900 }}>Mis solicitudes</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {loadingBuyer ? "Cargando..." : `${buyerPending.length}`}
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {buyerPending.map((r) => {
                    const d = r.data;
                    return (
                      <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 900, fontSize: 13 }}>
                            {typeLabel(d.type)} — Para: <span style={{ fontWeight: 900 }}>{d.toName}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 900 }}>
                            {statusLabel(d.status)}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                          {fmtDate(d.createdAt)}
                        </div>
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