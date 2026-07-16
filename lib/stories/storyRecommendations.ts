import { getUserTasteVector } from "@/app/components/GroupRecommendations/recommendation-engine";
import { normalizeGroupCategory } from "@/types/group";
import { fetchRecentPublicStories } from "./storyService";
import type { StoryDoc } from "./types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 60;
const MAX_RECOMMENDED = 12;

type Options = {
  excludeCreatorIds?: string[];
  excludeGroupIds?: string[];
};

/**
 * Historias recomendadas para el rail de Home (A+B+D+E):
 *   - Candidatos: historias públicas recientes (últimas 24h) que el usuario aún
 *     no sigue (perfiles Y comunidades).
 *   - Ranking: afinidad de categoría (mismo vector de gustos que los posts) +
 *     recencia + popularidad (vistas).
 *   - Frío total (sin señales): se ordena por más vistas (populares).
 */
export async function fetchRecommendedStories(
  uid: string,
  options?: Options,
): Promise<StoryDoc[]> {
  if (!uid) return [];

  const excludeCreators = new Set(options?.excludeCreatorIds ?? []);
  const excludeGroups = new Set(options?.excludeGroupIds ?? []);
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

  const [taste, candidates] = await Promise.all([
    getUserTasteVector(uid),
    fetchRecentPublicStories(cutoff, CANDIDATE_LIMIT),
  ]);

  const hasTaste = taste.size > 0;
  const now = Date.now();
  const scored: { story: StoryDoc; score: number }[] = [];

  for (const story of candidates) {
    if (!story.id) continue;
    // Excluir propias y de quienes ya sigo / comunidades donde soy miembro
    // (esas ya salen en la sección de "seguidos").
    if (story.creatorId === uid || story.greetingCreatorId === uid) continue;
    if (excludeCreators.has(story.creatorId)) continue;
    if (story.groupId && excludeGroups.has(story.groupId)) continue;

    // Afinidad = mejor coincidencia entre las categorías de la historia y tu gusto.
    let affinity = 0;
    if (Array.isArray(story.categories)) {
      for (const raw of story.categories) {
        const cat = normalizeGroupCategory(raw);
        if (cat) affinity = Math.max(affinity, taste.get(cat) ?? 0);
      }
    }

    const ageMs = now - (story.createdAt?.toMillis?.() ?? now);
    const recency = Math.max(0, 1 - ageMs / TWENTY_FOUR_HOURS_MS);
    const popularity = Math.log1p(story.viewsCount ?? 0);

    const score = hasTaste
      ? affinity * 3 + recency * 1.5 + popularity * 1
      : popularity * 3 + recency * 1.5; // frío total → populares

    scored.push({ story, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECOMMENDED)
    .map((entry) => entry.story);
}
