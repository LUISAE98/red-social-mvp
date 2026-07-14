import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeSearchText, tokenizeSearchText } from "@/lib/search/normalize";
import type { StoryDoc, StoryType } from "./types";

const MIN_SEARCH_LENGTH = 2;
// Matcheamos por los primeros N caracteres de cada palabra: prefijo con
// tolerancia, pero sin la sensibilidad de 2 letras. Súbelo = más estricto;
// bájalo = más tolerante.
const QUERY_PREFIX_LEN = 5;
const MAX_QUERY_TOKENS = 10; // array-contains-any admite hasta 30
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 40;

/**
 * Busca historias (saludos/consejos compartidos) por su contexto, nombre del
 * creador y tipo. Solo devuelve historias marcadas como buscables (perfil, o
 * comunidad pública). El filtro por tipo se aplica del lado del cliente para no
 * necesitar un segundo índice.
 */
export async function searchStories(params: {
  search: string;
  type?: StoryType | null;
  pageSize?: number;
}): Promise<StoryDoc[]> {
  const normalized = normalizeSearchText(params.search);
  if (normalized.length < MIN_SEARCH_LENGTH) return [];

  // Matcheamos por un prefijo ACOTADO (primeros QUERY_PREFIX_LEN caracteres) de
  // cada palabra: da tolerancia de prefijo (agrupa por raíz) pero ya no trae
  // basura de 2 letras como "sa". El doc guarda todos los prefijos.
  const tokens = tokenizeSearchText(normalized);
  if (!tokens.length) return [];
  const queryPrefixes = Array.from(
    new Set(tokens.map((t) => t.slice(0, QUERY_PREFIX_LEN)))
  ).slice(0, MAX_QUERY_TOKENS);
  if (!queryPrefixes.length) return [];

  const pageSize = Math.max(
    1,
    Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  );

  try {
    const snap = await getDocs(
      query(
        collection(db, "stories"),
        where("searchable", "==", true),
        where("searchPrefixes", "array-contains-any", queryPrefixes),
        orderBy("createdAt", "desc"),
        limit(pageSize)
      )
    );

    let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);

    if (params.type) {
      docs = docs.filter((s) => s.type === params.type);
    }

    return docs;
  } catch (err) {
    console.error("[searchStories]", err);
    return [];
  }
}
