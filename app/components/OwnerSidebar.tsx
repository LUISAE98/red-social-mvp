"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import {
  updateOfferings,
  type GroupOffering,
} from "@/lib/groups/updateOfferings";

type UserDoc = {
  uid: string;
  handle: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
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
  visibility?: "public" | "private" | "hidden" | string;
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: "MXN" | "USD" | null;
  }>;
};

function visibilitySectionTitle(v: string) {
  if (v === "public") return "Públicos";
  if (v === "private") return "Privados";
  if (v === "hidden") return "Ocultos";
  return "Otros";
}

function pickSaludoOffering(offerings: GroupDocLite["offerings"]) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === "saludo");
  const enabled = found?.enabled === true;
  const price = found?.price ?? null;
  const currency = (found?.currency ?? "MXN") as "MXN" | "USD";
  return { enabled, price, currency };
}

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      title={label}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.16)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.10)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 160ms ease",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
        }}
      />
    </button>
  );
}

export default function OwnerSidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [viewer, setViewer] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [myGroups, setMyGroups] = useState<GroupDocLite[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsErr, setGroupsErr] = useState<string | null>(null);

  const [savingProfileGreeting, setSavingProfileGreeting] = useState(false);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [pgEnabled, setPgEnabled] = useState(false);
  const [pgPrice, setPgPrice] = useState<string>("");
  const [pgCurrency, setPgCurrency] = useState<"MXN" | "USD">("MXN");

  const [groupDraft, setGroupDraft] = useState<
    Record<string, { enabled: boolean; price: string; currency: "MXN" | "USD" }>
  >({});

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const ui = {
    sidebarWidth: 286,
    sidebarTop: 84,
    sidebarBottom: 16,
    fontBody: 13,
    fontMicro: 12,
    buttonRadius: 9,
    buttonPadding: "8px 12px",
  };

  const styles = {
    input: {
      padding: "9px 11px",
      borderRadius: 9,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.04)",
      color: "#fff",
      outline: "none",
      fontSize: ui.fontBody,
      fontFamily: fontStack,
      boxSizing: "border-box",
      appearance: "none",
      WebkitAppearance: "none",
      MozAppearance: "none",
    } as React.CSSProperties,
    buttonSecondary: {
      padding: ui.buttonPadding,
      borderRadius: ui.buttonRadius,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: ui.fontBody,
      fontFamily: fontStack,
      lineHeight: 1.2,
    } as React.CSSProperties,
    message: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      color: "#fff",
      fontSize: ui.fontMicro,
      lineHeight: 1.4,
    } as React.CSSProperties,
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadCurrentUser() {
      if (!viewer?.uid) {
        setUserDoc(null);
        setLoadingUser(false);
        return;
      }

      setLoadingUser(true);
      setMsg(null);

      try {
        const uref = doc(db, "users", viewer.uid);
        const usnap = await getDoc(uref);

        if (!usnap.exists()) {
          setUserDoc(null);
          return;
        }

        const u = usnap.data() as UserDoc;
        setUserDoc(u);

        const pg = u.profileGreeting;
        setPgEnabled(pg?.enabled === true);
        setPgPrice(pg?.price == null ? "" : String(pg.price));
        setPgCurrency((pg?.currency ?? "MXN") as "MXN" | "USD");
      } catch (e: any) {
        setMsg(e?.message ?? "No se pudo cargar tu perfil.");
        setUserDoc(null);
      } finally {
        setLoadingUser(false);
      }
    }

    loadCurrentUser();
  }, [viewer?.uid]);

  useEffect(() => {
    async function loadMyGroups() {
      if (!viewer?.uid) {
        setMyGroups([]);
        setGroupDraft({});
        return;
      }

      setLoadingGroups(true);
      setGroupsErr(null);

      try {
        const gq = query(
          collection(db, "groups"),
          where("ownerId", "==", viewer.uid),
          limit(50)
        );

        const gs = await getDocs(gq);

        const rows: GroupDocLite[] = gs.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setMyGroups(rows);

        const draft: Record<
          string,
          { enabled: boolean; price: string; currency: "MXN" | "USD" }
        > = {};

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
  }, [viewer?.uid]);

  async function saveProfileGreeting() {
    if (!viewer?.uid || !userDoc) return;

    setSavingProfileGreeting(true);
    setMsg(null);

    try {
      const priceNum = pgPrice.trim() === "" ? null : Number(pgPrice);

      if (
        pgEnabled &&
        (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)
      ) {
        setMsg("❌ Precio inválido.");
        return;
      }

      const uref = doc(db, "users", viewer.uid);

      await updateDoc(uref, {
        profileGreeting: {
          enabled: pgEnabled,
          price: pgEnabled ? priceNum : null,
          currency: pgEnabled ? pgCurrency : null,
        },
      });

      setUserDoc((prev) =>
        prev
          ? {
              ...prev,
              profileGreeting: {
                enabled: pgEnabled,
                price: pgEnabled ? priceNum : null,
                currency: pgEnabled ? pgCurrency : null,
              },
            }
          : prev
      );

      setMsg("✅ Configuración de saludos en perfil guardada.");
    } catch (e: any) {
      setMsg(e?.message ?? "❌ No se pudo guardar configuración.");
    } finally {
      setSavingProfileGreeting(false);
    }
  }

  async function saveGroupSaludo(groupId: string) {
    const g = myGroups.find((x) => x.id === groupId);
    if (!g) return;

    const d = groupDraft[groupId];
    if (!d) return;

    const priceNum = d.price.trim() === "" ? null : Number(d.price);

    if (
      d.enabled &&
      (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)
    ) {
      setGroupsErr("❌ Precio inválido en un grupo.");
      return;
    }

    const existing = Array.isArray(g.offerings) ? g.offerings : [];
    const next: GroupOffering[] = [];

    const hasType = (t: string) =>
      existing.some((o: any) => String(o?.type) === t);

    next.push({
      type: "saludo",
      enabled: d.enabled,
      price: d.enabled ? priceNum : null,
      currency: d.enabled ? d.currency : null,
    });

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

  const grouped = useMemo(() => {
    const publics = myGroups.filter((g) => g.visibility === "public");
    const privates = myGroups.filter((g) => g.visibility === "private");
    const hiddens = myGroups.filter((g) => g.visibility === "hidden");
    const others = myGroups.filter(
      (g) =>
        g.visibility !== "public" &&
        g.visibility !== "private" &&
        g.visibility !== "hidden"
    );

    return [
      { key: "public", title: visibilitySectionTitle("public"), items: publics },
      {
        key: "private",
        title: visibilitySectionTitle("private"),
        items: privates,
      },
      { key: "hidden", title: visibilitySectionTitle("hidden"), items: hiddens },
      { key: "other", title: visibilitySectionTitle("other"), items: others },
    ].filter((section) => section.items.length > 0);
  }, [myGroups]);

  const profileHref = userDoc?.handle ? `/u/${userDoc.handle}` : null;

  const isProfileRoute =
    !!profileHref && (pathname === profileHref || pathname?.startsWith(`${profileHref}/`));

  if (!authReady) return null;
  if (!viewer) return null;

  return (
    <>
      <style jsx>{`
        .profile-owner-sidebar-scroll {
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
          -webkit-overflow-scrolling: touch;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar {
          width: 6px;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        @media (max-width: 1220px) {
          .profile-owner-sidebar-fixed {
            position: static !important;
            width: 100% !important;
            max-height: none !important;
            margin: 18px auto 0 !important;
          }

          .profile-owner-sidebar-scroll {
            max-height: none !important;
            overflow: visible !important;
          }
        }
      `}</style>

      <aside
        className="profile-owner-sidebar-fixed"
        style={{
          position: "fixed",
          left: 18,
          top: ui.sidebarTop,
          width: ui.sidebarWidth,
          maxHeight: `calc(100vh - ${ui.sidebarTop + ui.sidebarBottom}px)`,
          zIndex: 9998,
          fontFamily: fontStack,
          background: "transparent",
          border: "none",
          boxShadow: "none",
          color: "#fff",
        }}
      >
        <div
          className="profile-owner-sidebar-scroll"
          style={{
            maxHeight: `calc(100vh - ${ui.sidebarTop + ui.sidebarBottom}px)`,
            paddingRight: 4,
            display: "grid",
            gap: 10,
          }}
        >
          <div
            style={{
              padding: "2px 2px 8px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.34)",
            }}
          >
            Menú del owner
          </div>

          {msg && <div style={styles.message}>{msg}</div>}
          {groupsErr && <div style={styles.message}>{groupsErr}</div>}

          <div
            style={{
              padding: "10px 10px 12px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "grid",
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (profileHref) router.push(profileHref);
              }}
              disabled={!profileHref || isProfileRoute}
              style={{
                background: isProfileRoute
                  ? "rgba(255,255,255,0.08)"
                  : "transparent",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#fff",
                textAlign: "left",
                cursor:
                  !profileHref || isProfileRoute ? "default" : "pointer",
                fontSize: ui.fontBody,
                fontWeight: 600,
                padding: "10px 12px",
                borderRadius: 10,
                fontFamily: fontStack,
                opacity: !profileHref ? 0.55 : 1,
              }}
              title="Ir a mi perfil"
            >
              Mi perfil
            </button>

            <div
              style={{
                fontWeight: 600,
                fontSize: ui.fontBody,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span>Saludos en perfil</span>
              <Switch
                checked={pgEnabled}
                disabled={savingProfileGreeting || loadingUser}
                onChange={(next) => setPgEnabled(next)}
                label="Vender saludos en mi perfil"
              />
            </div>

            <div
              style={{
                fontSize: ui.fontMicro,
                color: "rgba(255,255,255,0.56)",
              }}
            >
              Configura si quieres vender saludos directamente desde tu perfil.
            </div>

            {pgEnabled && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <input
                  type="number"
                  value={pgPrice}
                  onChange={(e) => setPgPrice(e.target.value)}
                  placeholder="Precio"
                  style={{
                    ...styles.input,
                    width: 110,
                  }}
                />

                <select
                  value={pgCurrency}
                  onChange={(e) =>
                    setPgCurrency(e.target.value as "MXN" | "USD")
                  }
                  style={{
                    ...styles.input,
                    flex: 1,
                    minWidth: 90,
                  }}
                >
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={saveProfileGreeting}
              disabled={savingProfileGreeting || loadingUser}
              style={{
                ...styles.buttonSecondary,
                width: "100%",
                opacity: savingProfileGreeting || loadingUser ? 0.7 : 1,
                cursor:
                  savingProfileGreeting || loadingUser
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {savingProfileGreeting ? "Guardando..." : "Guardar Mi perfil"}
            </button>
          </div>

          {!loadingGroups && myGroups.length === 0 && (
            <div
              style={{
                fontSize: ui.fontMicro,
                color: "rgba(255,255,255,0.58)",
                padding: "2px 2px 0",
              }}
            >
              No tienes grupos como owner.
            </div>
          )}

          {grouped.map((section) => (
            <div key={section.key} style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.38)",
                  textTransform: "uppercase",
                  letterSpacing: 0.55,
                  padding: "6px 2px 2px",
                }}
              >
                {section.title}
              </div>

              {section.items.map((g) => {
                const d = groupDraft[g.id];
                if (!d) return null;

                const saving = savingGroupId === g.id;

                return (
                  <div
                    key={g.id}
                    style={{
                      padding: "10px 10px 12px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => router.push(`/groups/${g.id}`)}
                        style={{
                          fontWeight: 600,
                          fontSize: ui.fontBody,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          color: "#fff",
                          fontFamily: fontStack,
                          flex: 1,
                        }}
                        title="Abrir grupo"
                      >
                        {g.name ?? "(Sin nombre)"}
                      </button>

                      <Switch
                        checked={d.enabled}
                        disabled={saving}
                        onChange={(next) =>
                          setGroupDraft((prev) => ({
                            ...prev,
                            [g.id]: { ...prev[g.id], enabled: next },
                          }))
                        }
                        label="Saludos activos en este grupo"
                      />
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        fontSize: ui.fontMicro,
                        color: "rgba(255,255,255,0.56)",
                      }}
                    >
                      Saludos activos en este grupo
                    </div>

                    {d.enabled && (
                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
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
                          style={{
                            ...styles.input,
                            width: 110,
                          }}
                        />

                        <select
                          value={d.currency}
                          onChange={(e) =>
                            setGroupDraft((prev) => ({
                              ...prev,
                              [g.id]: {
                                ...prev[g.id],
                                currency: e.target.value as "MXN" | "USD",
                              },
                            }))
                          }
                          style={{
                            ...styles.input,
                            flex: 1,
                            minWidth: 90,
                          }}
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
                        ...styles.buttonSecondary,
                        marginTop: 10,
                        opacity: saving ? 0.7 : 1,
                        width: "100%",
                        cursor: saving ? "not-allowed" : "pointer",
                      }}
                    >
                      {saving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          {loadingGroups && (
            <div
              style={{
                fontSize: ui.fontMicro,
                color: "rgba(255,255,255,0.58)",
                padding: "2px 2px 0",
              }}
            >
              Cargando grupos...
            </div>
          )}
        </div>
      </aside>
    </>
  );
}