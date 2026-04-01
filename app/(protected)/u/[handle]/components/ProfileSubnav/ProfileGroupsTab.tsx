"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type ProfileGroupsTabProps = {
  profileUid: string;
  isOwner: boolean;
  isViewerLoggedIn: boolean;
  canViewerSeeGroups: boolean;
  groupsVisibleToVisitors: boolean;
  onGroupsVisibilityChanged?: (value: boolean) => void;
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

function getVisibilityLabel(
  visibility?: "public" | "private" | "hidden"
): string {
  if (visibility === "private") return "Comunidad privada";
  if (visibility === "hidden") return "Comunidad oculta";
  return "Comunidad pública";
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
        width: 40,
        minWidth: 40,
        maxWidth: 40,
        height: 22,
        minHeight: 22,
        maxHeight: 22,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 160ms ease",
        flexShrink: 0,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          width: 16,
          minWidth: 16,
          maxWidth: 16,
          height: 16,
          minHeight: 16,
          maxHeight: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
          flexShrink: 0,
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
}: ProfileGroupsTabProps) {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const wrapStyle: CSSProperties = {
    marginTop: 12,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    backdropFilter: "blur(10px)",
    padding: 16,
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
        setMsg("Perfil inválido.");
        setLoading(false);
        return;
      }

      if (!isOwner && !isViewerLoggedIn) {
        setGroups([]);
        setMsg("Para ver comunidades debes iniciar sesión.");
        setLoading(false);
        return;
      }

      if (!isOwner && !canViewerSeeGroups) {
        setGroups([]);
        setMsg("Este perfil no muestra sus comunidades.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setMsg(null);

      try {
        const constraints: any[] = [
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
            const data = d.data() as any;
            return {
              id: d.id,
              name: String(data?.name ?? ""),
              description:
                typeof data?.description === "string" ? data.description : "",
              avatarUrl:
                typeof data?.avatarUrl === "string" ? data.avatarUrl : null,
              coverUrl:
                typeof data?.coverUrl === "string" ? data.coverUrl : null,
              visibility: data?.visibility,
              isActive: Boolean(data?.isActive),
              memberCount:
                typeof data?.memberCount === "number"
                  ? data.memberCount
                  : undefined,
            };
          })
          .filter((g) => !!g.name && (isOwner || g.visibility !== "hidden"))
          .sort((a, b) => a.name.localeCompare(b.name, "es"));

        setGroups(next);

        if (!next.length) {
          setMsg(
            isOwner
              ? "Todavía no has creado comunidades visibles aquí."
              : "Este perfil todavía no tiene comunidades visibles."
          );
        }
      } catch (e: any) {
        if (cancelled) return;
        setMsg(e?.message ?? "No se pudieron cargar las comunidades.");
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
      setMsg(
        nextValue
          ? "✅ Ahora los visitantes pueden ver tus comunidades."
          : "✅ Tus comunidades ya no se muestran a visitantes."
      );
    } catch (e: any) {
      setMsg(
        e?.message ?? "❌ No se pudo actualizar la visibilidad de tus comunidades."
      );
    } finally {
      setSavingVisibility(false);
    }
  }

  const title = useMemo(() => {
    return isOwner ? "Mis comunidades" : "Sus comunidades";
  }, [isOwner]);

  return (
    <section style={wrapStyle}>
      <style jsx>{`
        .profile-groups-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
          gap: 16px;
          align-items: start;
          width: 100%;
          max-width: calc((320px * 3) + (16px * 2));
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
          margin: 0 auto;
          aspect-ratio: 1 / 1;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: #0d0d0f;
          border-radius: 22px;
          overflow: hidden;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
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
          padding: 14px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.03);
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
      `}</style>

      <div
        style={{
          display: "grid",
          gap: 14,
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {title}
          </h2>

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
                Mostrar mis comunidades creadas
              </div>

              <div className="profile-groups-visibility-switch">
                <Switch
                  checked={groupsVisibleToVisitors}
                  onChange={toggleGroupsVisibility}
                  disabled={savingVisibility}
                  label="Mostrar mis comunidades creadas"
                />
              </div>

              <div
                className="profile-groups-visibility-description"
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.70)",
                }}
              >
                Actívalo para que los visitantes puedan ver las comunidades que has
                creado. Los ocultos NUNCA se mostrarán.
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            Cargando comunidades...
          </div>
        ) : msg && !groups.length ? (
          <div
            style={{
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
                          border: "3px solid rgba(0,0,0,0.92)",
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
                          <img
                            src={group.avatarUrl}
                            alt={group.name}
                            style={{
                              display: "block",
                              width: "100%",
                              height: "100%",
                              minWidth: "100%",
                              minHeight: "100%",
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
                            fontWeight: 700,
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
                          {getVisibilityLabel(group.visibility)}
                        </div>
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
    </section>
  );
}