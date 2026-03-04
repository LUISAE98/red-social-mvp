"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { updateOfferings, type GroupOffering } from "@/lib/groups/updateOfferings";

type UserDoc = {
  uid: string;
  handle: string;
  displayName: string;
  firstName: string;
  lastName: string;
  age: number;
  sex: string;
  photoURL: string | null;

  // ✅ NUEVO: config de saludos en perfil
  profileGreeting?: {
    enabled: boolean;
    price: number | null;
    currency: "MXN" | "USD" | null;
  };
};

type GroupDocLite = {
  id: string;
  name?: string;
  ownerId?: string;
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: "MXN" | "USD" | null;
  }>;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

function pickSaludoOffering(offerings: GroupDocLite["offerings"]) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === "saludo");
  const enabled = found?.enabled === true;
  const price = found?.price ?? null;
  const currency = (found?.currency ?? "MXN") as "MXN" | "USD";
  return { enabled, price, currency };
}

export default function ProfileClient() {
  const params = useParams<{ handle: string }>();
  const handle = useMemo(() => String(params?.handle || "").toLowerCase(), [params]);

  const [viewer, setViewer] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOwner = !!viewer && !!userDoc && viewer.uid === userDoc.uid;

  // ==========================
  // ✅ Saludos en perfil (owner)
  // ==========================
  const [pgEnabled, setPgEnabled] = useState(false);
  const [pgPrice, setPgPrice] = useState<string>(""); // string para input controlado
  const [pgCurrency, setPgCurrency] = useState<"MXN" | "USD">("MXN");
  const [savingProfileGreeting, setSavingProfileGreeting] = useState(false);

  // ==========================
  // ✅ Cajita: mis grupos + saludos
  // ==========================
  const [myGroups, setMyGroups] = useState<GroupDocLite[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsErr, setGroupsErr] = useState<string | null>(null);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

  // UI local editable por grupo (para precio/enable sin escribir en cada tecla)
  const [groupDraft, setGroupDraft] = useState<Record<string, { enabled: boolean; price: string; currency: "MXN" | "USD" }>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  async function loadProfile() {
    setLoading(true);
    setMsg(null);
    try {
      // resolver handle -> uid
      const hq = query(collection(db, "handles"), where("__name__", "==", handle), limit(1));
      const hs = await getDocs(hq);
      if (hs.empty) {
        setUserDoc(null);
        setMsg("No existe este usuario.");
        return;
      }

      const hdata = hs.docs[0].data() as any;
      const uid = hdata?.uid as string;

      if (!uid) {
        setUserDoc(null);
        setMsg("Handle inválido.");
        return;
      }

      const uref = doc(db, "users", uid);
      const usnap = await getDoc(uref);
      if (!usnap.exists()) {
        setUserDoc(null);
        setMsg("Perfil no encontrado.");
        return;
      }

      const u = usnap.data() as UserDoc;
      setUserDoc(u);

      // ✅ hidratar config de saludos perfil
      const pg = u.profileGreeting;
      setPgEnabled(pg?.enabled === true);
      setPgPrice(pg?.price == null ? "" : String(pg.price));
      setPgCurrency((pg?.currency ?? "MXN") as "MXN" | "USD");
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando perfil");
      setUserDoc(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!handle) return;
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // ✅ Cargar mis grupos (solo si soy owner viendo mi perfil)
  useEffect(() => {
    async function loadMyGroups() {
      if (!isOwner || !viewer?.uid) {
        setMyGroups([]);
        setGroupDraft({});
        return;
      }

      setLoadingGroups(true);
      setGroupsErr(null);

      try {
        const gq = query(collection(db, "groups"), where("ownerId", "==", viewer.uid), limit(50));
        const gs = await getDocs(gq);

        const rows: GroupDocLite[] = gs.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setMyGroups(rows);

        // preparar drafts por grupo
        const draft: Record<string, { enabled: boolean; price: string; currency: "MXN" | "USD" }> = {};
        for (const g of rows) {
          const s = pickSaludoOffering(g.offerings);
          draft[g.id] = {
            enabled: s.enabled,
            price: s.price == null ? "" : String(s.price),
            currency: s.currency ?? "MXN",
          };
        }
        setGroupDraft(draft);
      } catch (e: any) {
        setGroupsErr(e?.message ?? "No se pudieron cargar tus grupos.");
        setMyGroups([]);
        setGroupDraft({});
      } finally {
        setLoadingGroups(false);
      }
    }

    loadMyGroups();
  }, [isOwner, viewer?.uid]);

  async function handlePickFile() {
    if (!isOwner) return;
    fileInputRef.current?.click();
  }

  async function handleUpload(file: File) {
    if (!userDoc) return;
    if (!isOwner) return;

    setUploading(true);
    setMsg(null);

    try {
      const uid = userDoc.uid;

      const avatarRef = ref(storage, `avatars/${uid}`);
      await uploadBytes(avatarRef, file, { contentType: file.type || "image/jpeg" });
      const photoURL = await getDownloadURL(avatarRef);

      const uref = doc(db, "users", uid);
      await updateDoc(uref, { photoURL });

      setUserDoc((prev) => (prev ? { ...prev, photoURL } : prev));
      setMsg("✅ Foto actualizada.");
    } catch (e: any) {
      setMsg(
        e?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Storage/Firestore."
          : `❌ No se pudo subir la foto: ${e?.message ?? "error"}`
      );
    } finally {
      setUploading(false);
    }
  }

  async function saveProfileGreeting() {
    if (!userDoc || !isOwner) return;

    setSavingProfileGreeting(true);
    setMsg(null);

    try {
      const priceNum = pgPrice.trim() === "" ? null : Number(pgPrice);
      if (pgEnabled && (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)) {
        setMsg("❌ Precio inválido.");
        return;
      }

      const uref = doc(db, "users", userDoc.uid);
      await updateDoc(uref, {
        profileGreeting: {
          enabled: pgEnabled,
          price: pgEnabled ? priceNum : null,
          currency: pgEnabled ? pgCurrency : null,
        },
      });

      setMsg("✅ Configuración de saludos en perfil guardada.");
    } catch (e: any) {
      setMsg(e?.message ?? "❌ No se pudo guardar configuración.");
    } finally {
      setSavingProfileGreeting(false);
    }
  }

  async function saveGroupSaludo(groupId: string) {
    if (!isOwner) return;

    const g = myGroups.find((x) => x.id === groupId);
    if (!g) return;

    const d = groupDraft[groupId];
    if (!d) return;

    const priceNum = d.price.trim() === "" ? null : Number(d.price);
    if (d.enabled && (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)) {
      setGroupsErr("❌ Precio inválido en un grupo.");
      return;
    }

    // construir offerings manteniendo consejo/mensaje como estén (no borrarlos)
    const existing = Array.isArray(g.offerings) ? g.offerings : [];
    const next: GroupOffering[] = [];

    const hasType = (t: string) => existing.some((o: any) => String(o?.type) === t);

    // saludo (editable)
    next.push({
      type: "saludo",
      enabled: d.enabled,
      price: d.enabled ? priceNum : null,
      currency: d.enabled ? d.currency : null,
    });

    // conservar otros offerings si existían
    if (hasType("consejo")) {
      const o = existing.find((x: any) => String(x?.type) === "consejo") as any;
      next.push({
        type: "consejo",
        enabled: o?.enabled === true,
        price: o?.price ?? null,
        currency: o?.currency ?? null,
      });
    }
    if (hasType("mensaje")) {
      const o = existing.find((x: any) => String(x?.type) === "mensaje") as any;
      next.push({
        type: "mensaje",
        enabled: o?.enabled === true,
        price: o?.price ?? null,
        currency: o?.currency ?? null,
      });
    }

    setSavingGroupId(groupId);
    setGroupsErr(null);

    try {
      await updateOfferings(groupId, next);

      // refrescar el grupo localmente para que cuadre con Firestore
      setMyGroups((prev) =>
        prev.map((gg) => {
          if (gg.id !== groupId) return gg;
          return {
            ...gg,
            offerings: [
              ...existing.filter((o: any) => String(o?.type) !== "saludo"),
              {
                type: "saludo",
                enabled: d.enabled,
                price: d.enabled ? priceNum : null,
                currency: d.enabled ? d.currency : null,
              },
            ],
          };
        })
      );
    } catch (e: any) {
      setGroupsErr(e?.message ?? "❌ No se pudo actualizar el grupo.");
    } finally {
      setSavingGroupId(null);
    }
  }

  if (loading) {
    return <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>Cargando perfil...</main>;
  }

  if (!userDoc) {
    return <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>{msg ?? "Perfil no disponible"}</main>;
  }

  const fullName = userDoc.displayName || `${userDoc.firstName} ${userDoc.lastName}`.trim();

  return (
    <>
      {/* ==========================
          PERFIL (NO TOCADO: lo que tú ya tenías)
         ========================== */}
      <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 16, padding: 22 }}>
          {/* Avatar */}
          <div style={{ display: "grid", placeItems: "center", marginTop: 6 }}>
            <div style={{ position: "relative" }}>
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "1px solid #ddd",
                  display: "grid",
                  placeItems: "center",
                  background: "#f5f5f5",
                  userSelect: "none",
                }}
              >
                {userDoc.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userDoc.photoURL} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 34, fontWeight: 800, color: "#555" }}>{initials(fullName)}</span>
                )}
              </div>

              {isOwner && (
                <button
                  onClick={handlePickFile}
                  disabled={uploading}
                  style={{
                    position: "absolute",
                    right: -6,
                    bottom: -6,
                    padding: "8px 10px",
                    borderRadius: 999,
                    border: "1px solid #111",
                    background: uploading ? "#ddd" : "#111",
                    color: uploading ? "#333" : "#fff",
                    cursor: uploading ? "not-allowed" : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {uploading ? "Subiendo..." : "Editar"}
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </div>

          {/* Nombre + handle */}
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{fullName}</div>
            <div style={{ marginTop: 4, color: "#666" }}>@{userDoc.handle}</div>
          </div>

          {/* Info básica */}
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "#666" }}>Edad</span>
              <b>{userDoc.age}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "#666" }}>Sexo</span>
              <b>{userDoc.sex}</b>
            </div>
          </div>

          {/* ✅ NUEVO: Config saludos en perfil (solo owner) */}
          {isOwner && (
            <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Saludos desde mi perfil</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
                Activa/desactiva y configura el precio exclusivo de tu perfil (puede ser distinto a tus grupos).
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800 }}>
                <input
                  type="checkbox"
                  checked={pgEnabled}
                  onChange={(e) => setPgEnabled(e.target.checked)}
                />
                Activar saludos en perfil
              </label>

              {pgEnabled && (
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    type="number"
                    value={pgPrice}
                    onChange={(e) => setPgPrice(e.target.value)}
                    placeholder="Precio"
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d0d0d0" }}
                  />
                  <select
                    value={pgCurrency}
                    onChange={(e) => setPgCurrency(e.target.value as "MXN" | "USD")}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d0d0d0" }}
                  >
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={saveProfileGreeting}
                disabled={savingProfileGreeting}
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #111",
                  background: "#111",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                  opacity: savingProfileGreeting ? 0.75 : 1,
                }}
              >
                {savingProfileGreeting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          )}

          {msg && <p style={{ marginTop: 16, marginBottom: 0 }}>{msg}</p>}

          {/* Debug sesión */}
          {authReady && viewer && (
            <p style={{ marginTop: 16, opacity: 0.65, fontSize: 12 }}>
              Sesión activa: {viewer.email}
            </p>
          )}
        </div>
      </main>

      {/* ==========================
          ✅ Cajita fija: Mis grupos — Saludos (otra esquina)
         ========================== */}
      {isOwner && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            width: 360,
            zIndex: 9998,
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
            <div
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
                fontWeight: 900,
              }}
            >
              <span>Mis grupos — Saludos</span>
              <span style={{ fontSize: 12, opacity: 0.85 }}>{loadingGroups ? "Cargando..." : `${myGroups.length}`}</span>
            </div>

            <div style={{ padding: 12, display: "grid", gap: 10 }}>
              {groupsErr && <div style={{ fontSize: 12, color: "#b00020" }}>{groupsErr}</div>}

              {!loadingGroups && myGroups.length === 0 && (
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  No tienes grupos como owner.
                </div>
              )}

              {myGroups.map((g) => {
                const d = groupDraft[g.id];
                if (!d) return null;

                const saving = savingGroupId === g.id;

                return (
                  <div key={g.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{g.name ?? "(Sin nombre)"}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>id: {g.id}</div>

                    <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontWeight: 800 }}>
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) =>
                          setGroupDraft((prev) => ({
                            ...prev,
                            [g.id]: { ...prev[g.id], enabled: e.target.checked },
                          }))
                        }
                      />
                      Saludos activos en este grupo
                    </label>

                    {d.enabled && (
                      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <input
                          type="number"
                          value={d.price}
                          onChange={(e) =>
                            setGroupDraft((prev) => ({
                              ...prev,
                              [g.id]: { ...prev[g.id], price: e.target.value },
                            }))
                          }
                          placeholder="Precio"
                          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d0d0d0" }}
                        />
                        <select
                          value={d.currency}
                          onChange={(e) =>
                            setGroupDraft((prev) => ({
                              ...prev,
                              [g.id]: { ...prev[g.id], currency: e.target.value as "MXN" | "USD" },
                            }))
                          }
                          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #d0d0d0" }}
                        >
                          <option value="MXN">MXN</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => saveGroupSaludo(g.id)}
                      disabled={saving}
                      style={{
                        marginTop: 10,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #111",
                        background: "#111",
                        color: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                        opacity: saving ? 0.75 : 1,
                        width: "100%",
                      }}
                    >
                      {saving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}