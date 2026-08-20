// Creación de publicaciones — SERVER-AUTHORITATIVE.
//
// ⚠️ Por qué existe. Publicar era una escritura directa del cliente a Firestore,
// y el límite de publicaciones vivía en una llamada APARTE a `checkRateLimitPost`.
// Dos pasos independientes: quien hablara con Firestore por su cuenta se saltaba
// el primero y publicaba sin que nadie contara nada. Ninguna regla podía
// arreglarlo, porque una regla no puede exigir que ANTES ocurriera otra cosa.
//
// Ahora `posts` es `create: if false` y todo pasa por aquí, donde el contador y
// la escritura ocurren en la MISMA transacción.
//
// ── Diseño ────────────────────────────────────────────────────────────────────
// El cliente manda el borrador del documento y el servidor SOBRESCRIBE encima
// todo campo que decida algo: autor, contexto, visibilidad, si se comparte,
// índice de búsqueda, fechas y contadores. Lo que sobrevive del cliente son
// datos suyos (su texto, los medios que subió, la configuración de su post).
//
// Se hizo así y NO reconstruyendo el documento entero a propósito: son 5 formas
// distintas (texto, imagen, medios, video, directo) con ~40 campos, y
// reescribirlas es justo donde aparecen las divergencias sutiles. Lo que hay que
// mover es la FRONTERA DE CONFIANZA, no el constructor.
//
// ── Residuo aceptado ──────────────────────────────────────────────────────────
// `groupCategory` y `groupTags` se aceptan del cliente (solo saneados de tipo y
// tamaño). Son copias denormalizadas de metadatos PÚBLICOS del grupo que solo
// alimentan el ranking de recomendaciones: falsearlos mal-clasifica el propio
// post de quien lo hace y no toca acceso, dinero ni exposición. Validarlos
// server-side exigiría duplicar en el backend la tabla de categorías canónicas y
// su mapa de legacy (`types/group.ts`), que es exactamente el tipo de
// duplicación que se está tratando de eliminar.

import * as admin from "firebase-admin";
import { PREMIUM_MIN_PRICE_USD } from "./wallet/ledger";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { buildPostSearchIndex } from "./shared/posts/searchIndex";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// Mismos números que `checkRateLimitPost` en `backend/src/rateLimiter.ts`, que
// sigue existiendo para el resto de acciones.
const POST_INTERVAL_MS = 10_000;
const POST_MAX_PER_HOUR = 20;

const MAX_TEXT = 5000;
const MAX_MEDIA = 10;
const MAX_TAGS = 20;

// ⚠️ Mínimo REAL de un contenido de pago, no un número redondo. Era 10 —diez pesos de
// la época MXN— y con la denominación en USD se convirtió en diez dólares: el servidor
// rechazaba publicaciones que el panel del creador daba por buenas.
const PRECIO_MIN = PREMIUM_MIN_PRICE_USD;
// Tope de seguridad, no una regla de negocio: ataja un precio absurdo por dedo torpe.
const PRECIO_MAX = 100000;

// ── Esquema cerrado del borrador ────────────────────────────────────────────
//
// ⚠️ Antes el documento se escribía como `{...draft, ...autoritativos}`: los
// campos que el servidor decide se pisaban, pero **cualquier otro campo del
// cliente sobrevivía tal cual**. Eso dejaba sembrar estructuras arbitrarias en
// `premium`, `liveData`, `videoData` y demás, que luego leen los cobros, los
// triggers y los reproductores. El control de creación quedaba a medias.
//
// Ahora lo que no está en estas listas se descarta antes de escribir. Las listas
// salen de los cinco puntos de creación del cliente (`post-service.create.ts` y
// `post-service.create-media.ts`).

const CAMPOS_DEL_CLIENTE = new Set([
  "text", "postType", "media",
  "access", "accessModel", "accessScope", "premium",
  "requiresPayment", "requiresSubscription", "oneTimePrice", "currency", "purchaseType",
  "liveData", "videoData", "scheduledData", "playback", "processing",
  "groupCategory", "groupTags",
  "shareTitle", "shareDescription", "shareImageUrl",
]);

const CAMPOS_PREMIUM = new Set([
  "enabled", "kind", "accessMode", "freeFor", "price", "currency", "purchaseType",
]);

