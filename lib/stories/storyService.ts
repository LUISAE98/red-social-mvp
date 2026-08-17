import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { prepararFreno, aplicarFreno } from "@/lib/rateLimit/frenoEnLote";
import {
  buildSearchPrefixes,
  tokenizeSearchText,
} from "@/lib/search/normalize";
import {
  normalizeGroupCategory,
  type CanonicalGroupCategory,
} from "@/types/group";
import type { StoryDoc, StoryType } from "./types";

function toCanonicalList(value: unknown): CanonicalGroupCategory[] {
  if (!Array.isArray(value)) return [];
  const out: CanonicalGroupCategory[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    const c = normalizeGroupCategory(v);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// Construye los prefijos de búsqueda de una historia a partir de su contexto,
// el nombre del creador y el tipo (saludo/consejo).
function buildStorySearchPrefixes(
  instructions: string | undefined,
  creatorName: string,
  type: StoryType
): string[] {
  const source = `${instructions ?? ""} ${creatorName} ${type}`;
  return buildSearchPrefixes(tokenizeSearchText(source), {
    minLength: 2,
    maxLength: 20,
    maxPrefixes: 80,
  });
}

// Resolves muxPlaybackId for stories that don't have it by reading the
// greetingRequest doc. Mutates the story objects in-place so the caller
// can pass them directly to the callback without a second render cycle.
// Also writes back to Firestore so future loads are instant.
async function patchMissingPlaybackIds(stories: StoryDoc[]): Promise<void> {
  const unresolved = stories.filter((s) => !s.muxPlaybackId && s.greetingRequestId);
  if (unresolved.length === 0) return;
  await Promise.all(
    unresolved.map(async (s) => {
      try {
        const snap = await getDoc(doc(db, "greetingRequests", s.greetingRequestId));
        const pid = snap.data()?.muxPlaybackId as string | null | undefined;
        if (!pid) return;
        // Mutate in-place so the callback renders with the image on first call
        s.muxPlaybackId = pid;
        s.thumbnailUrl = `https://image.mux.com/${pid}/thumbnail.jpg?time=0`;

        // Aquí había una escritura de vuelta a `stories` para no repetir esta
        // resolución en cada carga. NUNCA funcionó: las reglas de historias son
        // `allow update: if false`, así que fallaba siempre y el `.catch(() => {})`
        // se lo tragaba en silencio. Se quitó para no aparentar una caché que no
        // existe.
        //
        // La resolución en memoria sí funciona, así que la historia se ve bien;
        // solo cuesta una lectura extra por carga. Persistirlo de verdad es
        // trabajo del backend (el webhook de Mux no toca `stories` hoy), no del
        // cliente: si se le abriera esta escritura, un creador podría apuntar su
        // historia al video de otra persona.
      } catch {
        // best-effort — silently skip
      }
    }),
  );
}

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sortByDate(stories: StoryDoc[]): StoryDoc[] {
  return [...stories].sort((a, b) => {
    const at = a.createdAt?.toMillis() ?? 0;
    const bt = b.createdAt?.toMillis() ?? 0;
    return bt - at;
  });
}

export async function addStoryFromGreeting(params: {
  creatorId: string;
  greetingCreatorId?: string;
  instructions?: string;
  type: StoryType;
  muxPlaybackId: string | null;
  thumbnailUrl: string | null;
  videoDuration: number | null;
  greetingRequestId: string;
  source: "profile" | "group";
  groupId: string | null;
}): Promise<string> {
  // Creador mostrado = quien grabó el saludo/consejo (A). Denormalizamos su
  // nombre para buscar por nombre de creador y para mostrarlo en resultados.
  const showcaseCreatorId = params.greetingCreatorId ?? params.creatorId;
  let creatorName = "";
  // Categorías denormalizadas para recomendar por afinidad (D).
  let categories: CanonicalGroupCategory[] = [];
  try {
    const uSnap = await getDoc(doc(db, "users", showcaseCreatorId));
    const u = uSnap.data() as Record<string, unknown> | undefined;
    creatorName =
      (typeof u?.displayName === "string" && u.displayName.trim()) ||
      [u?.firstName, u?.lastName]
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .join(" ") ||
      "";
    // Historia de perfil → hereda los intereses del creador.
    if (params.source === "profile") {
      categories = toCanonicalList(u?.interests);
    }
  } catch {
    creatorName = "";
  }

  // ⚠️ El perfil que decide si esto es público es el de QUIEN PUBLICA
  // (`creatorId`), no el de quien grabó el saludo (`showcaseCreatorId`). Son
  // distintos cuando el comprador republica el saludo de otro, y la regla de
  // Firestore mira `resource.data.creatorId`: elegir aquí el otro perfil haría
  // que la escritura se denegara sin causa visible en el cliente.
  //
  // Si la lectura falla se asume lo restrictivo. La regla exige que este valor
  // coincida con el estado REAL, así que un perfil abierto haría fallar la
  // creación en vez de publicar algo mal marcado.
  let perfilPublico = false;
  try {
    const publicadorSnap =
      showcaseCreatorId === params.creatorId
        ? await getDoc(doc(db, "users", showcaseCreatorId))
        : await getDoc(doc(db, "users", params.creatorId));
    const publicador = publicadorSnap.data() as Record<string, unknown> | undefined;
    perfilPublico =
      !!publicador &&
      publicador.showPosts !== false &&
      publicador.profileRestricted !== true;
  } catch {
    perfilPublico = false;
  }

  // Legible por cualquiera: sin comunidad siempre; con comunidad solo si es
  // pública.
  //
  // ⚠️ La condición mira `groupId`, NO `source`, porque es exactamente así como
  // lo comprueba la regla de Firestore (`storyHasNoGroup || isGroupPublic`). Hoy
  // los dos campos van siempre juntos, pero si alguna vez se separaran, decidir
  // aquí por `source` y allá por `groupId` haría que la escritura se denegara sin
  // una causa visible en el cliente.
  // ⚠️ B8-C03. Antes bastaba con no tener comunidad para ser públicamente
  // legible, así que un perfil CERRADO seguía saliendo en el feed de reels y en
  // las búsquedas con su vídeo y su nombre. Las publicaciones sí respetaban
  // `profileRestricted`/`showPosts`; las historias se quedaron fuera.
  //
  // Decisión de producto de Luis (2026-08-16): al cerrar el perfil, las
  // historias desaparecen del feed público.
  //
  // El perfil cerrado manda en los DOS casos: también esconde del feed público
  // una historia publicada en una comunidad pública.
  let searchable = !params.groupId && perfilPublico;
  if (params.groupId) {
    try {
      const gSnap = await getDoc(doc(db, "groups", params.groupId));
      const g = gSnap.data() as Record<string, unknown> | undefined;
      searchable = g?.visibility === "public" && perfilPublico;
      // Historia de comunidad → hereda la categoría de la comunidad.
      if (params.source === "group") {
        const cat = normalizeGroupCategory(g?.category);
        categories = cat ? [cat] : [];
      }
    } catch {
      // Si no se pudo leer la comunidad, se asume lo restrictivo. La regla exige
      // que este valor coincida con la visibilidad REAL, así que una comunidad
      // pública haría fallar la creación en vez de publicar algo mal marcado.
      searchable = false;
    }
  }

  const searchPrefixes = buildStorySearchPrefixes(
    params.instructions,
    creatorName,
    params.type
  );

  // ¿La publica el creador que grabó, o el comprador que la recibió? El reel solo
  // muestra la del creador. Se congela aquí porque una consulta de Firestore no
  // puede comparar `greetingCreatorId` con `creatorId`.
  const byCreator = showcaseCreatorId === params.creatorId;

  // Firestore RECHAZA `undefined` (no está `ignoreUndefinedProperties`), y tanto
  // `instructions` como `greetingCreatorId` son opcionales en los dos sitios que
  // llaman aquí. Cuando venían vacíos, `addDoc` lanzaba y la historia no se creaba
  // nunca — el creador pulsaba "compartir" y no pasaba nada.
  const payload: Record<string, unknown> = {
    creatorId: params.creatorId,
    type: params.type,
    muxPlaybackId: params.muxPlaybackId,
    thumbnailUrl: params.thumbnailUrl,
    videoDuration: params.videoDuration,
    greetingRequestId: params.greetingRequestId,
    source: params.source,
    groupId: params.groupId,
    creatorName,
    searchable,
    searchPrefixes,
    categories,
    byCreator,
    hiddenFromReel: false,
    viewsCount: 0,
    createdAt: serverTimestamp(),
  };
  if (params.greetingCreatorId !== undefined) {
    payload.greetingCreatorId = params.greetingCreatorId;
  }
  if (params.instructions !== undefined) {
    payload.instructions = params.instructions;
  }

  // ⚠️ B8-H05. Las historias no tenían NINGÚN freno: una cuenta podía crearlas
  // sin límite, con fechas manipuladas y prefijos inflados, y colarse así en
  // todo el feed de reels y en todas las búsquedas.
  //
  // El contador viaja en el MISMO lote atómico que la historia, y la regla de
  // creación lo exige con `getAfter`. Sin contador no hay historia. 20 al día.
  const freno = await prepararFreno(params.creatorId, "story");

  const lote = writeBatch(db);
  const historiaRef = doc(collection(db, "stories"));
  lote.set(historiaRef, payload);
  aplicarFreno(lote, freno);
  await lote.commit();

  return historiaRef.id;
}

/**
 * Retira una historia del feed de reels, o la devuelve, sin borrarla.
 *
 * Solo quien la publicó. Es la única escritura que las reglas dejan pasar sobre
 * una historia ya creada, y a propósito: cualquier otro campo (en particular
 * `searchable`) sostiene la regla de lectura.
 */
export async function setStoryHiddenFromReel(
  storyId: string,
  hidden: boolean,
): Promise<void> {
  await updateDoc(doc(db, "stories", storyId), { hiddenFromReel: hidden });
}

// Stories belonging to a creator's profile (source = "profile")
export function subscribeToCreatorStories(
  creatorId: string,
  callback: (stories: StoryDoc[]) => void,
): () => void {
  const q = query(
    collection(db, "stories"),
    where("creatorId", "==", creatorId),
    where("source", "==", "profile"),
  );
  return onSnapshot(
    q,
    async (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
      await patchMissingPlaybackIds(docs);
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToCreatorStories]", err),
  );
}

// Stories belonging to a community/group (source = "group")
export function subscribeToGroupStories(
  groupId: string,
  callback: (stories: StoryDoc[]) => void,
): () => void {
  const q = query(
    collection(db, "stories"),
    where("groupId", "==", groupId),
  );
  return onSnapshot(
    q,
    async (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
      await patchMissingPlaybackIds(docs);
      callback(sortByDate(docs));
    },
    (err) => console.error("[subscribeToGroupStories]", err),
  );
}

// Check if a specific greeting already has a story (for viewMode/buyerViewMode toggle)
// filterCreatorId narrows to the story added by that user (creator or buyer)
export function subscribeToStoryByGreeting(
  greetingRequestId: string,
  callback: (story: StoryDoc | null) => void,
  filterCreatorId?: string,
): () => void {
  const q = query(
    collection(db, "stories"),
    where("greetingRequestId", "==", greetingRequestId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
      const filtered = filterCreatorId
        ? docs.filter((s) => s.creatorId === filterCreatorId)
        : docs;
      callback(filtered.length > 0 ? (filtered[0] ?? null) : null);
    },
    (err) => console.error("[subscribeToStoryByGreeting]", err),
  );
}

export async function deleteStory(storyId: string): Promise<void> {
  await deleteDoc(doc(db, "stories", storyId));
}

// ─── View tracking ────────────────────────────────────────────────────────────

export async function recordStoryView(userId: string, storyId: string): Promise<void> {
  await setDoc(doc(db, "userStoryViews", userId, "views", storyId), {
    storyId,
    viewedAt: serverTimestamp(),
  });
}

// Returns Map<storyId, viewedAtMs> so callers can apply time-window logic
export function subscribeToViewedStories(
  userId: string,
  callback: (views: Map<string, number>) => void,
): () => void {
  const ref = collection(db, "userStoryViews", userId, "views");
  return onSnapshot(
    ref,
    (snap) => {
      const map = new Map<string, number>();
      for (const d of snap.docs) {
        const ts = d.data().viewedAt;
        map.set(d.id, ts?.toMillis?.() ?? Date.now());
      }
      callback(map);
    },
    (err) => console.error("[subscribeToViewedStories]", err),
  );
}

// ─── Home feed story queries ──────────────────────────────────────────────────

// Stories from a list of profile creators (for home feed)
export function subscribeToStoriesFromCreators(
  creatorIds: string[],
  callback: (stories: StoryDoc[]) => void,
): () => void {
  if (creatorIds.length === 0) {
    callback([]);
    return () => {};
  }
  // Firestore `in` acepta hasta 30; batcheamos para no truncar a quien sigue a más.
  const batches = chunkIds(creatorIds, 30);
  const perBatch: StoryDoc[][] = batches.map(() => []);

  const emit = () => {
    const merged = new Map<string, StoryDoc>();
    for (const arr of perBatch) for (const s of arr) merged.set(s.id, s);
    callback(sortByDate([...merged.values()]));
  };

  const unsubs = batches.map((ids, idx) =>
    onSnapshot(
      query(collection(db, "stories"), where("creatorId", "in", ids)),
      async (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
          .filter((s) => s.source === "profile");
        await patchMissingPlaybackIds(docs);
        perBatch[idx] = docs;
        emit();
      },
      (err) => console.error("[subscribeToStoriesFromCreators]", err),
    ),
  );

  return () => unsubs.forEach((u) => u());
}

// Stories from a list of groups (for home feed)
export function subscribeToStoriesFromGroups(
  groupIds: string[],
  callback: (stories: StoryDoc[]) => void,
): () => void {
  if (groupIds.length === 0) {
    callback([]);
    return () => {};
  }
  const batches = chunkIds(groupIds, 30);
  const perBatch: StoryDoc[][] = batches.map(() => []);

  const emit = () => {
    const merged = new Map<string, StoryDoc>();
    for (const arr of perBatch) for (const s of arr) merged.set(s.id, s);
    callback(sortByDate([...merged.values()]));
  };

  const unsubs = batches.map((ids, idx) =>
    onSnapshot(
      query(collection(db, "stories"), where("groupId", "in", ids)),
      async (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
          .filter((s) => s.source === "group");
        await patchMissingPlaybackIds(docs);
        perBatch[idx] = docs;
        emit();
      },
      (err) => console.error("[subscribeToStoriesFromGroups]", err),
    ),
  );

  return () => unsubs.forEach((u) => u());
}

// ─── Story cover (portada) ────────────────────────────────────────────────────

export async function setProfileStoryCover(
  creatorId: string,
  key: string,
  storyId: string | null,
): Promise<void> {
  await updateDoc(doc(db, "users", creatorId), {
    [`storyCovers.${key}`]: storyId ?? deleteField(),
  });
}

export async function setGroupStoryCover(
  groupId: string,
  type: StoryType,
  storyId: string | null,
): Promise<void> {
  await updateDoc(doc(db, "groups", groupId), {
    [`storyCovers.${type}`]: storyId ?? deleteField(),
  });
}

export async function setProfileStoryCoverPhoto(
  creatorId: string,
  key: string,
  url: string | null,
): Promise<void> {
  await updateDoc(doc(db, "users", creatorId), {
    [`storyCoverPhoto.${key}`]: url ?? deleteField(),
  });
}

export async function setGroupStoryCoverPhoto(
  groupId: string,
  type: StoryType,
  url: string | null,
): Promise<void> {
  await updateDoc(doc(db, "groups", groupId), {
    [`storyCoverPhoto.${type}`]: url ?? deleteField(),
  });
}

// ─── Recommended stories (one-shot fetch) ────────────────────────────────────

// Fetches active profile stories from a specific list of creator UIDs.
// Used by HomeStoriesRow to load stories from recommended creators without
// setting up a real-time listener. cutoffMs filters out stories older than 24h.
// Historias públicas recientes (candidatas para el recomendador de historias).
// Reglas de stories: `allow read: if true`, así que la query es libre.
export async function fetchRecentPublicStories(
  cutoffMs: number,
  limitN = 60,
): Promise<StoryDoc[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "stories"),
        where("searchable", "==", true),
        where("createdAt", ">=", Timestamp.fromMillis(cutoffMs)),
        orderBy("createdAt", "desc"),
        limit(limitN),
      ),
    );
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoryDoc);
    await patchMissingPlaybackIds(docs);
    return docs;
  } catch (err) {
    console.error("[fetchRecentPublicStories]", err);
    return [];
  }
}

export async function fetchStoriesFromCreatorIds(
  creatorIds: string[],
  cutoffMs: number,
): Promise<StoryDoc[]> {
  if (creatorIds.length === 0) return [];
  const ids = creatorIds.slice(0, 30);
  try {
    const snap = await getDocs(
      query(collection(db, "stories"), where("creatorId", "in", ids)),
    );
    const docs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as StoryDoc)
      .filter((s) => s.source === "profile" && (s.createdAt?.toMillis() ?? 0) >= cutoffMs);
    await patchMissingPlaybackIds(docs);
    return sortByDate(docs);
  } catch (err) {
    console.error("[fetchStoriesFromCreatorIds]", err);
    return [];
  }
}
