import { useCallback, useEffect, useRef } from "react";
import { collection, doc, getDoc, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { searchProfiles } from "@/lib/profile/searchProfiles";
import { searchGroups } from "@/lib/groups/searchGroups";
import { subscribeToMySidebarGroups } from "@/lib/groups/sidebarGroups";
import type { MentionSuggestion } from "./types";

const MAX_SUGGESTIONS = 8;
const MAX_FOLLOWING_FETCH = 60;
const MIN_SEARCH_QUERY_LENGTH = 2;

type UseMentionSuggestionsOptions = {
  currentUserId?: string | null;
  /** Cuando es false (ej. post de comunidad oculta) el hook no sugiere nada. */
  enabled: boolean;
};

const DIACRITICS_REGEX = /[̀-ͯ]/g;

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(DIACRITICS_REGEX, "").trim();
}

function matchesQuery(suggestion: MentionSuggestion, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const label = normalize(suggestion.label);
  const handle = suggestion.handle ? normalize(suggestion.handle) : "";
  return (
    label.startsWith(normalizedQuery) ||
    label.includes(normalizedQuery) ||
    handle.startsWith(normalizedQuery)
  );
}

/**
 * Provee las sugerencias del popover de menciones.
 *
 * Orden pedido: primero perfiles que sigo y comunidades a las que pertenezco;
 * después resultados de búsqueda del resto. Las comunidades ocultas nunca se
 * incluyen (se filtran aquí y `searchGroups` ya excluye `hidden`).
 */
export function useMentionSuggestions({
  currentUserId,
  enabled,
}: UseMentionSuggestionsOptions) {
  // Bucket prioritario: perfiles seguidos (carga perezosa una vez) …
  const followedProfilesRef = useRef<MentionSuggestion[] | null>(null);
  const followedLoadingRef = useRef<Promise<MentionSuggestion[]> | null>(null);
  // … y comunidades a las que pertenezco (suscripción viva, sin ocultas).
  const joinedGroupsRef = useRef<MentionSuggestion[]>([]);

  useEffect(() => {
    if (!enabled || !currentUserId) {
      joinedGroupsRef.current = [];
      return;
    }

    const unsubscribe = subscribeToMySidebarGroups(currentUserId, (groups) => {
      joinedGroupsRef.current = groups
        // Candado ocultas: nunca sugerir comunidades ocultas, aun siendo miembro.
        .filter((group) => group.visibility !== "hidden")
        .filter((group) => group.memberStatus !== "banned")
        .filter((group) => typeof group.name === "string" && group.name.trim().length > 0)
        .map<MentionSuggestion>((group) => ({
          type: "group",
          id: group.id,
          label: (group.name ?? "").trim(),
          avatarUrl: group.avatarUrl ?? group.imageUrl ?? null,
          following: true,
        }));
    });

    return () => unsubscribe();
  }, [enabled, currentUserId]);

  const loadFollowedProfiles = useCallback(async (): Promise<MentionSuggestion[]> => {
    if (!currentUserId) return [];
    if (followedProfilesRef.current) return followedProfilesRef.current;
    if (followedLoadingRef.current) return followedLoadingRef.current;

    const loadPromise = (async () => {
      try {
        const followingSnap = await getDocs(
          query(collection(db, "users", currentUserId, "following"), limit(MAX_FOLLOWING_FETCH))
        );

        const targetIds = followingSnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            return typeof data.targetUserId === "string" ? data.targetUserId : docSnap.id;
          })
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

        const profiles = await Promise.all(
          targetIds.map(async (uid) => {
            try {
              const userSnap = await getDoc(doc(db, "users", uid));
              if (!userSnap.exists()) return null;

              const data = userSnap.data() as Record<string, unknown>;
              if (data.profileRestricted === true) return null;

              const handle =
                typeof data.handle === "string" && data.handle.trim()
                  ? data.handle.trim()
                  : typeof data.username === "string" && data.username.trim()
                    ? data.username.trim()
                    : null;
              if (!handle) return null;

              const label =
                typeof data.displayName === "string" && data.displayName.trim()
                  ? data.displayName.trim()
                  : handle;

              const suggestion: MentionSuggestion = {
                type: "profile",
                id: uid,
                label,
                handle,
                avatarUrl:
                  typeof data.photoURL === "string"
                    ? data.photoURL
                    : typeof data.avatarUrl === "string"
                      ? data.avatarUrl
                      : null,
                following: true,
              };
              return suggestion;
            } catch {
              return null;
            }
          })
        );

        const result = profiles.filter((p): p is MentionSuggestion => p !== null);
        followedProfilesRef.current = result;
        return result;
      } catch {
        followedProfilesRef.current = [];
        return [];
      } finally {
        followedLoadingRef.current = null;
      }
    })();

    followedLoadingRef.current = loadPromise;
    return loadPromise;
  }, [currentUserId]);

  const getSuggestions = useCallback(
    async (rawQuery: string): Promise<MentionSuggestion[]> => {
      if (!enabled) return [];

      const normalizedQuery = normalize(rawQuery);
      const byKey = new Map<string, MentionSuggestion>();
      const keyOf = (s: MentionSuggestion) => `${s.type}:${s.id}`;

      // Bucket 1: sigo / pertenezco.
      const followedProfiles = await loadFollowedProfiles();
      const primary = [...followedProfiles, ...joinedGroupsRef.current].filter((s) =>
        matchesQuery(s, normalizedQuery)
      );
      for (const s of primary) {
        const key = keyOf(s);
        if (!byKey.has(key)) byKey.set(key, s);
      }

      // Bucket 2: búsqueda del resto (perfiles + comunidades públicas/privadas).
      if (normalizedQuery.length >= MIN_SEARCH_QUERY_LENGTH) {
        const [profileResults, groupResults] = await Promise.all([
          searchProfiles({ db, rawQuery, currentUserId, maxResults: MAX_SUGGESTIONS }).catch(
            () => []
          ),
          searchGroups({ term: rawQuery, pageSize: MAX_SUGGESTIONS }).catch(() => ({
            groups: [],
            cursor: null,
            hasMore: false,
          })),
        ]);

        for (const profile of profileResults) {
          const suggestion: MentionSuggestion = {
            type: "profile",
            id: profile.uid,
            label: profile.displayName || profile.handle,
            handle: profile.handle,
            avatarUrl: profile.photoURL ?? null,
            following: false,
          };
          const key = keyOf(suggestion);
          if (!byKey.has(key)) byKey.set(key, suggestion);
        }

        for (const group of groupResults.groups) {
          // Doble candado: aunque searchGroups ya excluye ocultas.
          if (group.visibility === "hidden") continue;
          if (!group.id || !group.name) continue;
          const suggestion: MentionSuggestion = {
            type: "group",
            id: group.id,
            label: group.name,
            avatarUrl: group.avatarUrl ?? group.imageUrl ?? null,
            following: false,
          };
          const key = keyOf(suggestion);
          if (!byKey.has(key)) byKey.set(key, suggestion);
        }
      }

      // Prioriza el bucket "sigo/pertenezco".
      return Array.from(byKey.values())
        .sort((a, b) => Number(b.following) - Number(a.following))
        .slice(0, MAX_SUGGESTIONS);
    },
    [enabled, currentUserId, loadFollowedProfiles]
  );

  return { getSuggestions };
}
