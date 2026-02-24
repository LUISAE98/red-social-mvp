"use client";

import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { joinGroup, leaveGroup } from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";

type JoinRequestStatus = "pending" | "approved" | "rejected" | string;

type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: "public" | "private" | "hidden" | string;
};

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const { user } = useAuth();

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [joinReqStatus, setJoinReqStatus] = useState<JoinRequestStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = !!user && !!group?.ownerId && group.ownerId === user.uid;
  const effectiveIsMember = isOwner || isMember;

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        // 1) leer grupo
        const gref = doc(db, "groups", groupId);
        const gsnap = await getDoc(gref);

        if (!gsnap.exists()) {
          setError("Grupo no encontrado.");
          return;
        }

        const gdata: GroupDoc = {
          id: gsnap.id,
          ...(gsnap.data() as Omit<GroupDoc, "id">),
        };

        setGroup(gdata);

        // 2) membership
        if (user) {
          const mref = doc(db, "groups", groupId, "members", user.uid);
          const msnap = await getDoc(mref);
          setIsMember(msnap.exists());
        } else {
          setIsMember(false);
        }

        // 3) joinRequest si es private
        const visibility = gdata.visibility ?? "";
        if (user && visibility === "private") {
          const jref = doc(db, "groups", groupId, "joinRequests", user.uid);
          const jsnap = await getDoc(jref);

          if (!jsnap.exists()) {
            setJoinReqStatus(null);
          } else {
            const jd = jsnap.data() as any;
            setJoinReqStatus(jd.status ?? "pending");
          }
        } else {
          setJoinReqStatus(null);
        }
      } catch (e: any) {
        setError(e?.message ?? "Error cargando grupo");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [groupId, user]);

  async function handleJoinPublic() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await joinGroup(groupId, user.uid);
      setIsMember(true);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo unir");
    } finally {
      setJoining(false);
    }
  }

  async function handleRequestPrivate() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await requestToJoin(groupId, user.uid);
      setJoinReqStatus("pending");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo enviar la solicitud");
    } finally {
      setJoining(false);
    }
  }

  async function handleCancelPrivate() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await cancelJoinRequest(groupId, user.uid);
      setJoinReqStatus(null);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cancelar la solicitud");
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    if (!user) return;

    if (isOwner) {
      setError("El owner no puede salir de su propio grupo.");
      return;
    }

    setLeaving(true);
    setError(null);

    try {
      await leaveGroup(groupId, user.uid);
      setIsMember(false);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo salir");
    } finally {
      setLeaving(false);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Cargando...</div>;
  if (error) return <div style={{ padding: 24, color: "red" }}>{error}</div>;
  if (!group) return null;

  const visibility = group.visibility ?? "";

  // private y no miembro/owner => landing bloqueada con solicitar/cancelar
  if (visibility === "private" && !effectiveIsMember) {
    const pending = joinReqStatus === "pending";

    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>{group.name ?? ""}</h1>
        <p style={{ marginTop: 8, opacity: 0.85 }}>{group.description ?? ""}</p>

        <p style={{ marginTop: 12, opacity: 0.75 }}>
          Visibilidad: <b>private</b>
        </p>

        {pending ? (
          <p style={{ marginTop: 14, opacity: 0.8 }}>
            ✅ Solicitud enviada <b>(pendiente)</b>. El owner debe aprobarte para entrar.
          </p>
        ) : (
          <p style={{ marginTop: 14, opacity: 0.8 }}>
            Este grupo es privado. Necesitas aprobación del owner.
          </p>
        )}

        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          {!pending ? (
            <button
              onClick={handleRequestPrivate}
              disabled={joining}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #444",
                cursor: "pointer",
              }}
            >
              {joining ? "Enviando..." : "Solicitar acceso"}
            </button>
          ) : (
            <>
              <button
                disabled
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #444",
                  opacity: 0.6,
                }}
              >
                Solicitud enviada
              </button>

              <button
                onClick={handleCancelPrivate}
                disabled={joining}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              >
                {joining ? "Cancelando..." : "Cancelar solicitud"}
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  // contenido normal (public o private con membresía/owner)
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>{group.name ?? ""}</h1>
      <p style={{ marginTop: 8 }}>{group.description ?? ""}</p>

      <p style={{ marginTop: 12, opacity: 0.75 }}>
        Visibilidad: <b>{group.visibility ?? ""}</b>
      </p>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        {isOwner && <span style={{ fontSize: 12, opacity: 0.75 }}>(Eres owner)</span>}
        {!isOwner && effectiveIsMember && <span style={{ fontSize: 12, opacity: 0.75 }}>(Eres miembro)</span>}

        {!isOwner && !effectiveIsMember && visibility === "public" && (
          <button
            onClick={handleJoinPublic}
            disabled={joining}
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #444", cursor: "pointer" }}
          >
            {joining ? "Uniéndote..." : "Unirme"}
          </button>
        )}

        {!isOwner && effectiveIsMember && (
          <button
            onClick={handleLeave}
            disabled={leaving}
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
          >
            {leaving ? "Saliendo..." : "Salir"}
          </button>
        )}
      </div>
    </main>
  );
}