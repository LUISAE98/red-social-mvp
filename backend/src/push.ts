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
    case "join_approved":
      return { title: vibra, body: `Aprobaron tu solicitud para unirte a ${group}` };
    case "join_rejected":
      return { title: vibra, body: `Rechazaron tu solicitud para unirte a ${group}` };
    case "group_moderation": {
      const a = s(target.action);
      const body =
        a === "kicked"
          ? `Fuiste expulsado de ${group}`
          : a === "banned"
          ? `Fuiste bloqueado en ${group}`
          : `Fuiste silenciado en ${group}`;
      return { title: vibra, body };
    }
    case "invite_expired":
      return {
        title: vibra,
        body:
          s(target.reason) === "max_uses"
            ? `Tu link de invitación a ${group} alcanzó el máximo de usos`
            : `Tu link de invitación a ${group} caducó`,
      };
    case "moderation_warning":
      return { title: vibra, body: s(data.message) || "Recibiste una advertencia de moderación" };
    case "kyc_update": {
      const a = s(target.action);
      const body =
        a === "approved"
          ? "Tu verificación fue aprobada. Ya puedes retirar."
          : a === "declined"
          ? "Tu verificación fue rechazada. Toca para reintentar."
          : a === "in_review"
          ? "Tu verificación está en revisión."
          : "Tu verificación está pendiente.";
      return { title: vibra, body };
    }
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

    // Tokens del usuario (doc id = token).
    const tokensSnap = await db
      .collection("users")
      .doc(uid)
      .collection("fcmTokens")
      .get();
    const tokens = tokensSnap.docs.map((d) => d.id);
    if (tokens.length === 0) return;

    const { title, body } = buildContent(type, after);
    const link = buildLink(type, after);

    // Ícono = avatar de quien genera la noti (su cara, como en la app); si no
    // hay, el logo de Vibra. Imagen grande = miniatura del post (Android/desktop;
    // iOS no la muestra). Badge = ícono monocromo para la barra de estado Android.
    const actor = Array.isArray(after.actors) ? after.actors[0] : null;
    const actorAvatar = actor ? s(actor.avatarUrl) : null;
    const targetImage = s((after.target as Data)?.imageUrl);

    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title,
        body,
        link,
        tag: groupKey,
        icon: actorAvatar ?? "/icon-192.png",
        badge: "/icon-192.png",
        ...(targetImage ? { image: targetImage } : {}),
      },
    });

    // Limpia tokens muertos.
    if (resp.failureCount > 0) {
      const batch = db.batch();
      let removed = 0;
      resp.responses.forEach((r, i) => {
        if (r.success) return;
        const code = r.error?.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) {
          batch.delete(tokensSnap.docs[i].ref);
          removed += 1;
        }
      });
      if (removed > 0) await batch.commit();
    }

    logger.info("onNotificationWritten push sent", {
      uid,
      type,
      tokens: tokens.length,
      success: resp.successCount,
      failure: resp.failureCount,
    });
  }
);
