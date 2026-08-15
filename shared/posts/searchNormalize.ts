const MULTIPLE_SPACES_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_SEARCH_CHARS_REGEX = /[^a-z0-9ñ\s_-]/g;

export function normalizeSearchText(value: unknown): string {
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

export function tokenizeSearchText(value: unknown): string[] {
  const normalized = normalizeSearchText(value);

  if (!normalized) return [];

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return Array.from(new Set(tokens)).slice(0, 30);
}

// Palabras vacías (stopwords) para extraer keywords de contenido. Guardadas
// SIN acentos y en minúscula, igual que las produce normalizeSearchText, para
// que el filtro funcione. Cubre español (principal), inglés y portugués.
const CONTENT_STOPWORDS = new Set<string>([
  // Español
  "que", "los", "las", "del", "por", "con", "una", "uno", "unos", "unas",
  "para", "como", "mas", "pero", "sus", "este", "esta", "estos", "estas",
  "eso", "esos", "esas", "esa", "ese", "esto", "porque", "cuando", "muy",
  "sin", "sobre", "tambien", "hasta", "hay", "donde", "quien", "quienes",
  "desde", "todo", "toda", "todos", "todas", "nos", "durante", "les", "contra",
  "otros", "otro", "otra", "otras", "ante", "ellos", "ellas", "ella", "antes",
  "algunos", "algunas", "algo", "nada", "mucho", "muchos", "poco", "pocos",
  "cual", "cuales", "tanto", "nosotros", "nosotras", "vosotros", "vosotras",
  "mis", "tus", "mio", "mia", "tuyo", "tuya", "suyo", "suya", "nuestro",
  "nuestra", "vuestro", "vuestra", "estoy", "estan", "estamos", "ser", "soy",
  "eres", "somos", "son", "fue", "fui", "era", "eran", "sea", "seria",
  "tiene", "tienen", "tener", "tengo", "hace", "hacer", "hizo", "haces",
  "puede", "pueden", "poder", "va", "van", "vas", "vamos", "ir", "ver",
  "aqui", "ahi", "alli", "cada", "asi", "aunque", "ademas", "entonces",
  "solo", "sino", "cual", "segun", "entre", "dos", "tres", "bien",
  // Inglés
  "the", "and", "for", "you", "that", "this", "with", "are", "was", "not",
  "they", "his", "her", "its", "your", "our", "their", "has", "have", "had",
  "will", "can", "all", "out", "does", "did", "but", "from", "about", "what",
  "when", "who", "which", "there", "here", "just", "them", "then", "than",
  // Portugués
  "nao", "uma", "que", "por", "com", "para", "como", "mais", "mas", "seu",
  "sua", "isso", "isto", "ele", "ela", "eles", "elas", "voce", "foi", "sao",
  "estao", "muito", "tambem", "sobre", "pelo", "pela", "dos", "das", "nas",
  "aos", "ser", "sim",
]);

/**
 * Extrae palabras clave de CONTENIDO de un texto para señales de descubrimiento:
 * tokeniza, quita acentos, descarta palabras vacías (stopwords), números puros y
 * tokens demasiado cortos. Debe usarse en AMBOS lados (registro y comparación).
 */
export function extractContentKeywords(
  value: unknown,
  options?: { minLength?: number; maxKeywords?: number }
): string[] {
  const minLength = options?.minLength ?? 3;
  const maxKeywords = options?.maxKeywords ?? 12;

  const out: string[] = [];
  for (const token of tokenizeSearchText(value)) {
    if (token.length < minLength) continue;
    if (/^\d+$/.test(token)) continue; // números puros = ruido
    if (CONTENT_STOPWORDS.has(token)) continue;
    out.push(token);
    if (out.length >= maxKeywords) break;
  }
  return out;
}

export function buildSearchPrefixes(
  tokens: string[],
  options?: {
    minLength?: number;
    maxLength?: number;
    maxPrefixes?: number;
  }
): string[] {
  const minLength = options?.minLength ?? 2;
  const maxLength = options?.maxLength ?? 12;
  const maxPrefixes = options?.maxPrefixes ?? 80;

  const prefixes = new Set<string>();

  for (const rawToken of tokens) {
    const token = normalizeSearchText(rawToken);

    if (token.length < minLength) continue;

    const upperLimit = Math.min(token.length, maxLength);

    for (let length = minLength; length <= upperLimit; length += 1) {
      prefixes.add(token.slice(0, length));

      if (prefixes.size >= maxPrefixes) {
        return Array.from(prefixes);
      }
    }
  }

  return Array.from(prefixes);
}

export function normalizeSearchTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const tags = value
    .map((item) => normalizeSearchText(item))
    .filter((tag) => tag.length >= 2);

  return Array.from(new Set(tags)).slice(0, 20);
}

export function mergeSearchTokens(...groups: Array<string[] | undefined | null>): string[] {
  const tokens = new Set<string>();

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    for (const token of group) {
      const normalized = normalizeSearchText(token);

      if (normalized.length >= 2) {
        tokens.add(normalized);
      }

      if (tokens.size >= 40) {
        return Array.from(tokens);
      }
    }
  }

  return Array.from(tokens);
}