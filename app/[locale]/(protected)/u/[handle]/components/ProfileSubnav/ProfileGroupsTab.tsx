"use client";


import type { ReactNode } from "react";
import Image from "next/image";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import Link from "next/link";
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  query,
  type QueryConstraint,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CACHE_TTL } from "@/lib/cache/ttl";

type ProfileGroupsTabProps = {
  profileUid: string;
  isOwner: boolean;
  isViewerLoggedIn: boolean;
  canViewerSeeGroups: boolean;
  groupsVisibleToVisitors: boolean;
  onGroupsVisibilityChanged?: (value: boolean) => void;
  /**
   * Va en el MISMO renglon que el titulo, a su derecha. Lo usa el perfil ajeno
   * para el enlace de volver a publicaciones: suelto encima quedaba despegado,
   * y aqui se lee como la accion de esta seccion.
   */
  titleAction?: ReactNode;
};

type GroupListItem = {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  visibility?: "public" | "private" | "hidden";
  isActive?: boolean;
  memberCount?: number;
};

// Module-level cache — survives navigation in the same tab
type GroupsCacheEntry = { groups: GroupListItem[]; cachedAt: number };
const groupsCache = new Map<string, GroupsCacheEntry>();
const GROUPS_CACHE_TTL_MS = CACHE_TTL.CATALOGO;

function peekGroups(key: string): GroupListItem[] | null {
  const e = groupsCache.get(key);
  if (!e || Date.now() - e.cachedAt > GROUPS_CACHE_TTL_MS) return null;
  return e.groups;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

function getVisibilityKey(
  visibility?: "public" | "private" | "hidden"
): "privateLabel" | "hiddenLabel" | "publicLabel" {
  if (visibility === "private") return "privateLabel";
  if (visibility === "hidden") return "hiddenLabel";
  return "publicLabel";
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
      aria-label={label}
      title={label}
      style={{
        position: "relative",
        width: 36,
        minWidth: 36,
        maxWidth: 36,
        height: 20,
        minHeight: 20,
        maxHeight: 20,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.18)",
        background: checked
          ? "linear-gradient(100deg, #a855f7, #4f46ff)"
          : "rgba(255,255,255,0.10)",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.2s ease",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          insetInlineStart: checked ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "all 0.2s ease",
        }}
      />
    </button>
  );
}

