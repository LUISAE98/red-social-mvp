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

export default function ProfileGroupsTab({
  profileUid,
  isOwner,
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

      if (!isOwner && !canViewerSeeGroups) {
        setGroups([]);
        setMsg("Este perfil no muestra sus grupos.");
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
              ? "Todavía no has creado grupos visibles aquí."
              : "Este perfil todavía no tiene grupos visibles."
          );
        }
      } catch (e: any) {
        if (cancelled) return;
        setMsg(e?.message ?? "No se pudieron cargar los grupos.");
        setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [profileUid, isOwner, canViewerSeeGroups]);

  async function toggleGroupsVisibility() {
    if (!isOwner || !profileUid || savingVisibility) return;

    const nextValue = !groupsVisibleToVisitors;

    try {
      setSavingVisibility(true);
      setMsg(null);

      await updateDoc(doc(db, "users", profileUid), {
        showCreatedGroups: nextValue,
      });

      onGroupsVisibilityChanged?.(nextValue);
      setMsg(
        nextValue
          ? "✅ Ahora los visitantes pueden ver tus grupos."
          : "✅ Tus grupos ya no se muestran a visitantes."
      );
    } catch (e: any) {
      setMsg(
        e?.message ?? "❌ No se pudo actualizar la visibilidad de tus grupos."
      );
    } finally {
      setSavingVisibility(false);
    }
  }

  const title = useMemo(() => {
    return isOwner ? "Mis grupos" : "Sus grupos";
  }, [isOwner]);

  return (
    <section style={wrapStyle}>
      <div
        style={{
          display: "grid",
          gap: 14,
        }}
      >
        <div>
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
            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: 14,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#fff",
                    lineHeight: 1.2,
                  }}
                >
                  Mostrar mis grupos creados
                </div>

                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "rgba(255,255,255,0.70)",
                  }}
                >
                  Actívalo para que los visitantes puedan ver los grupos que has
                  creado. Los ocultos NUNCA se mostrarán.
                </div>
              </div>

              <button
                type="button"
                onClick={toggleGroupsVisibility}
                disabled={savingVisibility}
                style={{
                  position: "relative",
                  width: 56,
                  height: 32,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: groupsVisibleToVisitors
                    ? "#fff"
                    : "rgba(255,255,255,0.14)",
                  cursor: savingVisibility ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                  flexShrink: 0,
                  opacity: savingVisibility ? 0.7 : 1,
                }}
                aria-pressed={groupsVisibleToVisitors}
                aria-label="Mostrar mis grupos creados"
                title="Mostrar mis grupos creados"
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: groupsVisibleToVisitors ? 27 : 3,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: groupsVisibleToVisitors ? "#000" : "#fff",
                    transition: "all 0.2s ease",
                  }}
                />
              </button>
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
            Cargando grupos...
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
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
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                <article
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "1 / 1",
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "#0d0d0f",
                    borderRadius: 22,
                    overflow: "hidden",
                    boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
                  }}
                >
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
                      padding: 18,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        width: 112,
                        height: 112,
                        borderRadius: "50%",
                        overflow: "hidden",
                        background: "#111",
                        border: "4px solid rgba(0,0,0,0.92)",
                        boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
                        display: "grid",
                        placeItems: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 28,
                        marginBottom: 14,
                      }}
                    >
                      {group.avatarUrl ? (
                        <img
                          src={group.avatarUrl}
                          alt={group.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        initials(group.name)
                      )}
                    </div>

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

                    {!!group.description && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 13,
                          lineHeight: 1.45,
                          color: "rgba(255,255,255,0.84)",
                          maxWidth: "100%",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                        }}
                      >
                        {group.description}
                      </div>
                    )}

                    <div
                      style={{
                        marginTop: 12,
                        fontSize: 13,
                        lineHeight: 1.25,
                        color: "rgba(255,255,255,0.78)",
                      }}
                    >
                      {group.visibility === "private"
                        ? "Comunidad privada"
                        : group.visibility === "hidden"
                        ? "Comunidad oculta"
                        : "Comunidad pública"}
                    </div>

                    {typeof group.memberCount === "number" && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          lineHeight: 1.2,
                          color: "rgba(255,255,255,0.62)",
                        }}
                      >
                        {group.memberCount} integrantes
                      </div>
                    )}
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