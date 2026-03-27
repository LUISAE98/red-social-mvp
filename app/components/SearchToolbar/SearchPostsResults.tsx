"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";

import type { Comment, Post } from "@/lib/posts/types";
import {
  createPostComment,
  deletePostComment,
  fetchGroupPosts,
  fetchPostComments,
  softDeletePost,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";

type SearchPostsResultsProps = {
  fontStack: string;
  search: string;
  currentUser: User | null;
  onNavigate: (href: string) => void;
};

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;
type GroupRole = "owner" | "mod" | "member" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
};

function normalizeRole(raw: unknown): GroupRole {
  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

function normalizeStatus(raw: unknown): MemberStatus {
  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "removed" || raw === "kicked" || raw === "expelled") {
    return "removed";
  }
  if (raw === "active") return "active";
  return "active";
}

function getTimestampMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;

  const candidate = value as any;

  if (typeof candidate.toMillis === "function") {
    return candidate.toMillis();
  }

  if (typeof candidate.toDate === "function") {
    return candidate.toDate().getTime();
  }

  if (typeof candidate.seconds === "number") {
    return candidate.seconds * 1000;
  }

  return 0;
}

function getStartOfDayMs(dateValue: string): number | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T00:00:00`);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getEndOfDayMs(dateValue: string): number | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T23:59:59.999`);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

async function getMembershipMetaForGroup(groupId: string, userId: string) {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null, role: null };
    }

    const data = memberSnap.data() as any;

    return {
      status: normalizeStatus(data?.status),
      mutedUntil: data?.mutedUntil ?? null,
      role: normalizeRole(data?.roleInGroup ?? data?.role),
    };
  } catch {
    return { status: null, mutedUntil: null, role: null };
  }
}

async function getViewerCanModerateGroup(groupId: string, userId: string) {
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) return false;

    const data = groupSnap.data() as any;

    if (data?.ownerId === userId) return true;

    const viewerMeta = await getMembershipMetaForGroup(groupId, userId);

    return (
      viewerMeta.role === "mod" &&
      viewerMeta.status !== "banned" &&
      viewerMeta.status !== "removed"
    );
  } catch {
    return false;
  }
}

async function filterOutBlockedPosts(posts: Post[], userId: string) {
  if (!posts.length) return posts;

  const uniqueGroupIds = Array.from(
    new Set(posts.map((p) => p.groupId).filter(Boolean))
  );

  const entries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const meta = await getMembershipMetaForGroup(groupId, userId);
      return [groupId, meta.status] as const;
    })
  );

  const map = new Map(entries);

  return posts.filter((post) => {
    const status = map.get(post.groupId) ?? null;
    return status !== "banned" && status !== "removed";
  });
}

async function attachModerationFlags(posts: Post[], userId: string) {
  const groupIds = Array.from(
    new Set(posts.map((p) => p.groupId).filter(Boolean))
  );

  const modEntries = await Promise.all(
    groupIds.map(
      async (g) => [g, await getViewerCanModerateGroup(g, userId)] as const
    )
  );

  const modMap = new Map(modEntries);

  return posts.map((post) => ({
    ...post,
    canModerateGroupAuthor: modMap.get(post.groupId) === true,
  }));
}

async function fetchAccessibleGroupIds(user: User | null) {
  const publicSnap = await getDocs(
    query(collection(db, "groups"), where("visibility", "==", "public"))
  );

  const publicIds = publicSnap.docs.map((d) => d.id);

  if (!user?.uid) return publicIds;

  const ownedSnap = await getDocs(
    query(collection(db, "groups"), where("ownerId", "==", user.uid))
  );

  const ownedIds = ownedSnap.docs.map((d) => d.id);

  const hidden = await getMyHiddenJoinedGroups();

  const hiddenIds = hidden.map((g) => g.id);

  return Array.from(new Set([...publicIds, ...ownedIds, ...hiddenIds]));
}

