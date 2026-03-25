"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";

type SearchPostsResultsProps = {
  fontStack: string;
  search: string;
  currentUser: User | null;
  onNavigate: (href: string) => void;
};

type GroupVisibility = "public" | "private" | "hidden";

type SearchPost = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorUsername: string | null;
  groupId: string;
  groupName: string | null;
  groupAvatarUrl: string | null;
  groupVisibility: GroupVisibility | null;
  createdAt?: {
    toDate?: () => Date;
    toMillis?: () => number;
  } | null;
};

type GroupMeta = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  visibility: GroupVisibility | null;
  ownerId: string | null;
};

type UserMeta = {
  displayName: string | null;
  avatarUrl: string | null;
  username: string | null;
};

type CanonicalMemberStatus =
  | "active"
  | "muted"
  | "banned"
  | "removed"
  | null;

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeVisibility(value: unknown): GroupVisibility | null {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }
  return null;
}

function normalizeMemberStatus(raw: unknown): CanonicalMemberStatus {
  if (raw === "active") return "active";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";
  return null;
}

function isReadableMemberStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "muted";
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "P";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function formatDate(value?: { toDate?: () => Date } | null) {
  if (!value?.toDate) return "Ahora mismo";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value.toDate());
  } catch {
    return "Fecha no disponible";
  }
}

async function fetchPublicGroupIds(): Promise<string[]> {
  const snap = await getDocs(
    query(collection(db, "groups"), where("visibility", "==", "public"))
  );

  return snap.docs.map((docSnap) => docSnap.id);
}

async function fetchOwnedGroupIds(userUid: string): Promise<string[]> {
  const snap = await getDocs(
    query(collection(db, "groups"), where("ownerId", "==", userUid))
  );

  return snap.docs.map((docSnap) => docSnap.id);
}

async function fetchMemberGroupIds(userUid: string): Promise<string[]> {
  const groupsCol = collection(db, "groups");

  const [publicSnap, privateSnap] = await Promise.all([
    getDocs(query(groupsCol, where("visibility", "==", "public"))),
    getDocs(query(groupsCol, where("visibility", "==", "private"))),
  ]);

  const groups = [
    ...publicSnap.docs.map((d) => d.id),
    ...privateSnap.docs.map((d) => d.id),
  ];

  const dedupedGroupIds = Array.from(new Set(groups));

  const checks = await Promise.all(
    dedupedGroupIds.map(async (groupId) => {
      try {
        const memberSnap = await getDoc(doc(db, "groups", groupId, "members", userUid));

        if (!memberSnap.exists()) return null;

        const data = memberSnap.data() as Record<string, unknown>;
        const status = normalizeMemberStatus(data.status);

        return isReadableMemberStatus(status) ? groupId : null;
      } catch {
        return null;
      }
    })
  );

  return checks.filter((value): value is string => !!value);
}