export default function ProfileGroupsTab({
  profileUid,
  isOwner,
  isViewerLoggedIn,
  canViewerSeeGroups,
  groupsVisibleToVisitors,
  onGroupsVisibilityChanged,
  titleAction,
}: ProfileGroupsTabProps) {
  const tGroups = useTranslations("groups");
  const tProfile = useTranslations("profile");
  const cacheKey = `${profileUid}:${isOwner}`;
  const [groups, setGroups] = useState<GroupListItem[]>(() => peekGroups(cacheKey) ?? []);
  const [loading, setLoading] = useState<boolean>(() => !peekGroups(cacheKey));
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();

  const fontStack =
    'inherit';

  // Con `titleAction` (perfil ajeno) esta seccion arranca mas abajo para que el
  // enlace del titulo caiga a la MISMA altura que el "Ver sus comunidades" de la
  // otra pestana, y alternar entre las dos no mueva nada de sitio.
  //
  // La cuenta, desde el inicio del panel:
  //   publicaciones -> subnav de medios 38px + 12 de margen, menos los 6 que
  //                    el enlace sube con su marginTop negativo = 44px
  //   comunidades   -> los 12 de siempre
  // Faltan 32, que es lo que se suma aqui.
  const wrapStyle: CSSProperties = {
    marginTop: titleAction ? 44 : 12,
    border: "none",
    background: "transparent",
    boxShadow: "none",
    padding: 0,
    color: "#fff",
    fontFamily: fontStack,
    overflow: "hidden",
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!profileUid) {
        setGroups([]);
        setMsg(tProfile("invalidProfile"));
        setLoading(false);
        return;
      }

      if (!isOwner && !isViewerLoggedIn) {
        setGroups([]);
        setMsg(tGroups("loginRequired"));
        setLoading(false);
        return;
      }

      if (!isOwner && !canViewerSeeGroups) {
        setGroups([]);
        setMsg(tGroups("profileHidden"));
        setLoading(false);
        return;
      }

      // Cache fresco (dentro del TTL): mostramos lo cacheado y evitamos
      // re-consultar en cada cambio de pestaña, igual que la wallet.
      const cached = peekGroups(cacheKey);
      if (cached) {
        setGroups(cached);
        setMsg(
          cached.length
            ? null
            : isOwner
              ? tGroups("noVisibleOwn")
              : tGroups("noVisibleOther")
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setMsg(null);

      try {
        const constraints: QueryConstraint[] = [
          where("ownerId", "==", profileUid),
          where("isActive", "==", true),
          limit(60),
        ];

        if (!isOwner) {
          constraints.splice(
            1,
            0,
            where("visibility", "in", ["public", "private"])
          );
        }

        const qs = query(collection(db, "groups"), ...constraints);
        const snap = await getDocs(qs);

        if (cancelled) return;

        const next: GroupListItem[] = snap.docs
          .map((d) => {
            const data = d.data() as { name?: unknown; description?: unknown; avatarUrl?: unknown; coverUrl?: unknown; visibility?: unknown; isActive?: unknown; memberCount?: unknown };
            return {
              id: d.id,
              name: String(data?.name ?? ""),
              description:
                typeof data?.description === "string" ? data.description : "",
              avatarUrl:
                typeof data?.avatarUrl === "string" ? data.avatarUrl : null,
              coverUrl:
                typeof data?.coverUrl === "string" ? data.coverUrl : null,
              visibility: (data?.visibility === "public" || data?.visibility === "private" || data?.visibility === "hidden") ? (data.visibility as "public" | "private" | "hidden") : undefined,
              isActive: Boolean(data?.isActive),
              memberCount:
                typeof data?.memberCount === "number"
                  ? data.memberCount
                  : undefined,
            };
          })
          .filter((g) => !!g.name && (isOwner || g.visibility !== "hidden"))
          .sort((a, b) => a.name.localeCompare(b.name, "es"));

        // Conteo real de miembros por comunidad (subcolección members).
        await Promise.all(
          next.map(async (g) => {
            // El contador lo lleva el SERVIDOR en `membersCount`, y ese campo es de
            // lectura pública. Contar la subcolección al vuelo pasa por las reglas
            // de lectura, así que en una comunidad privada donde no eres miembro
            // fallaba, y además gastaba una consulta por comunidad.
            const fromDoc = (g as { membersCount?: unknown }).membersCount;
            if (typeof fromDoc === "number" && fromDoc >= 0) {
              g.memberCount = fromDoc;
              return;
            }
            try {
              const countSnap = await getCountFromServer(
                collection(db, "groups", g.id, "members")
              );
              g.memberCount = countSnap.data().count;
            } catch {
              // Si falla el conteo, dejamos memberCount como venía del doc.
            }
          })
        );

        if (cancelled) return;

        groupsCache.set(cacheKey, { groups: next, cachedAt: Date.now() });
        setGroups(next);

        if (!next.length) {
          setMsg(
            isOwner
              ? tGroups("noVisibleOwn")
              : tGroups("noVisibleOther")
          );
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setMsg((e instanceof Error ? e.message : null) ?? tGroups("loadError"));
        setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [profileUid, isOwner, isViewerLoggedIn, canViewerSeeGroups]);

  async function toggleGroupsVisibility(nextValue: boolean) {
    if (!isOwner || !profileUid || savingVisibility) return;

    try {
      setSavingVisibility(true);
      setMsg(null);

      await updateDoc(doc(db, "users", profileUid), {
        showCreatedGroups: nextValue,
      });

      onGroupsVisibilityChanged?.(nextValue);
      showToast(
        nextValue
          ? tGroups("visibilityEnabled")
          : tGroups("visibilityDisabled"),
        "success"
      );
    } catch (e: unknown) {
      showToast(
        tGroups("visibilityError"),
        "error"
      );
    } finally {
      setSavingVisibility(false);
    }
  }

  const title = useMemo(() => {
    return isOwner ? tGroups("myGroups") : tGroups("theirCommunities");
  }, [isOwner, tGroups]);

  return (
    <section style={wrapStyle}>
      <style jsx>{`
        /* Tres columnas en laptop pase lo que pase con el ancho: las columnas se
           encogen, no se reducen de numero. La separacion es minima —3px— y vale
           tanto entre columnas como entre filas, asi que tambien es el margen
           inferior de cada una.

           La fila incompleta queda pegada al inicio sola: una o dos comunidades
           caen en las primeras columnas y la tarjeta ya no se centra en su celda
           (ver el margin de .profile-group-card).

           OJO: aqui NO va justify-items: start. Con eso el item se mide por su
           contenido, la tarjeta de dentro pide width 100% del item, y la
           referencia circular se resuelve a cero: las comunidades desaparecen. */
        .profile-groups-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 3px;
          align-items: start;
          width: 100%;
          max-width: calc((320px * 3) + (3px * 2));
          margin: 0 auto;
        }

        .profile-group-link {
          display: block;
          width: 100%;
          text-decoration: none;
          color: inherit;
          min-width: 0;
        }

        .profile-group-card {
          position: relative;
          width: 100%;
          max-width: 320px;
          /* Sin auto: centraba la tarjeta dentro de su celda, y con la fila
             incompleta eso la separaba del inicio. Es lo que alinea las filas
             de una o dos comunidades. */
          margin: 0;
          aspect-ratio: 1 / 1;
          border: none;
          background: #0d0d0f;
          border-radius: 0;
          overflow: hidden;
          /* Sin sombra: con 3px de separacion, un difuminado de 48px se derrama
             sobre la tarjeta de al lado y ensucia la retícula. La sombra tenia
             sentido cuando las tarjetas iban sueltas y redondeadas. */
          box-shadow: none;
          min-width: 0;
        }

        .profile-groups-visibility-card {
          margin-top: 14px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "title switch"
            "desc desc";
          column-gap: 16px;
          row-gap: 8px;
          padding: 14px 0;
          border-radius: 14px;
          border: none;
          background: transparent;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          overflow: hidden;
        }

        .profile-groups-visibility-title {
          grid-area: title;
          min-width: 0;
        }

        .profile-groups-visibility-description {
          grid-area: desc;
          min-width: 0;
        }

        .profile-groups-visibility-switch {
          grid-area: switch;
          width: 40px;
          minWidth: 40px;
          maxWidth: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          align-self: start;
          justify-self: end;
          flex-shrink: 0;
        }

        @media (max-width: 767px) {
          .profile-groups-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            max-width: 100%;
          }

          .profile-group-card {
            max-width: 100%;
          }
        }

        @media (max-width: 640px) {
          .profile-groups-visibility-card {
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
              "title switch"
              "desc desc";
          }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.25; }
        }
      `}</style>

      <div
        style={{
          display: "grid",
          gap: 14,
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minWidth: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                lineHeight: 1.2,
                minWidth: 0,
              }}
            >
              {title}
            </h2>

            {titleAction}
          </div>

          {isOwner && (
            <div className="profile-groups-visibility-card">
              <div
                className="profile-groups-visibility-title"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#fff",
                  lineHeight: 1.2,
                }}
              >
                {tGroups("showMyCommunities")}
              </div>

              <div className="profile-groups-visibility-switch">
                <Switch
                  checked={groupsVisibleToVisitors}
                  onChange={toggleGroupsVisibility}
                  disabled={savingVisibility}
                  label={tGroups("showMyCommunities")}
                />
              </div>

              <div
                className="profile-groups-visibility-description"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.70)",
                }}
              >
                <svg
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  style={{ flexShrink: 0, marginTop: 1 }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="#a855f7"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="8" r="1.25" fill="#a855f7" />
                  <path
                    d="M12 11.25v5"
                    stroke="#a855f7"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <span>{tGroups("visibilityToggleHint")}</span>
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="profile-groups-grid">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="profile-group-card"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
                  animation: "pulse 1.6s ease-in-out infinite",
                  maxWidth: 320,
                }}
                aria-hidden="true"
              />
            ))}
          </div>
        ) : msg && !groups.length ? (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.6)",
              textAlign: "center",
              marginTop: 48,
            }}
          >
            {msg}
          </div>
        ) : (
          <div className="profile-groups-grid">
            {msg && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.72)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                {msg}
              </div>
            )}

            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="profile-group-link"
              >
                <article className="profile-group-card">
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: group.coverUrl
                        ? `url(${group.coverUrl}) center / cover no-repeat`
                        : "linear-gradient(135deg, #111214 0%, #1b1d21 55%, #101113 100%)",
                      transform: "scale(1.01)",
                    }}
                  />

                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.44) 45%, rgba(0,0,0,0.88) 78%, rgba(0,0,0,0.96) 100%)",
                    }}
                  />

                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      textAlign: "center",
                    }}
                  >
                    <div />

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        minHeight: "48%",
                      }}
                    >
                      <div
                        style={{
                          width: 84,
                          height: 84,
                          minWidth: 84,
                          minHeight: 84,
                          borderRadius: "50%",
                          overflow: "hidden",
                          background: "#111",
                          boxShadow: "0 10px 24px rgba(0,0,0,0.40)",
                          display: "grid",
                          placeItems: "center",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 22,
                          flexShrink: 0,
                        }}
                      >
                        {group.avatarUrl ? (
                          <Image
                            src={group.avatarUrl}
                            alt={group.name}
                            width={84} height={84}
                            style={{
                              display: "block",
                              borderRadius: "50%",
                              objectFit: "cover",
                              objectPosition: "center",
                            }}
                          />
                        ) : (
                          initials(group.name)
                        )}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: 6,
                          width: "100%",
                          justifyItems: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            color: "#fff",
                            maxWidth: "100%",
                            wordBreak: "break-word",
                          }}
                        >
                          {group.name}
                        </div>

                        <div
                          style={{
                            fontSize: 13,
                            lineHeight: 1.25,
                            color: "rgba(255,255,255,0.78)",
                          }}
                        >
                          {tGroups(getVisibilityKey(group.visibility))}
                        </div>

                        {typeof group.memberCount === "number" && (
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              lineHeight: 1.2,
                              color: "rgba(255,255,255,0.85)",
                            }}
                          >
                            {group.memberCount}{" "}
                            {group.memberCount === 1
                              ? tGroups("member")
                              : tGroups("members")}
                          </div>
                        )}

                      </div>
                    </div>

                    <div />
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
      <VibraToast toast={toast} />
    </section>
  );
}