const CAMPOS_LIVE = new Set([
  "status", "title", "description", "coverUrl",
  "scheduledStartAt", "scheduleHasTime", "startedAt", "endedAt",
  "streamProvider", "liveStreamId", "playbackId", "streamKey", "ingestUrl",
  "createdFrom", "visibilityMode", "allowLoggedOutViewers",
  "accessType", "ticketPrice", "currency", "paidAccessMode", "broadcastGroupIds",
  "superCommentConfig",
]);

const CAMPOS_MEDIA = new Set([
  "type", "id", "index", "url", "path", "thumbnailUrl", "thumbnailPath",
  "altText", "width", "height", "size", "mimeType",
  "provider", "status", "uploadId", "assetId", "playbackId", "hlsUrl", "duration",
]);

const CAMPOS_VIDEO_DATA = new Set([
  "provider", "status", "assetId", "uploadId", "playbackId",
  "duration", "thumbnailUrl", "sourceUrl", "sourcePath",
]);

const CAMPOS_PLAYBACK = new Set([
  "url", "hlsUrl", "thumbnailUrl", "provider", "playbackId", "duration", "isReady",
]);

const CAMPOS_PROCESSING = new Set([
  "status", "provider", "errorCode", "errorMessage", "updatedAt",
]);

/** Deja solo las claves permitidas. Lo demás se descarta en silencio. */
function soloClaves(value: unknown, permitidas: Set<string>): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const salida: Record<string, unknown> = {};
  for (const [clave, bruto] of Object.entries(value as Record<string, unknown>)) {
    if (permitidas.has(clave)) salida[clave] = bruto;
  }
  return salida;
}

/** Modos de visibilidad de un directo. Cualquier otra cosa cae en el más cerrado. */
const MODOS_DIRECTO = new Set(["everyone", "logged_in_only", "members_only"]);

type Draft = Record<string, unknown>;

/** Espejo de `pickString` en `lib/posts/post-service.helpers.ts`. */
function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Espejo de `readProfileDisplayName`. */
function readProfileDisplayName(d: Record<string, unknown>): string | null {
  return (
    pickString(d.displayName) ||
    pickString(d.name) ||
    [pickString(d.firstName), pickString(d.lastName)].filter(Boolean).join(" ").trim() ||
    pickString(d.username) ||
    pickString(d.handle) ||
    null
  );
}

/** Espejo de `readProfileAvatarUrl`. */
function readProfileAvatarUrl(d: Record<string, unknown>): string | null {
  return pickString(d.avatarUrl) || pickString(d.photoURL) || pickString(d.imageUrl) || null;
}

/** Espejo de `readGroupName`. */
function readGroupName(d: Record<string, unknown>): string | null {
  return (
    pickString(d.name) ||
    pickString(d.title) ||
    pickString(d.groupName) ||
    pickString(d.displayName) ||
    null
  );
}

/** Espejo de `readGroupAvatarUrl`. */
function readGroupAvatarUrl(d: Record<string, unknown>): string | null {
  return (
    pickString(d.avatarUrl) ||
    pickString(d.photoURL) ||
    pickString(d.imageUrl) ||
    pickString(d.groupAvatarUrl) ||
    null
  );
}

/** Espejo de `normalizeGroupVisibility`. */
function normalizeGroupVisibility(value: unknown): "public" | "private" | "hidden" | null {
  return value === "public" || value === "private" || value === "hidden" ? value : null;
}

/** Espejo de `normalizeGroupTags`. */
function normalizeGroupTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const limpio = tags
    .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
    .filter(Boolean);
  return Array.from(new Set(limpio)).slice(0, MAX_TAGS);
}

/**
 * Marca de fecha que manda el cliente. Debe coincidir con `TS_KEY` en
 * `lib/posts/createPostServer.ts`.
 *
 * El borrador viaja como JSON, así que un `Timestamp` llegaría convertido en un
 * mapa `{seconds, nanoseconds}` y se guardaría como mapa, no como fecha. El
 * cliente lo marca y aquí se reconstruye.
 */
const TS_KEY = "__ts__";

function revivirFechas(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map(revivirFechas);

  const obj = value as Record<string, unknown>;
  const marca = obj[TS_KEY];
  if (typeof marca === "number" && Number.isFinite(marca) && Object.keys(obj).length === 1) {
    return admin.firestore.Timestamp.fromMillis(marca);
  }

  const salida: Record<string, unknown> = {};
  for (const [clave, bruto] of Object.entries(obj)) {
    salida[clave] = revivirFechas(bruto);
  }
  return salida;
}

