"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { joinGroup, leaveGroup } from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import JoinRequestsPanel from "./components/JoinRequestsPanel";
import OwnerAdminPanel from "./components/OwnerAdminPanel";
import { createGreetingRequest, type GreetingType } from "@/lib/greetings/greetingRequests";

type JoinRequestStatus = "pending" | "approved" | "rejected" | string;

type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: "public" | "private" | "hidden" | string;
  isActive?: boolean;

  // ✅ imágenes
  avatarUrl?: string | null;
  coverUrl?: string | null;

  // ✅ general
  category?: string | null;
  tags?: string[] | null;

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

  // ✅ estilos base (dark)
  const pageWrap: React.CSSProperties = { padding: 24, background: "#000", minHeight: "100vh", color: "#fff" };
  const container: React.CSSProperties = { maxWidth: 980, margin: "0 auto", width: "100%" };

  // ✅ header sizes
  const coverHeight = 300; // más grande hacia abajo
  const avatarSize = 300; // más grande
  const avatarBorder = "6px solid rgba(255,255,255,0.08)";

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

  if (loading) return <div style={pageWrap}>Cargando...</div>;
  if (error) return <div style={{ ...pageWrap, color: "#ff6b6b" }}>{error}</div>;
  if (!group) return null;

  const visibility = group.visibility ?? "";

  // Private y no miembro/owner => landing bloqueada
  if (visibility === "private" && !effectiveIsMember) {
    const pending = joinReqStatus === "pending";
    const rejected = joinReqStatus === "rejected";
    const approved = joinReqStatus === "approved";

    return (
      <main style={pageWrap}>
        <div style={container}>
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              overflow: "hidden",
              background: "#0b0b0c",
            }}
          >
            {/* Portada */}
            <div style={{ height: coverHeight, background: "rgba(255,255,255,0.04)", position: "relative" }}>
              {group.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.coverUrl} alt="Cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>

            <div style={{ padding: 18 }}>
              <h1 style={{ fontSize: 26, fontWeight: 900 }}>{group.name ?? ""}</h1>
              <p style={{ marginTop: 8, opacity: 0.8 }}>{group.description ?? ""}</p>

              {approved && <p style={{ marginTop: 14, opacity: 0.9 }}>✅ Aprobado. Entrando…</p>}
              {pending && <p style={{ marginTop: 14, opacity: 0.8 }}>✅ Solicitud enviada (pendiente).</p>}
              {!pending && !approved && !rejected && <p style={{ marginTop: 14, opacity: 0.8 }}>Este grupo es privado.</p>}
              {rejected && <p style={{ marginTop: 14, opacity: 0.9, color: "#ff6b6b" }}>❌ Rechazado.</p>}

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {!pending && !rejected ? (
                  <button
                    onClick={handleRequestPrivate}
                    disabled={joining}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "#fff",
                      color: "#000",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: joining ? 0.7 : 1,
                    }}
                  >
                    {joining ? "Enviando..." : "Solicitar acceso"}
                  </button>
                ) : (
                  <button
                    onClick={handleCancelPrivate}
                    disabled={joining}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#fff",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: joining ? 0.7 : 1,
                    }}
                  >
                    {joining ? "Cancelando..." : "Cancelar solicitud"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Contenido normal (public o private con membresía/owner)
  const offerings = Array.isArray(group.offerings) ? group.offerings : [];
  const enabledOfferings = offerings.filter((o) => (o as any).enabled !== false);

  return (
    <main style={pageWrap}>
      <div style={container}>
        {/* CARD principal */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            overflow: "hidden",
            background: "#0b0b0c",
          }}
        >
          {/* ✅ Header: Portada más alta + Avatar encimado */}
          <div style={{ position: "relative" }}>
            <div style={{ height: coverHeight, background: "rgba(255,255,255,0.04)" }}>
              {group.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.coverUrl} alt="Cover" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>

            {/* Avatar centrado: mitad dentro/mitad fuera */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: 0,
                transform: "translate(-50%, 50%)",
                width: avatarSize,
                height: avatarSize,
                borderRadius: 999,
                overflow: "hidden",
                border: avatarBorder,
                background: "rgba(255,255,255,0.06)",
                boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
              }}
            >
              {group.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.avatarUrl} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>
          </div>

          {/* Contenido (con padding extra arriba por el avatar encimado) */}
          <div style={{ padding: 18, paddingTop: 18 + avatarSize / 2 + 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 900 }}>{group.name ?? ""}</h1>
                <p style={{ marginTop: 8, opacity: 0.8 }}>{group.description ?? ""}</p>
                <p style={{ marginTop: 10, opacity: 0.6, fontSize: 13 }}>
                  Visibilidad: <b style={{ opacity: 0.9 }}>{group.visibility ?? ""}</b>
                </p>
              </div>

              {/* ✅ Admin panel dentro del grupo */}
              {user && group.ownerId ? (
                <OwnerAdminPanel
                  groupId={groupId}
                  ownerId={group.ownerId}
                  currentUserId={user.uid}
                  currentAvatarUrl={group.avatarUrl ?? null}
                  currentCoverUrl={group.coverUrl ?? null}
                  currentName={group.name ?? null}
                  currentDescription={group.description ?? null}
                  currentCategory={group.category ?? null}
                  currentTags={group.tags ?? null}
                />
              ) : null}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {isOwner && <span style={{ fontSize: 12, opacity: 0.7 }}>(Eres owner)</span>}
              {!isOwner && effectiveIsMember && <span style={{ fontSize: 12, opacity: 0.7 }}>(Eres miembro)</span>}

              {isOwner && <JoinRequestsPanel groupId={groupId} />}

              {!isOwner && !effectiveIsMember && visibility === "public" && (
                <button
                  onClick={handleJoinPublic}
                  disabled={joining}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "#fff",
                    color: "#000",
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: joining ? 0.7 : 1,
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
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: leaving ? 0.7 : 1,
                  }}
                >
                  {leaving ? "Saliendo..." : "Salir"}
                </button>
              )}
            </div>

            {/* ✅ Servicios del creador: solo si eres miembro (NO owner) */}
            {!isOwner && effectiveIsMember && enabledOfferings.length > 0 && (
              <section
                style={{
                  marginTop: 18,
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(255,255,255,0.03)",
                  maxWidth: 640,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Comprar al creador</div>
                <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
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
                          border: "1px solid rgba(255,255,255,0.10)",
                          background: disabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.06)",
                          color: "#fff",
                          fontWeight: 900,
                          cursor: disabled ? "not-allowed" : "pointer",
                          textAlign: "left",
                          opacity: disabled ? 0.55 : 0.95,
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
                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(0,0,0,0.35)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>Solicitar {labelForOfferingType(greetType)}</div>
                      <button
                        type="button"
                        onClick={closeGreetingForm}
                        disabled={greetSubmitting}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.06)",
                          color: "#fff",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Cerrar
                      </button>
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.85 }}>¿A quién va dirigido?</span>
                        <input
                          value={toName}
                          onChange={(e) => setToName(e.target.value)}
                          placeholder="Ej. Para Juan"
                          disabled={greetSubmitting}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "rgba(255,255,255,0.06)",
                            color: "#fff",
                            outline: "none",
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.85 }}>Contexto / instrucciones</span>
                        <textarea
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                          placeholder="Ej. Cumpleaños, felicitación por logro, tono del mensaje, etc."
                          disabled={greetSubmitting}
                          rows={5}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "rgba(255,255,255,0.06)",
                            color: "#fff",
                            resize: "vertical",
                            outline: "none",
                          }}
                        />
                      </label>

                      {greetError && <div style={{ color: "#ff6b6b", fontSize: 13 }}>{greetError}</div>}
                      {greetSuccess && <div style={{ color: "#55efc4", fontSize: 13 }}>{greetSuccess}</div>}

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={submitGreetingRequest}
                          disabled={greetSubmitting}
                          style={{
                            padding: "10px 14px",
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "#fff",
                            color: "#000",
                            fontWeight: 900,
                            cursor: "pointer",
                            opacity: greetSubmitting ? 0.7 : 1,
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
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "rgba(255,255,255,0.06)",
                            color: "#fff",
                            fontWeight: 900,
                            cursor: "pointer",
                            opacity: greetSubmitting ? 0.7 : 1,
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
        </div>
      </div>
    </main>
  );
}