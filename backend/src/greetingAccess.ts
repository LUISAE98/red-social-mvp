// Verificación de participación en un saludo/consejo a partir de su playbackId.
//
// Las dos funciones de descarga (`videoOverlayDownload` y
// `greetingAnimatedDownload`) comprobaban que hubiera SESIÓN, pero no que quien
// pide tenga algo que ver con ese video. Autenticación no es autorización: con
// un playbackId ajeno, cualquier cuenta podía disparar un FFmpeg de 2 GiB o un
// egress de LiveKit sobre el saludo de otra persona.

import * as admin from "firebase-admin";

/**
 * ¿Es `uid` el comprador o el creador del saludo con ese `muxPlaybackId`?
 *
 * Los saludos viven en `greetingRequests` con `buyerId` y `creatorId` (mismo
 * criterio que las Firestore Rules de esa colección).
 */
export async function isGreetingParticipant(
  uid: string,
  playbackId: string
): Promise<boolean> {
  if (!uid || !playbackId) return false;

  const snap = await admin
    .firestore()
    .collection("greetingRequests")
    .where("muxPlaybackId", "==", playbackId)
    .limit(1)
    .get();

  if (snap.empty) return false;

  const data = snap.docs[0].data();
  return data.buyerId === uid || data.creatorId === uid;
}
