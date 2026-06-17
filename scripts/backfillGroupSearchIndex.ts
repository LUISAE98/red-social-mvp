import "dotenv/config";
import * as admin from "firebase-admin";

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const MULTIPLE_SPACES_REGEX = /\s+/g;
const NON_SEARCH_CHARS_REGEX = /[^a-z0-9ñ\s_-]/g;

type GroupVisibility = "public" | "private" | "hidden";

const GROUP_CATEGORY_LABELS: Record<string, string> = {
  entretenimiento: "Entretenimiento",
  musica: "Música",
  creadores: "Creadores",
  gaming: "Gaming",
  tecnologia: "Tecnología",
  deportes: "Deportes",
  fitness_bienestar: "Fitness y bienestar",
  educacion: "Educación",
  negocios_finanzas: "Negocios y finanzas",
  noticias_politica: "Noticias y política",
  ciencia: "Ciencia",
  moda_belleza: "Moda y belleza",
  comida: "Comida",
  viajes: "Viajes",
  autos: "Autos",
  mascotas: "Mascotas",
  hobbies: "Hobbies",
  familia_comunidad: "Familia y comunidad",
  instituciones: "Instituciones",
  otros: "Otros",
};

const LEGACY_TO_CANONICAL_GROUP_CATEGORY: Record<string, string> = {
  cantante: "musica",
  musico: "musica",
  banda: "musica",
  comediante: "entretenimiento",
  actor: "entretenimiento",
  influencer: "creadores",
  streamer: "creadores",
  youtuber: "creadores",
  podcaster: "creadores",
  escritor: "creadores",
  fotografo: "creadores",
  artista_visual: "creadores",
  videojuegos: "gaming",
  esports: "gaming",
  programacion: "tecnologia",
  gadgets: "tecnologia",
  inteligencia_artificial: "tecnologia",
  crypto_web3: "tecnologia",
  futbol: "deportes",
  box: "deportes",
  fitness: "fitness_bienestar",
  running: "fitness_bienestar",
  deportes_general: "deportes",
  noticias: "noticias_politica",
  salud: "fitness_bienestar",
  bienestar: "fitness_bienestar",
  finanzas: "negocios_finanzas",
  politica: "noticias_politica",
  negocios: "negocios_finanzas",
  moda: "moda_belleza",
  belleza: "moda_belleza",
  institucion: "instituciones",
  empresa: "instituciones",
  escuela: "instituciones",
  gobierno: "instituciones",
  organizacion: "instituciones",
};

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .replace(NON_SEARCH_CHARS_REGEX, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(MULTIPLE_SPACES_REGEX, " ")
    .trim();
}

function tokenizeSearchText(value: unknown): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  return Array.from(
    new Set(
      normalized
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  ).slice(0, 30);
}

function buildSearchPrefixes(tokens: string[]): string[] {
  const prefixes = new Set<string>();

  for (const rawToken of tokens) {
    const token = normalizeSearchText(rawToken);
    if (token.length < 2) continue;

    const upperLimit = Math.min(token.length, 12);

    for (let length = 2; length <= upperLimit; length += 1) {
      prefixes.add(token.slice(0, length));
      if (prefixes.size >= 80) return Array.from(prefixes);
    }
  }

  return Array.from(prefixes);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => normalizeSearchText(item))
        .filter((tag) => tag.length >= 2)
    )
  ).slice(0, 20);
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const raw = value.trim();

  if (raw in GROUP_CATEGORY_LABELS) return raw;

  return LEGACY_TO_CANONICAL_GROUP_CATEGORY[raw] ?? null;
}

function normalizeVisibility(value: unknown): GroupVisibility {
  if (value === "private" || value === "hidden") return value;
  return "public";
}

function buildGroupSearchIndex(data: FirebaseFirestore.DocumentData) {
  const nameNormalized = normalizeSearchText(data.name);
  const descriptionNormalized = normalizeSearchText(data.description);

  const categoryNormalized = normalizeCategory(data.category);
  const categoryLabelNormalized = categoryNormalized
    ? normalizeSearchText(GROUP_CATEGORY_LABELS[categoryNormalized])
    : "";

  const tagsNormalized = normalizeTags(data.tags);

  const tokens = Array.from(
    new Set([
      ...tokenizeSearchText(nameNormalized),
      ...tokenizeSearchText(descriptionNormalized),
      ...tokenizeSearchText(categoryNormalized ?? ""),
      ...tokenizeSearchText(categoryLabelNormalized),
      ...tokenizeSearchText(tagsNormalized.join(" ")),
    ])
  ).slice(0, 40);

  return {
    nameNormalized,
    descriptionNormalized,
    categoryNormalized,
    categoryLabelNormalized,
    tagsNormalized,
    tokens,
    prefixes: buildSearchPrefixes(tokens),
    visibility: normalizeVisibility(data.visibility),
    discoverable:
      typeof data.discoverable === "boolean"
        ? data.discoverable
        : normalizeVisibility(data.visibility) !== "hidden",
    isActive: data.isActive !== false,
    version: 1,
    updatedAt: data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
  };
}

function initializeAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

async function main() {
  initializeAdmin();

  const db = admin.firestore();
  const groupsSnap = await db.collection("groups").get();

  let updated = 0;
  const skipped = 0;

  for (const groupDoc of groupsSnap.docs) {
    const data = groupDoc.data();

    const search = buildGroupSearchIndex(data);

    await groupDoc.ref.set(
      {
        search,
        updatedAt: data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated += 1;
    console.log(`OK ${groupDoc.id} -> ${data.name ?? "Sin nombre"}`);
  }

  console.log("");
  console.log(`Backfill terminado.`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Saltados: ${skipped}`);
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});