/** Id de documento de Firestore generado automáticamente. */
function esIdValido(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{20}$/.test(value);
}

function toMillis(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * Espejo de `resolveEffectiveMembershipStatus` + `assertMembershipCanInteract`.
 *
 * ⚠️ Un estado desconocido cae en "puede interactuar", igual que en el cliente.
 * No es un descuido: el documento de miembro solo existe si alguien se unió, y
 * su creación sí la gobiernan las reglas. Divergir aquí rompería a usuarios
 * reales con documentos viejos.
 */
function assertPuedeInteractuar(data: Record<string, unknown>): void {
  const bruto = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";

  if (bruto === "banned") {
    throw new HttpsError("permission-denied", "Estás baneado de esta comunidad.");
  }
  if (bruto === "removed" || bruto === "kicked" || bruto === "expelled") {
    throw new HttpsError("permission-denied", "Ya no perteneces a esta comunidad.");
  }
  if (bruto === "muted") {
    const hasta = toMillis(data.mutedUntil);
    if (hasta === null || hasta > Date.now()) {
      throw new HttpsError("permission-denied", "Estás muteado en esta comunidad.");
    }
  }
}

function requireRealAccount(request: {
  auth?: { uid?: string; token?: Record<string, unknown> } | null;
}): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

  const firebaseClaim = request.auth?.token?.["firebase"] as
    | { sign_in_provider?: string }
    | undefined;
  if (firebaseClaim?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Las cuentas de invitado no publican.");
  }
  return uid;
}

/** Espejo de `PostCreationContext`, resuelto contra los documentos REALES. */
type Contexto = {
  contextType: "group" | "profile";
  groupId: string | null;
  groupVisibility: "public" | "private" | "hidden" | null;
  groupName: string | null;
  groupAvatarUrl: string | null;
  profileId: string | null;
  profileName: string | null;
  profileAvatarUrl: string | null;
  profileUsername: string | null;
  profileRestricted: boolean | null;
  esDuenoDelGrupo: boolean;
};

type Autor = {
  uid: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorUsername: string | null;
};

/** Espejo de `resolvePostCreationContext`. */
async function resolverContexto(autor: Autor, draft: Draft): Promise<Contexto> {
  const contextType = draft.contextType === "profile" ? "profile" : "group";

  if (contextType === "profile") {
    const profileId = pickString(draft.profileId) || autor.uid;
    if (profileId !== autor.uid) {
      throw new HttpsError("permission-denied", "Solo puedes publicar en tu propio perfil.");
    }

    const snap = await db.collection("users").doc(profileId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "El perfil no existe.");
    }
    const perfil = (snap.data() ?? {}) as Record<string, unknown>;

    return {
      contextType: "profile",
      groupId: null,
      groupVisibility: null,
      groupName: null,
      groupAvatarUrl: null,
      profileId,
      profileName: readProfileDisplayName(perfil) || autor.authorName,
      profileAvatarUrl: readProfileAvatarUrl(perfil) ?? autor.authorAvatarUrl,
      profileUsername:
        pickString(perfil.username) || pickString(perfil.handle) || autor.authorUsername,
      profileRestricted: perfil.profileRestricted === true,
      esDuenoDelGrupo: false,
    };
  }

  const groupId = pickString(draft.groupId);
  if (!groupId) {
    throw new HttpsError("invalid-argument", "Falta groupId.");
  }

  const grupoRef = db.collection("groups").doc(groupId);
  const [grupoSnap, miembroSnap] = await Promise.all([
    grupoRef.get(),
    grupoRef.collection("members").doc(autor.uid).get(),
  ]);

  if (!grupoSnap.exists) {
    throw new HttpsError("not-found", "La comunidad no existe.");
  }
  const grupo = (grupoSnap.data() ?? {}) as Record<string, unknown>;

  if (grupo.isActive === false) {
    throw new HttpsError("failed-precondition", "Esta comunidad está inactiva.");
  }

  const esDueno = grupo.ownerId === autor.uid;

  if (!esDueno) {
    if (!miembroSnap.exists) {
      throw new HttpsError("permission-denied", "Debes pertenecer a la comunidad para publicar.");
    }
    assertPuedeInteractuar((miembroSnap.data() ?? {}) as Record<string, unknown>);

    const permisos = (grupo.permissions ?? {}) as Record<string, unknown>;
    const modo = permisos.postingMode ?? grupo.postingMode;
    if (modo === "owner_only") {
      throw new HttpsError("permission-denied", "Solo el creador puede publicar en esta comunidad.");
    }
  }

  const groupVisibility = normalizeGroupVisibility(grupo.visibility);
  if (!groupVisibility) {
    throw new HttpsError("failed-precondition", "No se pudo resolver la visibilidad del grupo.");
  }

  return {
    contextType: "group",
    groupId,
    groupVisibility,
    groupName: readGroupName(grupo),
    groupAvatarUrl: readGroupAvatarUrl(grupo),
    profileId: null,
    profileName: null,
    profileAvatarUrl: null,
    profileUsername: null,
    profileRestricted: null,
    esDuenoDelGrupo: esDueno,
  };
}