async function fetchSearchPosts(user: User | null) {
  const groupIds = await fetchAccessibleGroupIds(user);

  const groupsPosts = await Promise.all(
    groupIds.map(async (groupId) => {
      try {
        return await fetchGroupPosts(groupId);
      } catch {
        return [];
      }
    })
  );

  const all = groupsPosts.flat();

  const deduped = Array.from(new Map(all.map((p) => [p.id, p])).values());

  deduped.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));

  return deduped;
}

export default function SearchPostsResults({
  fontStack,
  search,
  currentUser,
}: SearchPostsResultsProps) {
  const userId = currentUser?.uid ?? null;

  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtersPanelRef = useRef<HTMLDivElement | null>(null);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!filtersPanelRef.current) return;
      if (!filtersPanelRef.current.contains(event.target as Node)) {
        setIsFiltersOpen(false);
      }
    }

    if (isFiltersOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFiltersOpen]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!normalizedSearch) {
        setPosts([]);
        setLoading(false);
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const raw = await fetchSearchPosts(currentUser);

        const filtered = raw.filter((p) =>
          (p.text ?? "").toLowerCase().includes(normalizedSearch)
        );

        let finalPosts: PostWithFlags[] = filtered;

        if (userId) {
          const visible = await filterOutBlockedPosts(filtered, userId);
          finalPosts = await attachModerationFlags(visible, userId);
        }

        if (!active) return;
        setPosts(finalPosts.slice(0, 60));
      } catch (e: any) {
        if (!active) return;
        setError(e?.message ?? "Error");
      } finally {
        if (active) setLoading(false);
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [normalizedSearch, currentUser, userId]);

  async function handleDeletePost(postId: string) {
    await softDeletePost(postId);
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    return await fetchPostComments(postId);
  }

  async function handleCreateComment(postId: string, text: string) {
    await createPostComment({ postId, text });
    return await fetchPostComments(postId);
  }

  async function handleDeleteComment(postId: string, commentId: string) {
    await deletePostComment({ postId, commentId });
    return await fetchPostComments(postId);
  }

  function clearDateFilters() {
    setFromDate("");
    setToDate("");
  }

  function matchesDateRange(post: PostWithFlags) {
    if (!fromDate && !toDate) return true;

    const createdAtMs = getTimestampMs(post.createdAt);
    if (!createdAtMs) return false;

    const fromMs = getStartOfDayMs(fromDate);
    const toMs = getEndOfDayMs(toDate);

    if (fromMs !== null && createdAtMs < fromMs) return false;
    if (toMs !== null && createdAtMs > toMs) return false;

    return true;
  }

  const filteredPosts = useMemo(() => {
    return posts.filter(matchesDateRange);
  }, [posts, fromDate, toDate]);

  const activeFilters = [
    ...(fromDate
      ? [
          {
            key: "fromDate",
            label: `Desde: ${fromDate}`,
            onRemove: () => setFromDate(""),
          },
        ]
      : []),
    ...(toDate
      ? [
          {
            key: "toDate",
            label: `Hasta: ${toDate}`,
            onRemove: () => setToDate(""),
          },
        ]
      : []),
  ];

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    display: "grid",
    gap: 12,
    marginBottom: 18,
    overflowX: "hidden",
  };

  const topBarStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "start",
    position: "relative",
  };

  const activeFiltersWrapStyle: CSSProperties = {
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "0 2px",
  };

  const activeFilterPillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const activeFilterRemoveStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.72)",
    cursor: "pointer",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
  };

  const filtersButtonStyle: CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12.5,
    fontFamily: fontStack,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
  };

  const filtersPanelStyle: CSSProperties = {
    position: "absolute",
    top: 44,
    right: 0,
    width: 280,
    maxWidth: "calc(100vw - 24px)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10,10,10,0.98)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
    padding: 12,
    display: "grid",
    gap: 12,
    zIndex: 20,
    backdropFilter: "blur(12px)",
  };

  const filterBlockStyle: CSSProperties = {
    display: "grid",
    gap: 8,
  };

  const filterBlockTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.52)",
  };

  const dateFieldWrapStyle: CSSProperties = {
    display: "grid",
    gap: 6,
  };

  const dateLabelStyle: CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.74)",
    fontWeight: 600,
  };

  const dateInputStyle: CSSProperties = {
    width: "100%",
    minHeight: 38,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 13,
    fontFamily: fontStack,
    outline: "none",
  };

  const filterActionsRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 4,
  };

  const filterActionSecondaryStyle: CSSProperties = {
    flex: 1,
    minHeight: 34,
    padding: "7px 10px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontStack,
  };

  const filterActionPrimaryStyle: CSSProperties = {
    ...filterActionSecondaryStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.20)",
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  if (loading) {
    return <div>Buscando publicaciones...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  if (!normalizedSearch) {
    return <div>Escribe algo para buscar</div>;
  }

  return (
    <section style={shellStyle}>
      <div style={topBarStyle} className="search-posts-topbar">
        <div style={activeFiltersWrapStyle}>
          {activeFilters.length > 0
            ? activeFilters.map((filter) => (
                <span key={filter.key} style={activeFilterPillStyle}>
                  {filter.label}
                  <button
                    type="button"
                    style={activeFilterRemoveStyle}
                    onClick={filter.onRemove}
                    aria-label={`Quitar filtro ${filter.label}`}
                  >
                    ×
                  </button>
                </span>
              ))
            : null}
        </div>

        <div ref={filtersPanelRef} className="search-posts-filters-anchor">
          <button
            type="button"
            style={filtersButtonStyle}
            onClick={() => setIsFiltersOpen((prev) => !prev)}
          >
            <span aria-hidden="true">☰</span>
            Filtros
          </button>

          {isFiltersOpen && (
            <div style={filtersPanelStyle} className="search-posts-filters-panel">
              <div style={filterBlockStyle}>
                <p style={filterBlockTitleStyle}>Fecha</p>

                <div style={dateFieldWrapStyle}>
                  <label htmlFor="posts-filter-from" style={dateLabelStyle}>
                    Desde
                  </label>
                  <input
                    id="posts-filter-from"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={dateInputStyle}
                    max={toDate || undefined}
                  />
                </div>

                <div style={dateFieldWrapStyle}>
                  <label htmlFor="posts-filter-to" style={dateLabelStyle}>
                    Hasta
                  </label>
                  <input
                    id="posts-filter-to"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    style={dateInputStyle}
                    min={fromDate || undefined}
                  />
                </div>
              </div>

              <div style={filterActionsRowStyle}>
                <button
                  type="button"
                  style={filterActionSecondaryStyle}
                  onClick={clearDateFilters}
                >
                  Limpiar
                </button>

                <button
                  type="button"
                  style={filterActionPrimaryStyle}
                  onClick={() => setIsFiltersOpen(false)}
                >
                  Listo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {filteredPosts.length === 0 ? (
        <div style={emptyStyle}>
          No se encontraron publicaciones con los filtros seleccionados.
        </div>
      ) : (
        filteredPosts.map((post) => {
          const canDelete =
            userId === post.authorId ||
            post.canModerateGroupAuthor === true;

          return (
            <div key={post.id} style={postItemStyle}>
              <GroupPostCard
                post={post}
                canDelete={canDelete}
                onDelete={canDelete ? handleDeletePost : undefined}
                onLoadComments={handleLoadComments}
                onCreateComment={handleCreateComment}
                onDeleteComment={handleDeleteComment}
                currentUserId={userId}
                isOwner={false}
                isModerator={post.canModerateGroupAuthor === true}
                showGroupContext={true}
                canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              />
            </div>
          );
        })
      )}

      <style jsx>{`
        .search-posts-filters-anchor {
          position: relative;
        }

        @media (max-width: 768px) {
          .search-posts-topbar {
            grid-template-columns: minmax(0, 1fr);
          }

          .search-posts-filters-anchor {
            width: 100%;
          }

          .search-posts-filters-anchor button {
            width: 100%;
            justify-content: center;
          }

          .search-posts-filters-panel {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin-top: 10px;
          }
        }
      `}</style>
    </section>
  );
}