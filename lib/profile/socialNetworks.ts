/**
 * Redes sociales del perfil — catálogo, limpieza y armado de la liga.
 *
 * Regla de oro: se guarda el USUARIO, nunca la liga. El documento del perfil es
 * de lectura pública y lo que se guarde ahí termina en un `href` a la vista de
 * cualquiera; si dejáramos escribir la liga completa, por ahí entrarían
 * `javascript:`, los redirectores y las suplantaciones. Guardando `mivibra` y
 * armando `https://instagram.com/mivibra` aquí, desde un catálogo cerrado, ese
 * problema desaparece de raíz y las reglas solo tienen que revisar una cadena
 * corta.
 *
 * Quien pinte estas ligas SIEMPRE debe pasar por `socialProfileUrl`. Nunca
 * confiar en lo guardado tal cual.
 */

export const SOCIAL_NETWORK_IDS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "twitch",
] as const;

export type SocialNetworkId = (typeof SOCIAL_NETWORK_IDS)[number];

/** Lo que se guarda en `users/{uid}.socialLinks`: id de red → usuario limpio. */
export type SocialLinks = Partial<Record<SocialNetworkId, string>>;

/**
 * Tope duro de caracteres por usuario. Lo mismo que revisan las reglas de
 * Firestore — si cambia aquí, tiene que cambiar allá.
 */
export const SOCIAL_HANDLE_MAX = 40;

type SocialNetwork = {
  id: SocialNetworkId;
  /** Nombre propio de la marca. No se traduce y por eso no vive en los idiomas. */
  label: string;
  /**
   * El principio de la liga, tal cual. Se usa como marcador de posición del
   * campo: enseña la forma de lo que se espera sin depender del idioma, y deja
   * claro de un vistazo que pegar la liga completa está bien.
   */
  urlPrefix: string;
  /** Qué forma acepta cada red. */
  pattern: RegExp;
  /** Cómo se arma la liga pública a partir del usuario ya limpio. */
  url: (handle: string) => string;
};

export const SOCIAL_NETWORKS: Record<SocialNetworkId, SocialNetwork> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    urlPrefix: "instagram.com/",
    pattern: /^[A-Za-z0-9._]{1,30}$/,
    url: (h) => `https://instagram.com/${h}`,
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    urlPrefix: "tiktok.com/@",
    pattern: /^[A-Za-z0-9._]{1,24}$/,
    url: (h) => `https://tiktok.com/@${h}`,
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    urlPrefix: "youtube.com/@",
    pattern: /^[A-Za-z0-9._-]{3,30}$/,
    url: (h) => `https://youtube.com/@${h}`,
  },
  x: {
    id: "x",
    label: "X",
    urlPrefix: "x.com/",
    pattern: /^[A-Za-z0-9_]{1,15}$/,
    url: (h) => `https://x.com/${h}`,
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    urlPrefix: "facebook.com/",
    // Mucha gente NUNCA se puso nombre de usuario en Facebook: su perfil vive en
    // `facebook.com/profile.php?id=61556…`. Si solo aceptáramos el nombre, esa
    // mitad de la gente no podría agregar el suyo. Por eso también entra el
    // número de perfil, y la liga se arma distinta según cuál de los dos sea.
    pattern: /^(\d{5,40}|[A-Za-z0-9.]{5,40})$/,
    url: (h) =>
      /^\d+$/.test(h)
        ? `https://facebook.com/profile.php?id=${h}`
        : `https://facebook.com/${h}`,
  },
  twitch: {
    id: "twitch",
    label: "Twitch",
    urlPrefix: "twitch.tv/",
    pattern: /^[A-Za-z0-9_]{4,25}$/,
    url: (h) => `https://twitch.tv/${h}`,
  },
};

/**
 * Deja el usuario como se va a guardar, o `null` si no sirve.
 *
 * Aguanta que peguen la liga completa —es lo que hace todo el mundo— y se queda
 * con el último tramo útil. Quita la arroba de adelante, los espacios y
 * cualquier cosa que venga después de un `?` o un `/`.
 */
export function normalizeSocialHandle(
  id: SocialNetworkId,
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string") return null;

  let value = raw.trim();
  if (!value) return null;

  // Facebook antes que nada: en los perfiles sin nombre de usuario la identidad
  // va en la consulta (`profile.php?id=…`), y el corte genérico de abajo tira
  // todo lo que sigue al `?` — se quedaría con "profile.php" y nada más.
  if (id === "facebook") {
    const byId = value.match(/profile\.php\?(?:[^#]*&)?id=(\d+)/i);
    if (byId) value = byId[1];
  }

  // Pegaron una liga. Se toma el último tramo con contenido, que es donde vive
  // el usuario en las seis redes del catálogo.
  if (/^https?:\/\//i.test(value) || value.includes("/")) {
    const withoutQuery = value.split(/[?#]/)[0];
    const parts = withoutQuery.split("/").filter(Boolean);
    value = parts.length > 0 ? parts[parts.length - 1] : "";
  }

  value = value.replace(/^@+/, "").trim();

  if (!value || value.length > SOCIAL_HANDLE_MAX) return null;
  if (!SOCIAL_NETWORKS[id].pattern.test(value)) return null;

  return value;
}

/**
 * Deja el mapa completo listo para guardar. Lo que no pase la revisión no se
 * guarda a medias, se cae: más vale una red de menos que una liga rota en un
 * perfil público.
 */
export function sanitizeSocialLinks(input: unknown): SocialLinks {
  if (!input || typeof input !== "object") return {};

  const source = input as Record<string, unknown>;
  const out: SocialLinks = {};

  for (const id of SOCIAL_NETWORK_IDS) {
    const clean = normalizeSocialHandle(id, source[id] as string | undefined);
    if (clean) out[id] = clean;
  }

  return out;
}

/** La liga pública de una red. Se arma aquí, nunca sale del documento. */
export function socialProfileUrl(id: SocialNetworkId, handle: string): string {
  return SOCIAL_NETWORKS[id].url(handle);
}

/** Las redes que tiene un perfil, en el orden del catálogo. */
export function listSocialLinks(
  links: SocialLinks | null | undefined
): Array<{ id: SocialNetworkId; handle: string; url: string; label: string }> {
  if (!links) return [];

  return SOCIAL_NETWORK_IDS.flatMap((id) => {
    const handle = links[id];
    if (!handle) return [];
    return [
      {
        id,
        handle,
        url: socialProfileUrl(id, handle),
        label: SOCIAL_NETWORKS[id].label,
      },
    ];
  });
}
