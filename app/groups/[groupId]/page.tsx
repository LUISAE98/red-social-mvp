"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { joinGroup, leaveGroup } from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import JoinRequestsPanel from "./components/JoinRequestsPanel";
import { createGreetingRequest, type GreetingType } from "@/lib/greetings/greetingRequests";

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

function labelForOfferingType(t: string) {
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  return "Mensaje";
}

function isGreetingType(t: string): t is GreetingType {
  return t === "saludo" || t === "consejo" || t === "mensaje";
}

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

  // Greeting request UI state (MVP sin pagos)
  const [greetOpen, setGreetOpen] = useState(false);
  const [greetType, setGreetType] = useState<GreetingType>("saludo");
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);

  // ✅ estilos de centrado reutilizables
  const pageWrap: React.CSSProperties = { padding: 24 };
  const container: React.CSSProperties = { maxWidth: 820, margin: "0 auto", width: "100%" };

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

  function openGreetingForm(type: GreetingType) {
    setGreetError(null);
    setGreetSuccess(null);
    setGreetType(type);
    setToName("");
    setInstructions("");
    setGreetOpen(true);
  }

  function closeGreetingForm() {
    setGreetOpen(false);
    setGreetSubmitting(false);
    setGreetError(null);
    setGreetSuccess(null);
    setToName("");
    setInstructions("");
  }

  async function submitGreetingRequest() {
    if (!user) return;

    // Seguridad UX (backend ya lo bloquea)
    if (isOwner) {
      setGreetError("No puedes solicitar/comprar saludos en tu propio grupo.");
      return;
    }

    if (!toName.trim()) {
      setGreetError("Escribe el nombre de la persona a quien va dirigido el saludo.");
      return;
    }
    if (!instructions.trim()) {
      setGreetError("Escribe el contexto / instrucciones del saludo.");
      return;
    }

    setGreetSubmitting(true);
    setGreetError(null);
    setGreetSuccess(null);

    try {
      const res = await createGreetingRequest({
        groupId,
        type: greetType,
        toName: toName.trim(),
        instructions: instructions.trim(),
        source: "group",
      });

      setGreetSuccess(`✅ Solicitud enviada. ID: ${res.requestId}`);
      setGreetOpen(false);
      setToName("");
      setInstructions("");
    } catch (e: any) {
      setGreetError(e?.message ?? "No se pudo enviar la solicitud.");
    } finally {
      setGreetSubmitting(false);
    }
  }

  if (loading) return <div style={{ ...pageWrap }}>Cargando...</div>;
  if (error) return <div style={{ ...pageWrap, color: "red" }}>{error}</div>;
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
      <main style={pageWrap}>
        <div style={{ ...container, maxWidth: 760 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>{group.name ?? ""}</h1>
          <p style={{ marginTop: 8, opacity: 0.85 }}>{group.description ?? ""}</p>

          <p style={{ marginTop: 12, opacity: 0.75 }}>
            Visibilidad: <b>private</b>
          </p>

          {isPaid && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#fff7e6", border: "1px solid #ffe1a6" }}>
              <b>Grupo con suscripción</b>
              {price != null && curr ? <span> — {curr} {price}/mes</span> : null}
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
        </div>
      </main>
    );
  }

  // Contenido normal (public o private con membresía/owner)
  const offerings = Array.isArray(group.offerings) ? group.offerings : [];
  const enabledOfferings = offerings.filter((o) => (o as any).enabled !== false);

  const isPaidGroup = !!group.monetization?.isPaid;
  const subPrice = group.monetization?.priceMonthly ?? null;
  const subCurr = group.monetization?.currency ?? null;

  return (
    <main style={pageWrap}>
      <div style={container}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{group.name ?? ""}</h1>
        <p style={{ marginTop: 8 }}>{group.description ?? ""}</p>

        <p style={{ marginTop: 12, opacity: 0.75 }}>
          Visibilidad: <b>{group.visibility ?? ""}</b>
        </p>

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

        {/* ✅ Servicios del creador: solo si eres miembro (NO owner) */}
        {!isOwner && effectiveIsMember && enabledOfferings.length > 0 && (
          <section style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 14, padding: 14, maxWidth: 600 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Comprar al creador</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
              (MVP sin pagos) Envías una solicitud al creador. El creador podrá aceptarla o rechazarla.
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {enabledOfferings.map((o: any) => {
                const t = String(o.type ?? "");
                const label = labelForOfferingType(t);
                const priceText = o.price != null && o.currency ? ` — ${o.currency} ${o.price}` : "";

                const disabled = !isGreetingType(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (!isGreetingType(t)) return;
                      openGreetingForm(t);
                    }}
                    disabled={disabled}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #111",
                      background: disabled ? "#999" : "#111",
                      color: "#fff",
                      fontWeight: 800,
                      cursor: disabled ? "not-allowed" : "pointer",
                      textAlign: "left",
                      opacity: disabled ? 0.65 : 1,
                    }}
                    title={disabled ? "Tipo de servicio no soportado en MVP" : undefined}
                  >
                    Solicitar {label}
                    {priceText}
                  </button>
                );
              })}
            </div>

            {greetOpen && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #ddd", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ fontWeight: 900 }}>
                    Solicitar {labelForOfferingType(greetType)}
                  </div>
                  <button
                    type="button"
                    onClick={closeGreetingForm}
                    disabled={greetSubmitting}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #d0d0d0",
                      background: "#fff",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Cerrar
                  </button>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>¿A quién va dirigido?</span>
                    <input
                      value={toName}
                      onChange={(e) => setToName(e.target.value)}
                      placeholder="Ej. Para Juan"
                      disabled={greetSubmitting}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #d0d0d0",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>Contexto / instrucciones</span>
                    <textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="Ej. Cumpleaños, felicitación por logro, tono del mensaje, etc."
                      disabled={greetSubmitting}
                      rows={5}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #d0d0d0",
                        resize: "vertical",
                      }}
                    />
                  </label>

                  {greetError && <div style={{ color: "#b00020", fontSize: 13 }}>{greetError}</div>}
                  {greetSuccess && <div style={{ color: "#0a7a0a", fontSize: 13 }}>{greetSuccess}</div>}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={submitGreetingRequest}
                      disabled={greetSubmitting}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #111",
                        background: "#111",
                        color: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      {greetSubmitting ? "Enviando..." : "Enviar solicitud"}
                    </button>

                    <button
                      type="button"
                      onClick={closeGreetingForm}
                      disabled={greetSubmitting}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #d0d0d0",
                        background: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Cancelar
                    </button>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Nota: el creador podrá aceptar o rechazar tu solicitud. (Pagos y entrega de video se integran después.)
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Aquí va tu contenido interno del grupo (posts, etc.) */}
      </div>
    </main>
  );
}