"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { approveJoinRequest, rejectJoinRequest } from "@/lib/groups/joinRequests.admin";

type Props = {
  groupId: string;
};

type PendingReq = {
  id: string;     // doc id (uid)
  userId: string; // uid
};

function shortUid(uid: string) {
  if (!uid) return "";
  return uid.length <= 10 ? uid : `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

function friendlyErrorMessage(err: any) {
  const msg = (err?.message ?? "").toString().toLowerCase();

  // Si ya no existe, lo tratamos como "ya se procesó" (no es un error real en UI)
  if (msg.includes("solicitud no existe") || msg.includes("not-found") || msg.includes("does not exist")) {
    return null;
  }

  // Errores normales
  return err?.message ?? "Ocurrió un error.";
}

export default function JoinRequestsPanel({ groupId }: Props) {
  const [requests, setRequests] = useState<PendingReq[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = requests.length;

  useEffect(() => {
    // ✅ Quitamos orderBy para evitar índice compuesto (MVP)
    const q = query(
      collection(db, "groups", groupId, "joinRequests"),
      where("status", "==", "pending")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PendingReq[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          list.push({
            id: d.id,
            userId: data.userId ?? d.id,
          });
        });
        setRequests(list);
      },
      (e) => setError(e.message)
    );

    return () => unsub();
  }, [groupId]);

  const headerText = useMemo(() => {
    if (count === 0) return "Solicitudes";
    if (count === 1) return "Solicitudes (1 pendiente)";
    return `Solicitudes (${count} pendientes)`;
  }, [count]);

  async function onApprove(userId: string) {
    try {
      setError(null);
      setBusyUserId(userId);

      // ✅ Optimistic UI: lo quitamos localmente ya
      setRequests((prev) => prev.filter((r) => r.userId !== userId));

      await approveJoinRequest(groupId, userId);
      // El snapshot terminará de sincronizar.
    } catch (e: any) {
      const msg = friendlyErrorMessage(e);
      if (msg) setError(msg);

      // Si falló de verdad, reinsertamos (best-effort)
      setRequests((prev) => {
        if (prev.some((r) => r.userId === userId)) return prev;
        return [{ id: userId, userId }, ...prev];
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function onReject(userId: string) {
    try {
      setError(null);
      setBusyUserId(userId);

      // ✅ Optimistic UI
      setRequests((prev) => prev.filter((r) => r.userId !== userId));

      await rejectJoinRequest(groupId, userId);
    } catch (e: any) {
      const msg = friendlyErrorMessage(e);
      if (msg) setError(msg);

      setRequests((prev) => {
        if (prev.some((r) => r.userId === userId)) return prev;
        return [{ id: userId, userId }, ...prev];
      });
    } finally {
      setBusyUserId(null);
    }
  }

  if (count === 0) return null;

  return (
    <section
      style={{
        marginTop: 18,
        maxWidth: 560,
        border: "1px solid #e5e5e5",
        borderRadius: 14,
        background: "#fff",
        boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#111" }}>{headerText}</h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#666" }}>
            Aprueba o rechaza solicitudes para permitir el acceso al grupo.
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            background: "#fff3f3",
            border: "1px solid #ffd0d0",
            color: "#b00020",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {requests.map((r) => {
          const busy = busyUserId === r.userId;

          return (
            <div
              key={r.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: "#f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    color: "#111",
                  }}
                  title={r.userId}
                >
                  {r.userId?.slice(0, 1)?.toUpperCase() ?? "U"}
                </div>

                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>
                    Usuario: {shortUid(r.userId)}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>Solicitud pendiente</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => onApprove(r.userId)}
                  disabled={!!busyUserId}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: busyUserId ? "not-allowed" : "pointer",
                    opacity: busyUserId ? 0.7 : 1,
                    minWidth: 92,
                  }}
                >
                  {busy ? "..." : "Aprobar"}
                </button>

                <button
                  onClick={() => onReject(r.userId)}
                  disabled={!!busyUserId}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #d0d0d0",
                    background: "#fff",
                    color: "#111",
                    fontWeight: 700,
                    cursor: busyUserId ? "not-allowed" : "pointer",
                    opacity: busyUserId ? 0.7 : 1,
                    minWidth: 92,
                  }}
                >
                  {busy ? "..." : "Rechazar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}