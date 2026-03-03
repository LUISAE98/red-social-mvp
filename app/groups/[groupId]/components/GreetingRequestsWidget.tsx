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

function fmtDate(ts?: Timestamp) {
  if (!ts) return "";
  const d = ts.toDate();
  return d.toLocaleString();
}

export default function GreetingRequestsWidget() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [open, setOpen] = useState(true);
  const [incoming, setIncoming] = useState<Array<{ id: string; data: GreetingRequestDoc }>>([]);
  const [loadingIncoming, setLoadingIncoming] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasIncoming = useMemo(() => incoming.length > 0, [incoming]);
  const pendingBadge = incoming.length;

  useEffect(() => {
    if (!uid) {
      setIncoming([]);
      return;
    }

    setErr(null);
    setLoadingIncoming(true);

    // ✅ SOLO: solicitudes recibidas (creatorId == uid) y pendientes
    // ✅ SIN orderBy para NO requerir índice compuesto
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

    return () => unsubIncoming();
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

  // ✅ Si no hay sesión: nada
  if (!uid) return null;

  // ✅ Si NO hay solicitudes recibidas: NO mostrar widget
  // (también evita que salga el texto feo de “no tienes…”)
  if (!loadingIncoming && !hasIncoming) return null;

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
            {err && (
              <div style={{ fontSize: 12, color: "#b00020" }}>
                {err}
              </div>
            )}

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
          </div>
        )}
      </div>
    </div>
  );
}