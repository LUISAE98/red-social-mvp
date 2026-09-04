/**
 * Push del sistema (FCM Web) para TODAS las notificaciones in-app.
 *
 * Un único trigger sobre `users/{uid}/notifications/{groupKey}`: cada vez que se
 * crea o "re-emerge" una notificación no leída, se envía un push a todos los
 * tokens de dispositivo del usuario (`users/{uid}/fcmTokens/*`). Como todas las
 * notificaciones ya caen en esa ruta, este trigger cubre las 21 existentes y las
 * futuras sin tocar cada tipo.
 *
 * Mensajes DATA-ONLY: el `firebase-messaging-sw.js` pinta la notificación. Se usa
 * `tag = groupKey` para que avisos repetidos del mismo tipo se colapsen en uno.
 * Tokens muertos se limpian al vuelo.
 */
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// Host público para los deep-links del push. El middleware de next-intl añade el
// prefijo de idioma según la cookie del usuario.
const SITE_URL = "https://vibraon.com";

type Data = admin.firestore.DocumentData;

function s(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Ruta relativa (sin prefijo de idioma) a la que lleva el push. */
  link: string;
  /** Colapsa avisos repetidos en el dispositivo. */
  tag: string;
  icon?: string | null;
  image?: string | null;
};

/**
 * Envía un push DATA-ONLY a todos los dispositivos de un usuario y limpia los
 * tokens muertos.
 *
 * Existe como función aparte porque no todo lo que se empuja al teléfono va
 * también a la campanita. Los mensajes directos son el caso: notifican en el
 * dispositivo, pero NO crean doc en `users/{uid}/notifications` — su bandeja es
 * la pestaña de Mensajes, y duplicarlos en la campanita sería ruido.
 */
export async function sendPushToUser(
  uid: string,
  payload: PushPayload
): Promise<void> {
  if (!uid) return;

  const tokensSnap = await db.collection("users").doc(uid).collection("fcmTokens").get();
  const tokens = tokensSnap.docs.map((d) => d.id);
  if (tokens.length === 0) return;

  const resp = await admin.messaging().sendEachForMulticast({
    tokens,
    data: {
      title: payload.title,
      body: payload.body,
      link: payload.link,
      tag: payload.tag,
      // Mismo icono que sirve el service worker del navegador
      // (public/firebase-messaging-sw.js). Si se cambia el kit de favicons hay
      // que tocar los dos, o la notificacion pide un archivo que ya no existe.
      icon: payload.icon ?? "/favicons/android-chrome-192x192.png?v=3",
      badge: "/favicons/android-chrome-192x192.png?v=3",
      ...(payload.image ? { image: payload.image } : {}),
    },
  });

  if (resp.failureCount > 0) {
    const batch = db.batch();
    let removed = 0;
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code;
      /**
       * ⚠️ Solo se borra por códigos que hablan DEL TOKEN.
       *
       * `messaging/invalid-argument` estaba en esta lista y no debía: FCM lo
       * devuelve también cuando el problema es el MENSAJE —un campo que no es
       * texto, un dato de más, una carga demasiado grande—. Y si el mensaje está
       * mal, falla para todos los tokens a la vez, así que un solo aviso
       * defectuoso borraba TODOS los dispositivos de esa persona.
       *
       * A partir de ahí no le llegaba nada de nada: ni mensajes, ni ninguna otra
       * notificación, y para siempre, porque el token se registraba una sola vez
       * al crear la cuenta. Encajaba con "se desactivan todas en general".
       *
       * Un token malo se sigue limpiando con los dos códigos de abajo, que son
       * los que de verdad dicen que ese destino ya no existe.
       */
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        batch.delete(tokensSnap.docs[i].ref);
        removed += 1;
      } else {
        // Se deja rastro: si esto aparece, el defecto está en la carga y hay que
        // arreglarlo ahí, no borrando destinos.
        logger.warn("sendPushToUser: fallo que NO es del token", {
          uid,
          tag: payload.tag,
          code,
        });
      }
    });
    if (removed > 0) await batch.commit();
  }

  logger.info("sendPushToUser", {
    uid,
    tag: payload.tag,
    tokens: tokens.length,
    success: resp.successCount,
    failure: resp.failureCount,
  });
}