/** Espejo de `resolveIsShareable` — la regla que decide si el post sale hacia fuera. */
function resolverIsShareable(ctx: Contexto, draft: Draft): boolean {
  const premium = (draft.premium ?? null) as Record<string, unknown> | null;

  const esGratis =
    (pickString(draft.accessModel) ?? "free") === "free" &&
    draft.requiresPayment !== true &&
    draft.requiresSubscription !== true;

  const grupoPublico = ctx.contextType !== "profile" && ctx.groupVisibility === "public";
  const perfilPublico = ctx.contextType === "profile" && ctx.profileRestricted !== true;

  const premiumPublico =
    premium?.enabled === true &&
    premium?.accessMode === "public" &&
    ctx.contextType !== "profile" &&
    ctx.groupVisibility !== "hidden";

  return (esGratis && (grupoPublico || perfilPublico)) || premiumPublico;
}

/** ¿El borrador pide cobrar por este post? */
function pideMonetizacion(draft: Draft): boolean {
  const premium = (draft.premium ?? null) as Record<string, unknown> | null;
  return (
    premium?.enabled === true ||
    draft.requiresPayment === true ||
    draft.requiresSubscription === true ||
    (pickString(draft.accessModel) ?? "free") !== "free"
  );
}

export const createPost = onCall({ region: REGION }, async (request) => {
  const uid = requireRealAccount(request);

  const bruto = (request.data?.post ?? null) as Draft | null;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    throw new HttpsError("invalid-argument", "Falta la publicación.");
  }
  const draft = revivirFechas(bruto) as Draft;

  // El flujo de video reserva el id antes de subir a Mux (`createMuxDirectUpload`),
  // así que el cliente puede fijarlo. Se crea con `create`, nunca con `set`: así
  // no hay forma de sobrescribir una publicación existente.
  const idPedido = request.data?.postId;
  if (idPedido != null && !esIdValido(idPedido)) {
    throw new HttpsError("invalid-argument", "El id de la publicación no es válido.");
  }

  const texto = typeof draft.text === "string" ? draft.text.trim() : "";
  if (texto.length > MAX_TEXT) {
    throw new HttpsError("invalid-argument", "El texto es demasiado largo.");
  }

  const media = Array.isArray(draft.media) ? draft.media : [];
  if (media.length > MAX_MEDIA) {
    throw new HttpsError("invalid-argument", "Demasiados archivos en una publicación.");
  }

  // ── Autor: del documento real y del registro de Auth, nunca del borrador ────
  // Espejo de `getCurrentAuthorSnapshot`.
  const [usuarioSnap, authUser] = await Promise.all([
    db.collection("users").doc(uid).get(),
    admin
      .auth()
      .getUser(uid)
      .catch(() => null),
  ]);
  const u = (usuarioSnap.data() ?? {}) as Record<string, unknown>;

  const autor: Autor = {
    uid,
    authorName:
      pickString(u.displayName) ||
      pickString(u.name) ||
      pickString(authUser?.displayName) ||
      pickString(u.username) ||
      pickString(u.handle) ||
      "Usuario",
    authorAvatarUrl:
      pickString(u.avatarUrl) || pickString(u.photoURL) || pickString(authUser?.photoURL) || null,
    authorUsername: pickString(u.username) || pickString(u.handle) || null,
  };

  const ctx = await resolverContexto(autor, draft);

  // ── Monetización: solo el dueño de la comunidad, y con precio acotado ───────
  //
  // ⚠️ El precio vive por triplicado: `oneTimePrice`, `premium.price` y
  // `liveData.ticketPrice`. Antes solo se validaba el primero, y **solo si venía
  // presente**, así que omitirlo y poner el precio en cualquiera de los otros dos
  // saltaba el tope entero: los cobros de Stripe leen `oneTimePrice ?? premium.price`
  // y `oneTimePrice ?? liveData.ticketPrice`, o sea que el campo sin validar era
  // exactamente el que acababa cobrándose.
  //
  // Ahora se resuelve UN precio efectivo, se valida ese, y se reescriben los tres
  // con el mismo número. Se igualan en vez de quitar los alternativos a propósito:
  // si concuerdan da igual cuál lea el cobro, y las publicaciones antiguas que solo
  // tengan uno de ellos siguen funcionando.
  const dePago = pideMonetizacion(draft);
  let precioEfectivo: number | null = null;

  if (dePago) {
    if (ctx.contextType === "group" && !ctx.esDuenoDelGrupo) {
      throw new HttpsError(
        "permission-denied",
        "Solo el creador de la comunidad puede publicar contenido de pago."
      );
    }

    const premiumBruto = (draft.premium ?? null) as Record<string, unknown> | null;
    const liveBruto = (draft.liveData ?? null) as Record<string, unknown> | null;

    const candidatos = [draft.oneTimePrice, premiumBruto?.price, liveBruto?.ticketPrice];
    const declarados = candidatos.filter((p) => p != null);

    if (declarados.length > 0) {
      const precio = declarados[0];
      if (
        typeof precio !== "number" ||
        !Number.isFinite(precio) ||
        precio < PRECIO_MIN ||
        precio > PRECIO_MAX
      ) {
        throw new HttpsError("invalid-argument", "El precio no es válido.");
      }
      // Si vienen varios y no coinciden, es que alguien está enseñando un precio
      // y cobrando otro. No se elige uno, se rechaza.
      if (declarados.some((p) => p !== precio)) {
        throw new HttpsError("invalid-argument", "El precio no es consistente.");
      }
      precioEfectivo = precio;
    }
  }

  // ── Medios: cada ruta de Storage tiene que ser de este autor ───────────────
  //
  // El uploader escribe en `posts/{contenedor}/{uid}/{carpeta}/{archivo}`
  // (`lib/posts/image-upload.ts`). El contenedor es la comunidad en un post de
  // comunidad, pero en un post de PERFIL es el pseudo-id `profile-{uid}`: un
  // perfil no es un grupo y no tiene id de grupo. Lo que de verdad protege es el
  // SEGUNDO segmento —tiene que ser el uid del autor—, que es exactamente lo que
  // exige `storage.rules` (`request.auth.uid == uid`).
  const prefijosPropios =
    ctx.contextType === "group"
      ? [`posts/${ctx.groupId}/${uid}/`]
      : [`posts/profile-${uid}/${uid}/`];

  for (const item of media) {
    if (!item || typeof item !== "object") continue;
    const { path, thumbnailPath } = item as Record<string, unknown>;
    for (const p of [path, thumbnailPath]) {
      if (typeof p === "string" && p && !prefijosPropios.some((pre) => p.startsWith(pre))) {
        throw new HttpsError("permission-denied", "Un archivo de la publicación no te pertenece.");
      }
    }
  }

  // ── Publicaciones de directo ───────────────────────────────────────────────
  // Un directo no sigue las reglas generales: se auto-fija en su contexto, su
  // visibilidad la manda `visibilityMode` (un directo de pago SÍ se comparte,
  // al revés que un post premium) y los datos del stream los pone después el
  // backend de streaming — si el cliente pudiera sembrarlos, podría apuntar a
  // una transmisión ajena.
  const esDirecto = draft.postType === "live";
  const liveDataBruto = soloClaves(draft.liveData, CAMPOS_LIVE);
  const grupoOculto = ctx.groupVisibility === "hidden";
  // ⚠️ Un modo desconocido caía antes en "everyone" por descarte, o sea que una
  // cadena inventada abría el directo. Ahora lo que no esté en la lista se trata
  // como el modo más cerrado.
  const modoDirecto =
    typeof liveDataBruto?.visibilityMode === "string" &&
    MODOS_DIRECTO.has(liveDataBruto.visibilityMode)
      ? liveDataBruto.visibilityMode
      : "members_only";

  const liveData =
    esDirecto && liveDataBruto
      ? {
          ...liveDataBruto,
          status: "upcoming",
          createdFrom: ctx.contextType,
          visibilityMode: modoDirecto,
          allowLoggedOutViewers: modoDirecto === "everyone" && !grupoOculto,
          // El precio del ticket es el mismo que el del post. Sin esto, el cobro
          // del ticket (`oneTimePrice ?? liveData.ticketPrice`) podía leer un
          // número distinto del que se validó.
          ticketPrice: precioEfectivo,
          startedAt: null,
          endedAt: null,
          streamProvider: null,
          liveStreamId: null,
          playbackId: null,
          streamKey: null,
          ingestUrl: null,
        }
      : null;

  const fijadoEnGrupo = esDirecto && ctx.contextType === "group";
  const fijadoEnPerfil = esDirecto && ctx.contextType === "profile";

  const ahora = admin.firestore.FieldValue.serverTimestamp();
  const searchTimestamp = admin.firestore.Timestamp.now();

  const premiumBase = soloClaves(draft.premium, CAMPOS_PREMIUM);
  // Mismo criterio que con el ticket: el precio del bloque premium se iguala al
  // validado, para que los tres campos de precio no puedan discrepar.
  const premium: Record<string, unknown> | null = premiumBase
    ? { ...premiumBase, price: precioEfectivo }
    : null;
  const premiumActivo = premium?.enabled === true ? premium : null;
  const premiumComun = {
    premiumEnabled: premiumActivo?.enabled === true,
    premiumAccessMode:
      typeof premiumActivo?.accessMode === "string" ? premiumActivo.accessMode : null,
    premiumFreeFor: typeof premiumActivo?.freeFor === "string" ? premiumActivo.freeFor : null,
  };

  // Espejo exacto de `buildPostSearchIndexForContext`. Si esto diverge, un post
  // creado por aquí deja de aparecer en las búsquedas.
  const search =
    ctx.contextType === "group"
      ? {
          ...buildPostSearchIndex({
            text: texto,
            groupId: ctx.groupId as string,
            groupVisibility: ctx.groupVisibility as string,
            authorId: uid,
            accessScope: "group",
            isDeleted: false,
            createdAt: searchTimestamp,
            updatedAt: searchTimestamp,
          }),
          contextType: "group" as const,
          ...premiumComun,
        }
      : {
          ...buildPostSearchIndex({
            text: texto,
            groupId: "__profile__",
            groupVisibility: "public",
            authorId: uid,
            accessScope: "profile",
            isDeleted: false,
            createdAt: searchTimestamp,
            updatedAt: searchTimestamp,
          }),
          contextType: "profile" as const,
          groupId: null,
          profileId: ctx.profileId,
          visibility: "public",
          accessScope: "profile" as const,
          ...premiumComun,
        };

  // ── Borrador saneado ───────────────────────────────────────────────────────
  //
  // Solo sobreviven las claves conocidas, y las estructuras anidadas se recortan
  // a su propia lista. Lo que el cliente invente se descarta aquí, antes de
  // llegar a la escritura.
  const borrador: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(draft)) {
    if (CAMPOS_DEL_CLIENTE.has(clave)) borrador[clave] = valor;
  }

  borrador.premium = premium;
  borrador.oneTimePrice = precioEfectivo;
  // Ningún camino de creación lo rellena, pero `scheduledData.status` SÍ se lee
  // para pintar un post como programado o en vivo. Sembrarlo era una forma de
  // aparentar un directo sin serlo, así que nace nulo. Si algún día hace falta,
  // que se añada a propósito con su propia lista de campos.
  borrador.scheduledData = null;
  borrador.videoData = soloClaves(draft.videoData, CAMPOS_VIDEO_DATA);
  borrador.playback = soloClaves(draft.playback, CAMPOS_PLAYBACK);
  borrador.processing = soloClaves(draft.processing, CAMPOS_PROCESSING);
  borrador.media = media.map((item) => soloClaves(item, CAMPOS_MEDIA)).filter(Boolean);

  // Campos que decide el SERVIDOR. Se aplican ENCIMA del borrador, así que da
  // igual lo que el cliente haya puesto en ellos.
  const autoritativos: Record<string, unknown> = {
    // Espejo de `buildPostContextPayload`.
    contextType: ctx.contextType,
    groupId: ctx.groupId,
    groupName: ctx.groupName,
    groupAvatarUrl: ctx.groupAvatarUrl,
    groupVisibility: ctx.groupVisibility,
    groupCategory: pickString(draft.groupCategory), // residuo documentado arriba
    groupTags: normalizeGroupTags(draft.groupTags), //  ídem
    profileId: ctx.profileId,
    profileName: ctx.profileName,
    profileAvatarUrl: ctx.profileAvatarUrl,
    profileUsername: ctx.profileUsername,
    profileRestricted: ctx.profileRestricted,

    authorId: uid,
    authorName: autor.authorName,
    authorAvatarUrl: autor.authorAvatarUrl,
    authorUsername: autor.authorUsername,

    text: texto,

    // `isShareable` y `publicSlug` deciden exposición pública ⇒ servidor.
    // El título/descripción/imagen de compartir se derivan del contenido del
    // propio usuario, así que se dejan pasar; solo se acotan.
    isShareable: esDirecto
      ? modoDirecto !== "members_only" && !grupoOculto
      : resolverIsShareable(ctx, draft),
    publicSlug: null,
    shareTitle: pickString(draft.shareTitle)?.slice(0, 200) ?? null,
    shareDescription: pickString(draft.shareDescription)?.slice(0, 400) ?? null,
    shareImageUrl: (() => {
      const url = pickString(draft.shareImageUrl);
      return url && url.startsWith("https://") ? url : null;
    })(),

    createdAt: ahora,
    updatedAt: ahora,
    deletedAt: null,
    isDeleted: false,

    // Solo un directo nace fijado. Cualquier otro post que llegue pidiéndolo se
    // desfija aquí: fijar es una acción aparte, con sus propias reglas.
    isPinnedInGroup: fijadoEnGrupo,
    groupPinnedAt: fijadoEnGrupo ? ahora : null,
    groupPinnedBy: fijadoEnGrupo ? uid : null,
    isPinnedOnProfile: fijadoEnPerfil,
    profilePinnedAt: fijadoEnPerfil ? ahora : null,
    profilePinnedBy: fijadoEnPerfil ? uid : null,

    ...(esDirecto ? { liveData } : {}),

    counts: { comments: 0, likes: 0, saves: 0 },

    search,
  };

  const postRef = idPedido
    ? db.collection("posts").doc(idPedido as string)
    : db.collection("posts").doc();
  const limiteRef = db.collection("rateLimits").doc(`${uid}_post`);

  // El contador y la publicación, en la MISMA transacción. Esto es lo que
  // convierte el límite en obligatorio: ya no hay forma de escribir el post sin
  // pasar por el contador, porque son la misma operación.
  await db.runTransaction(async (tx) => {
    const limiteSnap = await tx.get(limiteRef);
    const ahoraMs = Date.now();
    const haceUnaHora = ahoraMs - 60 * 60 * 1000;

    const ultimoMs = limiteSnap.exists ? (toMillis(limiteSnap.get("lastAt")) ?? 0) : 0;

    const previas: admin.firestore.Timestamp[] = limiteSnap.exists
      ? ((limiteSnap.get("hourTimestamps") as admin.firestore.Timestamp[]) ?? []).filter(
          (t) => (toMillis(t) ?? 0) > haceUnaHora
        )
      : [];

    if (ahoraMs - ultimoMs < POST_INTERVAL_MS) {
      const faltan = Math.ceil((POST_INTERVAL_MS - (ahoraMs - ultimoMs)) / 1000);
      throw new HttpsError("resource-exhausted", `Espera ${faltan}s antes de publicar de nuevo.`);
    }
    if (previas.length >= POST_MAX_PER_HOUR) {
      throw new HttpsError(
        "resource-exhausted",
        `Alcanzaste el límite de ${POST_MAX_PER_HOUR} publicaciones por hora.`
      );
    }

    const marca = admin.firestore.Timestamp.fromMillis(ahoraMs);
    tx.set(limiteRef, { lastAt: marca, hourTimestamps: [...previas, marca] });
    tx.create(postRef, { ...borrador, ...autoritativos });
  });

  logger.info("createPost", {
    uid,
    postId: postRef.id,
    contextType: ctx.contextType,
    groupId: ctx.groupId,
    postType: typeof draft.postType === "string" ? draft.postType : null,
  });

  return { postId: postRef.id };
});
