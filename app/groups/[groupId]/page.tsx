"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { joinGroup, leaveGroup } from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import JoinRequestsPanel from "./components/JoinRequestsPanel";

type JoinRequestStatus = "pending" | "approved" | "rejected" | string;

type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: "public" | "private" | "hidden" | string;
  isActive?: boolean;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | null;
  };
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: string | null;
  }>;
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

  const isOwner = useMemo(() => !!user && !!group?.ownerId && group.ownerId === user.uid, [user, group]);
  const effectiveIsMember = isOwner || isMember;

  useEffect(() => {
    setLoading(true);
    setError(null);

    const gref = doc(db, "groups", groupId);

    const unsubGroup = onSnapshot(
      gref,
      (gsnap) => {
        if (!gsnap.exists()) {
          setGroup(null);
          setError("Grupo no encontrado.");
          setLoading(false);
          return;
        }

        setGroup({
          id: gsnap.id,
          ...(gsnap.data() as any),
        });

        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );

    let unsubMember = () => {};
    if (user) {
      const mref = doc(db, "groups", groupId, "members", user.uid);
      unsubMember = onSnapshot(
        mref,
        (msnap) => setIsMember(msnap.exists()),
        () => setIsMember(false)
      );
    } else {
      setIsMember(false);
    }

    let unsubJoinReq = () => {};
    if (user) {
      const jref = doc(db, "groups", groupId, "joinRequests", user.uid);
      unsubJoinReq = onSnapshot(
        jref,
        (jsnap) => {
          if (!jsnap.exists()) {
            setJoinReqStatus(null);
          } else {
            const jd = jsnap.data() as any;
            setJoinReqStatus(jd.status ?? "pending");
          }
        },
        () => setJoinReqStatus(null)
      );
    } else {
      setJoinReqStatus(null);
    }

    return () => {
      unsubGroup();
      unsubMember();
      unsubJoinReq();
    };
  }, [groupId, user]);

  async function handleJoinPublic() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await joinGroup(groupId, user.uid);
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

  // Private y no miembro/owner => landing bloqueada
  if (visibility === "private" && !effectiveIsMember) {
    const pending = joinReqStatus === "pending";
    const rejected = joinReqStatus === "rejected";
    const approved = joinReqStatus === "approved";

    const isPaid = !!group.monetization?.isPaid;
    const price = group.monetization?.priceMonthly ?? null;
    const curr = group.monetization?.currency ?? null;

    return (
      <main style={{ padding: 24, maxWidth: 760 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{group.name ?? ""}</h1>
        <p style={{ marginTop: 8, opacity: 0.85 }}>{group.description ?? ""}</p>

        <p style={{ marginTop: 12, opacity: 0.75 }}>
          Visibilidad: <b>private</b>
        </p>

        {/* Aviso suscripción (informativo) */}
        {isPaid && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#fff7e6", border: "1px solid #ffe1a6" }}>
            <b>Grupo con suscripción</b>
            {price != null && curr ? (
              <span> — {curr} {price}/mes</span>
            ) : null}
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
              (MVP) Por ahora puedes unirte igual si el owner te aprueba. Más adelante se activarán cobros reales.
            </div>
          </div>
        )}

        {approved && (
          <p style={{ marginTop: 14, opacity: 0.9 }}>
            ✅ Tu solicitud fue <b>aprobada</b>. Entrando al grupo…
          </p>
        )}

        {pending && (
          <p style={{ marginTop: 14, opacity: 0.8 }}>
            ✅ Solicitud enviada <b>(pendiente)</b>. El owner debe aprobarte para entrar.
          </p>
        )}

        {!pending && !approved && !rejected && (
          <p style={{ marginTop: 14, opacity: 0.8 }}>
            Este grupo es privado. Necesitas aprobación del owner.
          </p>
        )}

        {rejected && (
          <p style={{ marginTop: 14, opacity: 0.85, color: "#b00020" }}>
            ❌ Tu solicitud fue <b>rechazada</b>.
          </p>
        )}

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!pending && !rejected ? (
            <button
              onClick={handleRequestPrivate}
              disabled={joining}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 700,
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
                  borderRadius: 10,
                  border: "1px solid #d0d0d0",
                  background: "#fff",
                  opacity: 0.75,
                  fontWeight: 700,
                }}
              >
                Solicitud enviada
              </button>

              <button
                onClick={handleCancelPrivate}
                disabled={joining}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #d0d0d0",
                  background: "#fff",
                  fontWeight: 700,
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

  // Contenido normal (public o private con membresía/owner)
  const offerings = Array.isArray(group.offerings) ? group.offerings : [];
  const enabledOfferings = offerings.filter((o) => (o as any).enabled !== false); // por compatibilidad

  const isPaidGroup = !!group.monetization?.isPaid;
  const subPrice = group.monetization?.priceMonthly ?? null;
  const subCurr = group.monetization?.currency ?? null;

  return (
    <main style={{ padding: 24, maxWidth: 820 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>{group.name ?? ""}</h1>
      <p style={{ marginTop: 8 }}>{group.description ?? ""}</p>

      <p style={{ marginTop: 12, opacity: 0.75 }}>
        Visibilidad: <b>{group.visibility ?? ""}</b>
      </p>

      {/* Leyenda en grupo ya creado (para Home/UX futura, aquí queda visible) */}
      {isPaidGroup && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "#fff7e6", border: "1px solid #ffe1a6" }}>
          <b>Grupo con suscripción</b>
          {subPrice != null && subCurr ? <span> — {subCurr} {subPrice}/mes</span> : null}
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
            (MVP) Configuración guardada. Cobros reales y bloqueo por suscripción se activan más adelante.
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {isOwner && <span style={{ fontSize: 12, opacity: 0.75 }}>(Eres owner)</span>}
        {!isOwner && effectiveIsMember && <span style={{ fontSize: 12, opacity: 0.75 }}>(Eres miembro)</span>}

        {isOwner && <JoinRequestsPanel groupId={groupId} />}

        {!isOwner && !effectiveIsMember && visibility === "public" && (
          <button
            onClick={handleJoinPublic}
            disabled={joining}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {joining ? "Uniéndote..." : "Unirme"}
          </button>
        )}

        {!isOwner && effectiveIsMember && (
          <button
            onClick={handleLeave}
            disabled={leaving}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #d0d0d0",
              background: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {leaving ? "Saliendo..." : "Salir"}
          </button>
        )}
      </div>

      {/* ✅ Servicios del creador: solo si eres miembro/owner */}
      {effectiveIsMember && enabledOfferings.length > 0 && (
        <section style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 14, padding: 14, maxWidth: 560 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Comprar al creador</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
            El creador ofrece estos servicios (MVP: botones informativos; pagos se agregan después).
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {enabledOfferings.map((o: any) => {
              const label = o.type === "saludo" ? "Saludo" : o.type === "consejo" ? "Consejo" : "Mensaje";
              const priceText = o.price != null && o.currency ? ` — ${o.currency} ${o.price}` : "";
              return (
                <button
                  key={o.type}
                  type="button"
                  onClick={() => alert(`Próximamente: compra de ${label}${priceText}`)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  Comprar {label}{priceText}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Aquí va tu contenido interno del grupo (posts, etc.) */}
    </main>
  );
}