async function fetchHiddenJoinedGroupIds(userUid: string): Promise<string[]> {
  try {
    if (!userUid.trim()) return [];

    const rows = await getMyHiddenJoinedGroups();

    return rows
      .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchAccessibleGroupIds(user: User | null): Promise<string[]> {
  const publicIds = await fetchPublicGroupIds();

  if (!user?.uid) {
    return Array.from(new Set(publicIds));
  }

  const [ownedIds, memberIds, hiddenIds] = await Promise.all([
    fetchOwnedGroupIds(user.uid),
    fetchMemberGroupIds(user.uid),
    fetchHiddenJoinedGroupIds(user.uid),
  ]);

  return Array.from(new Set([...publicIds, ...ownedIds, ...memberIds, ...hiddenIds]));
}

async function fetchGroupsByIds(groupIds: string[]): Promise<Record<string, GroupMeta>> {
  const uniqueIds = Array.from(new Set(groupIds.filter(Boolean)));

  const entries = await Promise.all(
    uniqueIds.map(async (groupId) => {
      try {
        const snap = await getDoc(doc(db, "groups", groupId));
        if (!snap.exists()) {
          return [
            groupId,
            {
              id: groupId,
              name: null,
              avatarUrl: null,
              visibility: null,
              ownerId: null,
            },
          ] as const;
        }

        const data = snap.data() as Record<string, unknown>;

        return [
          groupId,
          {
            id: groupId,
            name:
              pickString(data.name) ||
              pickString(data.title) ||
              pickString(data.groupName),
            avatarUrl:
              pickString(data.avatarUrl) ||
              pickString(data.photoURL) ||
              pickString(data.groupAvatarUrl),
            visibility: normalizeVisibility(data.visibility),
            ownerId: pickString(data.ownerId),
          },
        ] as const;
      } catch {
        return [
          groupId,
          {
            id: groupId,
            name: null,
            avatarUrl: null,
            visibility: null,
            ownerId: null,
          },
        ] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

async function fetchUsersByIds(userIds: string[]): Promise<Record<string, UserMeta>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));

  const entries = await Promise.all(
    uniqueIds.map(async (userId) => {
      try {
        const snap = await getDoc(doc(db, "users", userId));

        if (!snap.exists()) {
          return [
            userId,
            {
              displayName: null,
              avatarUrl: null,
              username: null,
            },
          ] as const;
        }

        const data = snap.data() as Record<string, unknown>;

        return [
          userId,
          {
            displayName:
              pickString(data.displayName) || pickString(data.name),
            avatarUrl:
              pickString(data.avatarUrl) || pickString(data.photoURL),
            username:
              pickString(data.username) || pickString(data.handle),
          },
        ] as const;
      } catch {
        return [
          userId,
          {
            displayName: null,
            avatarUrl: null,
            username: null,
          },
        ] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

async function fetchPostsByGroups(groupIds: string[]): Promise<SearchPost[]> {
  if (groupIds.length === 0) return [];

  const groupsPosts = await Promise.all(
    groupIds.map(async (groupId) => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "posts"),
            where("groupId", "==", groupId),
            where("isDeleted", "==", false),
            orderBy("createdAt", "desc"),
            limit(20)
          )
        );

        return snap.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;

          return {
            id: docSnap.id,
            text: typeof data.text === "string" ? data.text : "",
            authorId: typeof data.authorId === "string" ? data.authorId : "",
            authorName: typeof data.authorName === "string" ? data.authorName : "Usuario",
            authorAvatarUrl:
              typeof data.authorAvatarUrl === "string" ? data.authorAvatarUrl : null,
            authorUsername:
              typeof data.authorUsername === "string" ? data.authorUsername : null,
            groupId: typeof data.groupId === "string" ? data.groupId : groupId,
            groupName: typeof data.groupName === "string" ? data.groupName : null,
            groupAvatarUrl:
              typeof data.groupAvatarUrl === "string" ? data.groupAvatarUrl : null,
            groupVisibility: normalizeVisibility(data.groupVisibility),
            createdAt:
              typeof data.createdAt === "object" ? (data.createdAt as SearchPost["createdAt"]) : null,
          };
        });
      } catch {
        return [] as SearchPost[];
      }
    })
  );

  const all = groupsPosts.flat();

  const deduped = Array.from(new Map(all.map((post) => [post.id, post])).values());

  deduped.sort((a, b) => {
    const aMs = a.createdAt?.toMillis?.() ?? 0;
    const bMs = b.createdAt?.toMillis?.() ?? 0;
    return bMs - aMs;
  });

  return deduped;
}

export default function SearchPostsResults({
  fontStack,
  search,
  currentUser,
  onNavigate,
}: SearchPostsResultsProps) {
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!normalizedSearch) {
        if (active) {
          setPosts([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const accessibleGroupIds = await fetchAccessibleGroupIds(currentUser);
        const rawPosts = await fetchPostsByGroups(accessibleGroupIds);

        const matchingPosts = rawPosts.filter((post) =>
          post.text.toLowerCase().includes(normalizedSearch)
        );

        const groupMap = await fetchGroupsByIds(matchingPosts.map((post) => post.groupId));
        const userMap = await fetchUsersByIds(matchingPosts.map((post) => post.authorId));

        const hydrated = matchingPosts.slice(0, 60).map((post) => {
          const groupMeta = groupMap[post.groupId];
          const userMeta = userMap[post.authorId];

          return {
            ...post,
            authorName:
              userMeta?.displayName || post.authorName || post.authorId || "Usuario",
            authorAvatarUrl: userMeta?.avatarUrl ?? post.authorAvatarUrl ?? null,
            authorUsername: userMeta?.username ?? post.authorUsername ?? null,
            groupName: groupMeta?.name ?? post.groupName ?? "Comunidad",
            groupAvatarUrl: groupMeta?.avatarUrl ?? post.groupAvatarUrl ?? null,
            groupVisibility: groupMeta?.visibility ?? post.groupVisibility ?? null,
          };
        });

        if (!active) return;
        setPosts(hydrated);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message ?? "No se pudieron cargar publicaciones.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [normalizedSearch, currentUser]);

  const shellStyle: CSSProperties = {
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
    display: "grid",
    gap: 12,
  };

  const noticeStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "16px 18px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.5,
  };

  const cardStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.025)",
    padding: 14,
    display: "grid",
    gap: 12,
    cursor: "pointer",
  };

  const headerStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
  };

  const avatarStyle: CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  };

  const fallbackStyle: CSSProperties = {
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 6,
  };

  const authorStyle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 14.5,
    fontWeight: 700,
    lineHeight: 1.2,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const metaStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  };

  const pillStyle: CSSProperties = {
    fontSize: 12,
    padding: "4px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const subtleMetaStyle: CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.3,
  };

  const openButtonStyle: CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const bodyStyle: CSSProperties = {
    margin: 0,
    fontSize: 13.5,
    fontWeight: 300,
    lineHeight: 1.68,
    color: "rgba(255,255,255,0.92)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  if (loading) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>Buscando publicaciones...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>{error}</div>
      </section>
    );
  }

  if (!normalizedSearch) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>
          Escribe una búsqueda para ver publicaciones relacionadas.
        </div>
      </section>
    );
  }

  if (posts.length === 0) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>
          No se encontraron publicaciones con ese texto.
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      {posts.map((post) => {
        const authorDisplayName = post.authorName || "Usuario";
        const groupDisplayName = post.groupName || "Comunidad";

        return (
          <article
            key={post.id}
            style={cardStyle}
            onClick={() => onNavigate(`/groups/${post.groupId}`)}
          >
            <div style={headerStyle}>
              <div style={avatarStyle}>
                {post.authorAvatarUrl ? (
                  <img
                    src={post.authorAvatarUrl}
                    alt={authorDisplayName}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <span style={fallbackStyle}>
                    {initialsFromName(authorDisplayName)}
                  </span>
                )}
              </div>

              <div style={contentStyle}>
                <h3 style={authorStyle}>{authorDisplayName}</h3>

                <div style={metaStyle}>
                  {post.authorUsername && (
                    <span style={pillStyle}>@{post.authorUsername}</span>
                  )}

                  <span style={pillStyle}>{groupDisplayName}</span>

                  <span style={subtleMetaStyle}>
                    {formatDate(post.createdAt)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                style={openButtonStyle}
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(`/groups/${post.groupId}`);
                }}
              >
                Abrir
              </button>
            </div>

            <p style={bodyStyle}>{post.text}</p>
          </article>
        );
      })}
    </section>
  );
}