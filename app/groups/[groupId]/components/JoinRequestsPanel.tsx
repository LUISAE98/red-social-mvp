"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  approveJoinRequest,
  rejectJoinRequest,
} from "@/lib/groups/joinRequests.admin";

type Props = {
  groupId: string;
};

type PendingReq = {
  id: string; // doc id (uid)
  userId: string; // uid
};

function shortUid(uid: string) {
  if (!uid) return "";
  return uid.length <= 10 ? uid : `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

function friendlyErrorMessage(err: any) {
  const msg = (err?.message ?? "").toString().toLowerCase();

  if (
    msg.includes("solicitud no existe") ||
    msg.includes("not-found") ||
    msg.includes("does not exist")
  ) {
    return null;
  }

  return err?.message ?? "Ocurrió un error.";
}

export default function JoinRequestsPanel({ groupId }: Props) {
  const [requests, setRequests] = useState<PendingReq[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = requests.length;

  useEffect(() => {
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

      setRequests((prev) => prev.filter((r) => r.userId !== userId));

      await approveJoinRequest(groupId, userId);
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

  async function onReject(userId: string) {
    try {
      setError(null);
      setBusyUserId(userId);

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

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const card: React.CSSProperties = {
    marginTop: 18,
    maxWidth: 560,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    padding: 16,
    color: "#fff",
    fontFamily: fontStack,
  };

  const subtle: React.CSSProperties = {
    fontSize: 13,
    color: "rgba(255,255,255,0.72)",
  };

  const row: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    padding: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: "rgba(0,0,0,0.22)",
  };

  const avatarBox: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.14)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    color: "rgba(255,255,255,0.92)",
    flex: "0 0 auto",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    opacity: 1,
    minWidth: 92,
    fontSize: 13,
  };

  const btnSecondary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 500,
    cursor: "pointer",
    opacity: 1,
    minWidth: 92,
    fontSize: 13,
  };

  return (
    <section style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#fff",
            }}
          >
            {headerText}
          </h3>
          <p style={{ margin: "6px 0 0", ...subtle }}>
            Aprueba o rechaza solicitudes para permitir el acceso al grupo.
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.05)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 13,
          }}
        >
          ❌ {error}
        </div>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {requests.map((r) => {
          const busy = busyUserId === r.userId;
          const anyBusy = !!busyUserId;

          return (
            <div key={r.id} style={row}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={avatarBox} title={r.userId}>
                  {r.userId?.slice(0, 1)?.toUpperCase() ?? "U"}
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    Usuario: {shortUid(r.userId)}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                    Solicitud pendiente
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => onApprove(r.userId)}
                  disabled={anyBusy}
                  style={{
                    ...btnPrimary,
                    background: anyBusy ? "rgba(255,255,255,0.15)" : "#fff",
                    color: anyBusy ? "#fff" : "#000",
                    cursor: anyBusy ? "not-allowed" : "pointer",
                    opacity: anyBusy ? 0.85 : 1,
                  }}
                >
                  {busy ? "..." : "Aprobar"}
                </button>

                <button
                  onClick={() => onReject(r.userId)}
                  disabled={anyBusy}
                  style={{
                    ...btnSecondary,
                    cursor: anyBusy ? "not-allowed" : "pointer",
                    opacity: anyBusy ? 0.7 : 1,
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