/** Título y cuerpo del push (español; el idioma por-usuario queda para fase 2). */
function buildContent(type: string, data: Data): { title: string; body: string } {
  const actor = Array.isArray(data.actors) ? data.actors[0] : null;
  const name = (actor && s(actor.name)) || "Alguien";
  const target = (data.target as Data) || {};
  const group = s(target.groupName) || "una comunidad";
  const vibra = "Vibra";

  switch (type) {
    case "post_like":
      return { title: name, body: "reaccionó a tu publicación" };
    case "comment":
      return { title: name, body: "comentó tu publicación" };
    case "reply":
      return { title: name, body: "respondió tu comentario" };
    case "comment_like":
      return { title: name, body: "reaccionó a tu comentario" };
    case "mention":
      return { title: name, body: "te mencionó" };
    case "follow":
      return { title: name, body: "empezó a seguirte" };
    case "donation": {
      const channel = target.groupId ? `desde ${group}` : "desde tu perfil";
      const count = typeof data.actorCount === "number" ? data.actorCount : 1;
      return count > 1
        ? { title: name, body: `y ${count - 1} más donaron ${channel}` }
        : { title: name, body: `donó ${channel}` };
    }
    case "new_post":
      return {
        title: name,
        body: target.groupId ? `publicó en ${group}` : "publicó una novedad",
      };
    case "join_request":
      return { title: name, body: `solicitó unirse a ${group}` };
    case "group_new_member":
      return { title: name, body: `se unió a ${group}` };
    case "group_new_subscriber":
      return { title: name, body: `se suscribió a ${group}` };
    // El texto (cuerpo) espeja EXACTAMENTE el de la campanita in-app (mismos
    // strings que messages/es.json). El título es el "quién" (o la entidad).
    case "join_approved":
      return { title: name, body: `aprobó tu solicitud para unirte a ${group}` };
    case "join_rejected":
      return { title: name, body: `rechazó tu solicitud para unirte a ${group}` };
    case "group_moderation": {
      const a = s(target.action);
      const body =
        a === "kicked"
          ? `Fuiste expulsado de ${group}`
          : a === "banned"
          ? `Fuiste bloqueado en ${group}`
          : `Fuiste silenciado en ${group}`;
      return { title: group, body };
    }
    case "invite_expired":
      return {
        title: group,
        body:
          s(target.reason) === "max_uses"
            ? `Tu enlace de invitación a ${group} alcanzó el máximo de usos`
            : `Tu enlace de invitación a ${group} caducó`,
      };
    case "moderation_warning":
      return {
        title: "Moderación",
        body: s(data.message) || "Recibiste una advertencia de moderación",
      };
    case "kyc_update": {
      const a = s(target.action);
      const body =
        a === "approved"
          ? "Tu verificación de identidad fue aprobada. Ya puedes retirar."
          : a === "declined"
          ? "Tu verificación de identidad fue rechazada. Toca para reintentar."
          : a === "in_review"
          ? "Tu verificación de identidad está en revisión."
          : "Tu verificación de identidad está pendiente. Toca para continuar.";
      return { title: "Verificación", body };
    }
    case "session_event": {
      const a = s(target.action);
      if (a === "partner_ready") return { title: name, body: "ya está listo para tu sesión" };
      if (a === "partner_joined") return { title: name, body: "entró a la sesión" };
      const body =
        a === "reminder"
          ? "Tu sesión está por comenzar"
          : a === "ended"
          ? "Tu sesión terminó"
          : a === "incomplete"
          ? "Tu sesión quedó incompleta"
          : a === "no_show"
          ? "La otra parte no se presentó; la sesión se canceló"
          : a === "no_show_both"
          ? "La sesión se canceló: no se presentó nadie"
          : a === "recording_ready"
          ? "La grabación de tu sesión ya está lista"
          : a === "recording_failed"
          ? "La grabación de tu sesión falló"
          : "Tienes una novedad en tu sesión";
      return { title: "Sesión", body };
    }
    case "live_started":
      return { title: name, body: "está en vivo" };
    case "live_vod_ready":
      return s(target.action) === "self"
        ? { title: "Tu live", body: "El VOD de tu live ya está listo" }
        : { title: name, body: "subió la repetición de su live" };
    default:
      return { title: vibra, body: "Tienes una nueva notificación" };
  }
}

/** Deep-link absoluto (espeja `notificationHref`/`notificationQuery` del cliente). */
function buildLink(type: string, data: Data): string {
  const target = (data.target as Data) || {};
  const actor = Array.isArray(data.actors) ? data.actors[0] : null;
  const gid = s(target.groupId);
  let path = "/notifications";

  switch (type) {
    case "kyc_update":
      path = "/wallet/finanzas";
      break;
    case "group_moderation":
      path = s(target.action) === "muted" && gid ? `/groups/${gid}` : "/notifications";
      break;
    case "group_new_member":
    case "group_new_subscriber":
      path = gid ? `/groups/${gid}?tab=members` : "/notifications";
      break;
    case "join_request":
      path = gid ? `/groups/${gid}?requests=1` : "/notifications";
      break;
    case "join_approved":
    case "join_rejected":
    case "invite_expired":
      path = gid ? `/groups/${gid}` : "/notifications";
      break;
    case "follow": {
      const h = actor && s(actor.handle);
      path = h ? `/u/${h}` : "/notifications";
      break;
    }
    default: {
      const postId = s(target.postId);
      const commentId = s(target.commentId);
      if (postId) path = `/post/${postId}${commentId ? `?c=${commentId}` : ""}`;
      else if (gid) path = `/groups/${gid}`;
      else if (s(target.handle)) path = `/u/${s(target.handle)}`;
    }
  }
  return `${SITE_URL}${path}`;
}

function bumped(before: Data | undefined, after: Data): boolean {
  if (!before) return true; // recién creada
  const b = before.updatedAt as admin.firestore.Timestamp | undefined;
  const a = after.updatedAt as admin.firestore.Timestamp | undefined;
  if (!a) return false;
  if (!b) return true;
  return a.toMillis() !== b.toMillis();
}

export const onNotificationWritten = onDocumentWritten(
  { document: "users/{uid}/notifications/{groupKey}", region: REGION },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return; // borrada
    if (after.read === true) return; // marcar leído no empuja
    const before = event.data?.before?.data();
    if (!bumped(before, after)) return; // sin evento nuevo (p.ej. solo lastPush)

    const { uid, groupKey } = event.params;
    const type = s(after.type) ?? "";

    const { title, body } = buildContent(type, after);

    // Ícono = avatar de quien genera la noti (su cara, como en la app); si no
    // hay, el logo de Vibra. Imagen grande = miniatura del post (Android/desktop;
    // iOS no la muestra). Badge = ícono monocromo para la barra de estado Android.
    const actor = Array.isArray(after.actors) ? after.actors[0] : null;

    await sendPushToUser(uid, {
      title,
      body,
      link: buildLink(type, after),
      tag: groupKey,
      icon: actor ? s(actor.avatarUrl) : null,
      image: s((after.target as Data)?.imageUrl),
    });
  }
);
