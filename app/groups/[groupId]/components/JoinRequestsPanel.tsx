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
  id: string;
  userId: string;
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
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    padding: 14,
    color: "#fff",
    fontFamily: fontStack,
  };

  const innerPanel: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 10,
  };

  const row: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: "rgba(255,255,255,0.03)",
  };

  const subtle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 400,
    color: "rgba(255,255,255,0.68)",
    lineHeight: 1.35,
  };

  const avatarBox: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: 13,
    color: "rgba(255,255,255,0.92)",
    flex: "0 0 auto",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    minWidth: 88,
    fontSize: 13,
    lineHeight: 1.1,
  };

  const btnSecondary: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    minWidth: 88,
    fontSize: 13,
    lineHeight: 1.1,
  };

  return (
    <section style={card}>
      <div style={{ display: "grid", gap: 4 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: "#fff",
            letterSpacing: -0.2,
          }}
        >
          {headerText}
        </h3>

        <p style={{ margin: 0, ...subtle }}>
          Aprueba o rechaza solicitudes para permitir el acceso al grupo.
        </p>
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.35,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={innerPanel}>
          <div style={{ display: "grid", gap: 8 }}>
            {requests.map((r) => {
              const busy = busyUserId === r.userId;
              const anyBusy = !!busyUserId;

              return (
                <div key={r.id} style={row}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <div style={avatarBox} title={r.userId}>
                      {r.userId?.slice(0, 1)?.toUpperCase() ?? "U"}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.92)",
                          lineHeight: 1.3,
                          wordBreak: "break-word",
                        }}
                      >
                        Usuario: {shortUid(r.userId)}
                      </div>

                      <div style={subtle}>Solicitud pendiente</div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onApprove(r.userId)}
                      disabled={anyBusy}
                      style={{
                        ...btnPrimary,
                        background: anyBusy ? "rgba(255,255,255,0.18)" : "#fff",
                        color: anyBusy ? "rgba(255,255,255,0.92)" : "#000",
                        cursor: anyBusy ? "not-allowed" : "pointer",
                        opacity: anyBusy ? 0.85 : 1,
                      }}
                    >
                      {busy ? "Procesando..." : "Aprobar"}
                    </button>

                    <button
                      type="button"
                      onClick={() => onReject(r.userId)}
                      disabled={anyBusy}
                      style={{
                        ...btnSecondary,
                        cursor: anyBusy ? "not-allowed" : "pointer",
                        opacity: anyBusy ? 0.7 : 1,
                      }}
                    >
                      {busy ? "Procesando..." : "Rechazar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}