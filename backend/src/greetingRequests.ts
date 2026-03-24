import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type GreetingType = "saludo" | "consejo" | "mensaje";
type GreetingStatus = "pending" | "accepted" | "rejected";
type GreetingSource = "group" | "profile";

function assertString(value: unknown, field: string, maxLen = 300): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }
  const v = value.trim();
  if (!v) throw new HttpsError("invalid-argument", `${field} is required`);
  if (v.length > maxLen) {
    throw new HttpsError("invalid-argument", `${field} is too long (max ${maxLen})`);
  }
  return v;
}

function assertOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpsError("invalid-argument", `${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

// 1) Crear solicitud de saludo/consejo/mensaje
export const createGreetingRequest = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const buyerId = auth.uid;

    const groupId = assertString(request.data?.groupId, "groupId", 120);
    const type = assertOneOf<GreetingType>(request.data?.type, "type", ["saludo", "consejo", "mensaje"]);
    const toName = assertString(request.data?.toName, "toName", 80);
    const instructions = assertString(request.data?.instructions, "instructions", 1000);
    const source = (request.data?.source
      ? assertOneOf<GreetingSource>(request.data.source, "source", ["group", "profile"])
      : "group") as GreetingSource;

    const groupRef = db.doc(`groups/${groupId}`);
    const memberRef = db.doc(`groups/${groupId}/members/${buyerId}`);

    // Transacción para validaciones fuertes
    const result = await db.runTransaction(async (tx) => {
      const [groupSnap, memberSnap] = await Promise.all([tx.get(groupRef), tx.get(memberRef)]);

      if (!groupSnap.exists) {
        throw new HttpsError("not-found", "Group not found.");
      }

      const group = groupSnap.data() as any;
      const creatorId: string | undefined = group?.ownerId;

      if (!creatorId) {
        throw new HttpsError("failed-precondition", "Group has no ownerId.");
      }

      // Bloqueo: el owner NO puede comprarse su propio saludo
      if (buyerId === creatorId) {
        throw new HttpsError("failed-precondition", "Owner cannot purchase own greeting.");
      }

      // MVP: para pedir saludo debes ser miembro (al menos por ahora, como ya veníamos manejando)
      // Si luego quieres “saludos públicos sin ser miembro”, aquí lo cambiamos.
      if (!memberSnap.exists) {
        throw new HttpsError("permission-denied", "You must be a member of the group to request a greeting.");
      }

      // Validar que el offering esté habilitado en la comunidad
      const offerings = Array.isArray(group?.offerings) ? group.offerings : [];
      const offering = offerings.find((o: any) => o?.type === type);
      if (!offering || offering.enabled !== true) {
        throw new HttpsError("failed-precondition", "This service is not enabled for this group.");
      }

      const requestRef = db.collection("greetingRequests").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();

      tx.set(requestRef, {
        groupId,
        creatorId,
        buyerId,
        type,
        toName,
        instructions,
        source,
        status: "pending" as GreetingStatus,
        createdAt: now,
        updatedAt: now,
      });

      return { requestId: requestRef.id, creatorId };
    });

    logger.info("createGreetingRequest created", {
      groupId,
      buyerId,
      type,
      source,
      requestId: result.requestId,
    });

    return { ok: true, requestId: result.requestId, creatorId: result.creatorId };
  }
);

// 2) Responder solicitud (owner): accepted / rejected
export const respondGreetingRequest = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const actorId = auth.uid;

    const requestId = assertString(request.data?.requestId, "requestId", 200);
    const action = assertOneOf<"accept" | "reject">(request.data?.action, "action", ["accept", "reject"]);

    const reqRef = db.doc(`greetingRequests/${requestId}`);

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) {
        throw new HttpsError("not-found", "Greeting request not found.");
      }

      const gr = reqSnap.data() as any;

      // Sólo el creador (owner) puede responder
      if (gr.creatorId !== actorId) {
        throw new HttpsError("permission-denied", "Only the creator can respond to this request.");
      }

      if (gr.status !== "pending") {
        throw new HttpsError("failed-precondition", "Request is not pending.");
      }

      const newStatus: GreetingStatus = action === "accept" ? "accepted" : "rejected";

      tx.update(reqRef, {
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    logger.info("respondGreetingRequest updated", { requestId, actorId, action });

    return { ok: true };
  }
);