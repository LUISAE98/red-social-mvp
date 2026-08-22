import { onCall, HttpsError } from "firebase-functions/v2/https";
import { SETTLEMENT_CURRENCY } from "./wallet/ledger";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";
import { usersHaveBlockBetweenTx } from "./social/blocks";
import { stripeSecretKey } from "./payments/stripe/stripeClient";
import { capturePaymentIntentForRef, cancelPaymentIntentForRef } from "./payments/stripe/holdCapture";
import { revertBuyerCreditSpend } from "./wallet/buyerCredit";
import { refundExperienceToCredit, mirrorCardReturnPurchase } from "./wallet/refundToCredit";
import { assertAccountNotBanned } from "./accountStatus";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type GreetingType = "saludo" | "consejo";
type GreetingStatus = "pending" | "accepted" | "rejected" | "refund_requested";
type GreetingSource = "group" | "profile";

type GroupMonetizationShape = {
  greetingsEnabled?: boolean;
  adviceEnabled?: boolean;
  subscriptionsEnabled?: boolean;
  paidPostsEnabled?: boolean;
  paidLivesEnabled?: boolean;
  paidVodEnabled?: boolean;
  paidLiveCommentsEnabled?: boolean;
  customClassEnabled?: boolean;
  digitalMeetGreetEnabled?: boolean;
};

type GroupOfferingShape = {
  type?: string;
  enabled?: boolean;
  visible?: boolean;
  visibility?: string;
  displayOrder?: number | null;
  memberPrice?: number | null;
  publicPrice?: number | null;
  currency?: string | null;
  requiresApproval?: boolean;
  sourceScope?: string;
  meta?: unknown;
  price?: number | null;
};

type GroupShape = {
  ownerId?: string;
  greetingsEnabled?: boolean;
  monetization?: GroupMonetizationShape | null;
  offerings?: GroupOfferingShape[] | null;
};

type UserShape = {
  uid?: string;
  handle?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
  offerings?: GroupOfferingShape[] | null;
};

function assertString(value: unknown, field: string, maxLen = 300): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }

  const v = value.trim();
  if (!v) {
    throw new HttpsError("invalid-argument", `${field} is required`);
  }

  if (v.length > maxLen) {
    throw new HttpsError(
      "invalid-argument",
      `${field} is too long (max ${maxLen})`
    );
  }

  return v;
}

function assertOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be one of: ${allowed.join(", ")}`
    );
  }

  return value as T;
}

function isEnabledOffering(
  offerings: GroupOfferingShape[] | null | undefined,
  type: GreetingType
): boolean {
  const arr = Array.isArray(offerings) ? offerings : [];
  return arr.some(
    (offering) => offering?.type === type && offering?.enabled === true
  );
}

function isGreetingServiceEnabled(group: GroupShape, type: GreetingType): boolean {
  const monetization = group?.monetization ?? null;
  const offerings = Array.isArray(group?.offerings) ? group.offerings : [];

  if (type === "saludo") {
    if (typeof monetization?.greetingsEnabled === "boolean") {
      return monetization.greetingsEnabled;
    }

    if (isEnabledOffering(offerings, "saludo")) {
      return true;
    }

    if (typeof group?.greetingsEnabled === "boolean") {
      return group.greetingsEnabled;
    }

    return false;
  }

  if (type === "consejo") {
    if (typeof monetization?.adviceEnabled === "boolean") {
      return monetization.adviceEnabled;
    }

    if (isEnabledOffering(offerings, "consejo")) {
      return true;
    }

    return false;
  }

  return false;
}

function isProfileGreetingServiceEnabled(user: UserShape, type: GreetingType): boolean {
  const offerings = Array.isArray(user?.offerings) ? user.offerings : [];

  return offerings.some((offering) => {
    if (offering?.type !== type) return false;
    if (offering?.enabled !== true) return false;

    const scope = offering?.sourceScope;
    return scope === "profile" || scope === "both" || !scope;
  });
}

function getOfferingPrice(offerings: GroupOfferingShape[] | null | undefined, type: GreetingType): number | null {
  const arr = Array.isArray(offerings) ? offerings : [];
  const offering = arr.find((o) => o?.type === type && o?.enabled === true);
  if (!offering) return null;
  if (typeof offering.memberPrice === "number" && offering.memberPrice > 0) return offering.memberPrice;
  if (typeof offering.publicPrice === "number" && offering.publicPrice > 0) return offering.publicPrice;
  if (typeof offering.price === "number" && offering.price > 0) return offering.price;
  return null;
}

function buildUserDisplayName(user: UserShape, fallbackUid: string): string {
  const displayName = user.displayName?.trim();
  if (displayName) return displayName;

  const fullName = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;

  return `Usuario ${fallbackUid.slice(0, 6)}`;
}

function normalizeMemberStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return value || null;
}

function canBuyerRequestByMembership(
  memberData: FirebaseFirestore.DocumentData | undefined
) {
  if (!memberData) return false;

  const status = normalizeMemberStatus(memberData.status);
  const accessType = normalizeMemberStatus(memberData.accessType);
  const legacyComplimentary = memberData.legacyComplimentary === true;

  if (!status) return false;

  const joinedStatuses = new Set(["active", "subscribed", "muted"]);
  const blockedStatuses = new Set(["banned", "removed", "kicked", "expelled"]);

  if (blockedStatuses.has(status)) {
    return false;
  }

  const hasJoinedMembership = joinedStatuses.has(status);
  const hasLegacyAccess =
    accessType === "legacy_free" || legacyComplimentary === true;

  return hasJoinedMembership || hasLegacyAccess;
}

// 1) Crear solicitud de saludo/consejo
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

    const rawSource = request.data?.source ?? "group";
const source = assertOneOf<GreetingSource>(rawSource, "source", [
  "group",
  "profile",
]);

const groupId =
  source === "group"
    ? assertString(request.data?.groupId, "groupId", 120)
    : typeof request.data?.groupId === "string" && request.data.groupId.trim()
      ? request.data.groupId.trim()
      : null;

const profileUserId =
  source === "profile"
    ? assertString(request.data?.profileUserId, "profileUserId", 120)
    : typeof request.data?.profileUserId === "string" &&
        request.data.profileUserId.trim()
      ? request.data.profileUserId.trim()
      : null;
    const type = assertOneOf<GreetingType>(request.data?.type, "type", [
      "saludo",
      "consejo",
    ]);
    const toName = assertString(request.data?.toName, "toName", 80);
    const instructions = assertString(
      request.data?.instructions,
      "instructions",
      1000
    );
    const allowCreatorStory = request.data?.allowCreatorStory === true;

    const result = await db.runTransaction(async (tx) => {
  const now = admin.firestore.FieldValue.serverTimestamp();
  // Pagar-luego-crear: el saludo NO se crea aquí. Pre-generamos su id y
  // guardamos la compra en un paymentIntent (con los datos del saludo dentro).
  // El saludo se materializa SOLO cuando el pago aprueba (ver reconcile.ts).
  // Así, intentos de pago fallidos/abandonados no dejan saludos huérfanos.
  const greetingId = db.collection("greetingRequests").doc().id;
  const externalReference = `greetingRequest__${greetingId}`;
  const intentRef = db.collection("paymentIntents").doc(externalReference);

  let creatorId: string;
  let priceSnapshot: number | null;
  let greetingBase: Record<string, unknown>;

  if (source === "profile") {
    if (!profileUserId) {
      throw new HttpsError("invalid-argument", "profileUserId is required.");
    }

    const profileSnap = await tx.get(db.doc(`users/${profileUserId}`));
    if (!profileSnap.exists) {
      throw new HttpsError("not-found", "Profile not found.");
    }

    const profile = (profileSnap.data() ?? {}) as UserShape;
    creatorId = profileUserId;

    if (buyerId === creatorId) {
      throw new HttpsError(
        "failed-precondition",
        "Creator cannot request own service."
      );
    }

    // Bloqueo de perfil: si comprador y creador se bloquearon (en cualquier
    // sentido), no se puede comprar el servicio.
    if (await usersHaveBlockBetweenTx(tx, buyerId, creatorId)) {
      throw new HttpsError(
        "permission-denied",
        "No puedes solicitar este servicio a este perfil."
      );
    }

    if (!isProfileGreetingServiceEnabled(profile, type)) {
      throw new HttpsError(
        "failed-precondition",
        "This service is not enabled for this profile."
      );
    }

    priceSnapshot = getOfferingPrice(profile.offerings, type);
    greetingBase = {
      groupId: null,
      profileUserId,
      profileDisplayName: buildUserDisplayName(profile, profileUserId),
      profileUsername: profile.handle ?? null,
      creatorId,
      buyerId,
      type,
      toName,
      instructions,
      source,
      requestSource: "profile",
      status: "pending" as GreetingStatus,
      priceSnapshot,
      currency: SETTLEMENT_CURRENCY,
      paymentMode: "stripe",
      allowCreatorStory,
    };
  } else {
    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId is required.");
    }

    const [groupSnap, memberSnap] = await Promise.all([
      tx.get(db.doc(`groups/${groupId}`)),
      tx.get(db.doc(`groups/${groupId}/members/${buyerId}`)),
    ]);

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "Group not found.");
    }

    const group = (groupSnap.data() ?? {}) as GroupShape;
    const ownerId = group?.ownerId;

    if (!ownerId) {
      throw new HttpsError("failed-precondition", "La comunidad no tiene creador configurado.");
    }

    if (buyerId === ownerId) {
      throw new HttpsError(
        "failed-precondition",
        "El creador no puede comprar su propio saludo."
      );
    }

    if (!memberSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "You must be a member of the group to request a greeting."
      );
    }

    if (!canBuyerRequestByMembership(memberSnap.data())) {
      throw new HttpsError(
        "permission-denied",
        "Your membership status does not allow requesting this service."
      );
    }

    if (!isGreetingServiceEnabled(group, type)) {
      throw new HttpsError(
        "failed-precondition",
        "This service is not enabled for this group."
      );
    }

    creatorId = ownerId;
    priceSnapshot = getOfferingPrice(group.offerings, type);
    greetingBase = {
      groupId,
      profileUserId: null,
      creatorId,
      buyerId,
      type,
      toName,
      instructions,
      source,
      requestSource: "group",
      status: "pending" as GreetingStatus,
      priceSnapshot,
      currency: SETTLEMENT_CURRENCY,
      paymentMode: "stripe",
      allowCreatorStory,
    };
  }

  // El cobro exige un precio positivo (servicio monetizado).
  if (typeof priceSnapshot !== "number" || priceSnapshot <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Este servicio no tiene un precio configurado."
    );
  }

  tx.set(intentRef, {
    externalReference,
    serviceType: type === "consejo" ? "advice" : "greeting",
    sourceType: "greetingRequest",
    sourceId: greetingId,
    buyerId,
    creatorId,
    grossAmount: priceSnapshot,
    currency: SETTLEMENT_CURRENCY,
    status: "awaiting_payment",
    // Datos del saludo a materializar cuando el pago apruebe.
    pendingGreeting: greetingBase,
    mpOrderId: null,
    mpPaymentId: null,
    createdAt: now,
    updatedAt: now,
  });

  return { requestId: greetingId, creatorId, priceSnapshot };
});

  logger.info("createGreetingRequest created", {
  groupId,
  profileUserId,
  buyerId,
  type,
  source,
  requestId: result.requestId,
});

    return {
      ok: true,
      requestId: result.requestId,
      creatorId: result.creatorId,
      priceSnapshot: result.priceSnapshot ?? null,
      source,
      requestSource: source,
      groupId,
      profileUserId,
    };
  }
);

// 2) Crear URL de subida directa a Mux para una solicitud de saludo/consejo
export const createGreetingMuxUpload = onCall(
  {
    region: "us-central1",
    cors: true,
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const actorId = auth.uid;
    // Subir a Mux cuesta factura: no se le concede a una cuenta suspendida
    // aunque su token todavía no haya caducado.
    await assertAccountNotBanned(actorId);

    const greetingRequestId = assertString(request.data?.greetingRequestId, "greetingRequestId", 200);

    const reqRef = db.doc(`greetingRequests/${greetingRequestId}`);
    const reqSnap = await reqRef.get();

    if (!reqSnap.exists) {
      throw new HttpsError("not-found", "Greeting request not found.");
    }

    const gr = reqSnap.data() as {
      creatorId?: string;
      status?: string;
      videoStatus?: string;
    };

    if (gr.creatorId !== actorId) {
      throw new HttpsError(
        "permission-denied",
        "Only the creator can upload video for this request."
      );
    }

    const allowedStatuses = ["pending", "accepted", "uploading"];
    if (!allowedStatuses.includes(gr.status ?? "")) {
      throw new HttpsError(
        "failed-precondition",
        `Request status "${gr.status}" does not allow video upload.`
      );
    }

    const mux = createMuxClient();

    let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;

    try {
      upload = await mux.video.uploads.create({
        cors_origin: "*",
        new_asset_settings: {
          playback_policy: ["public"],
          mp4_support: "standard",
          passthrough: JSON.stringify({
            contextType: "greeting",
            greetingRequestId,
            creatorId: actorId,
          }),
        },
      });
    } catch (error) {
      logger.error("createGreetingMuxUpload Mux upload creation failed", {
        greetingRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError("internal", "No se pudo crear la subida de video.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      uploadUrlCreated: true,
      contextType: "greeting",
      greetingRequestId,
      authorId: actorId,
      status: "waiting_for_upload",
      assetId: null,
      playbackId: null,
      createdAt: now,
      updatedAt: now,
    });

    await reqRef.update({
      videoStatus: "uploading",
      muxUploadId: upload.id,
      updatedAt: now,
    });

    logger.info("createGreetingMuxUpload created", {
      greetingRequestId,
      uploadId: upload.id,
      actorId,
    });

    return {
      uploadId: upload.id,
      uploadUrl: upload.url,
    };
  }
);

// 3) Responder solicitud (owner): accepted / rejected
export const respondGreetingRequest = onCall(
  {
    region: "us-central1",
    cors: true,
    secrets: [stripeSecretKey],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const actorId = auth.uid;

    const requestId = assertString(request.data?.requestId, "requestId", 200);
    const action = assertOneOf<"accept" | "reject">(
      request.data?.action,
      "action",
      ["accept", "reject"]
    );

    const reqRef = db.doc(`greetingRequests/${requestId}`);
    const externalReference = `greetingRequest__${requestId}`;

    // Pre-lectura para validar y conocer el estado del pago (hold vs cobrado). La
    // captura/cancelación son llamadas a Stripe → van FUERA de la transacción.
    const preSnap = await reqRef.get();
    if (!preSnap.exists) throw new HttpsError("not-found", "Greeting request not found.");
    const pre = preSnap.data() as { creatorId?: string; buyerId?: string; status?: string; paymentStatus?: string; type?: string; groupId?: string | null };
    if (pre.creatorId !== actorId) {
      throw new HttpsError("permission-denied", "Only the creator can respond to this request.");
    }
    if (pre.status !== "pending") {
      throw new HttpsError("failed-precondition", "Request is not pending.");
    }

    // Auth-hold: NO existe "cobrar al aceptar". El saludo se cobra cuando el creador lo
    // GRABA y envía (materializa el asset → status "delivered" → captura, en muxWebhooks).
    // Aquí solo, si RECHAZA y el hold sigue retenido (no capturado), se CANCELA → $0
    // comisión. Si ya estaba capturado (respaldo del día 5), no hay hold que liberar y el
    // dinero queda en la plataforma para que el comprador pueda pedir devolución (B5).
    if (action === "reject" && pre.paymentStatus === "authorized") {
      // ⚠️ SE COMPRUEBA el resultado, no es best-effort. `cancelPaymentIntentForRef`
      // devuelve `alreadyCaptured` justo para esto: entre la lectura previa y esta línea
      // el hold pudo capturarse (el respaldo del día 6, o el webhook de Mux al entregar),
      // y `paymentStatus` todavía decir "authorized" por el retraso del webhook.
      //
      // Si se devolvía el saldo sin comprobar, el comprador se quedaba con el crédito Y
      // con el cobro capturado, y encima veía "Devuelto a tu tarjeta" por un dinero que
      // nunca volvió. Cuando el cobro ya se capturó, la vía correcta es la devolución
      // (`refund_requested` → crédito), no revertir la reserva.
      const { canceled, alreadyCaptured } = await cancelPaymentIntentForRef(externalReference);
      // 🧾 El documento tiene que reflejar lo que pasó en Stripe. Antes se cancelaba la
      // retención y `paymentStatus` se quedaba en "authorized", así que para el resto del
      // sistema el cobro seguía vivo: el barrido del día 6 lo recogía en cada pasada y el
      // botón de «pedir devolución» seguía ofreciéndose por un dinero ya devuelto.
      if (canceled) {
        await reqRef.update({
          paymentStatus: "canceled",
          holdCanceledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      if (!canceled) {
        logger.warn("greeting_reject_hold_no_cancelado", {
          requestId,
          alreadyCaptured,
          nota: "no se devuelve el saldo ni se marca como devuelto; va por la vía de devolución",
        });
      }
      // Si el comprador pagó parte con SALDO A FAVOR, se le devuelve (el hold no se cobró).
      if (canceled && pre.buyerId) await revertBuyerCreditSpend(pre.buyerId, { sourceType: "greetingRequest", sourceId: requestId });
      // Se refleja en Entregados → "Todo" como "Devuelto a tu tarjeta" (nunca se cobró).
      if (canceled && pre.buyerId) {
        await mirrorCardReturnPurchase({
          buyerId: pre.buyerId,
          creatorId: actorId,
          sourceType: "greetingRequest",
          sourceId: requestId,
          type: pre.type === "consejo" ? "advice" : "greeting",
          channelType: pre.groupId ? "group" : "profile",
          channelId: pre.groupId ?? null,
        });
      }
    }

    await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) {
        throw new HttpsError("not-found", "Greeting request not found.");
      }

      const gr = reqSnap.data() as {
        creatorId?: string;
        status?: GreetingStatus | string;
      };

      if (gr.creatorId !== actorId) {
        throw new HttpsError(
          "permission-denied",
          "Only the creator can respond to this request."
        );
      }

      if (gr.status !== "pending") {
        throw new HttpsError("failed-precondition", "Request is not pending.");
      }

      const newStatus: GreetingStatus =
        action === "accept" ? "accepted" : "rejected";

      tx.update(reqRef, {
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedBy: actorId,
        ...(newStatus === "accepted"
          ? { acceptedAt: admin.firestore.FieldValue.serverTimestamp() }
          : { rejectedAt: admin.firestore.FieldValue.serverTimestamp() }),
      });
    });

    logger.info("respondGreetingRequest updated", {
      requestId,
      actorId,
      action,
    });

    return { ok: true };
  }
);

// Comprador pide DEVOLUCIÓN de un saludo/consejo RECHAZADO. Pasa a "refund_requested" →
// el trigger del ledger revierte al creador (como DEVOLUCIÓN) y emite el SALDO A FAVOR al
// comprador por el total pagado (solo si el dinero se había capturado). Solo el comprador.
export const requestGreetingRefund = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "You must be signed in.");

    const requestId = assertString(request.data?.requestId, "requestId", 200);
    const refundReason = request.data?.refundReason
      ? String(request.data.refundReason).slice(0, 1000)
      : null;

    const reqRef = db.doc(`greetingRequests/${requestId}`);

    let creatorId = "";
    let wasPaid = false;
    // El hold sigue vivo: no se cobró nada y hay que liberarlo (fuera de la transacción,
    // porque hablar con Stripe dentro de una transacción de Firestore no es válido).
    let seguiaEnHold = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) throw new HttpsError("not-found", "Greeting request not found.");
      const gr = snap.data() as { buyerId?: string; creatorId?: string; status?: string; paymentStatus?: string };

      if (gr.buyerId !== uid) {
        throw new HttpsError("permission-denied", "No eres el comprador de esta solicitud.");
      }
      if (gr.status !== "rejected") {
        throw new HttpsError("failed-precondition", "La solicitud no es elegible para devolución.");
      }
      // El dinero ya volvió (retención liberada o cobro devuelto): no hay nada que devolver.
      if (PAGO_YA_DEVUELTO.includes(String(gr.paymentStatus ?? ""))) {
        throw new HttpsError(
          "failed-precondition",
          "El pago de esta solicitud ya fue devuelto."
        );
      }
      creatorId = String(gr.creatorId ?? "");
      wasPaid = gr.paymentStatus === "paid";
      seguiaEnHold = gr.paymentStatus === "authorized";

      tx.update(reqRef, {
        status: "refund_requested" as GreetingStatus,
        refundReason,
        refundRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // 💸 DENTRO DE LA VENTANA DEL HOLD no se cobró nada, así que no hay nada que devolver:
    // se LIBERA la retención y se acabó. Ni saldo a favor, ni solicitud al panel, ni
    // comisión de Stripe — el dinero nunca salió de la tarjeta del comprador.
    //
    // ⚠️ Antes esta rama no existía: con el hold vivo, pedir devolución solo cambiaba el
    // estado. La retención seguía en pie y el respaldo del día 6 acababa cobrándola.
    if (seguiaEnHold) {
      await liberarHoldMuerto(reqRef, requestId, "refund_requested");
    }

    // Devolución → SALDO A FAVOR (síncrono; el trigger es respaldo). Solo si hubo cargo.
    let credited = 0;
    if (wasPaid && creatorId) {
      credited = await refundExperienceToCredit({
        buyerId: uid,
        creatorId,
        sourceType: "greetingRequest",
        sourceId: requestId,
      });
    }

    logger.info("requestGreetingRefund", { requestId, buyerId: uid, credited });
    return { ok: true, credited };
  }
);

// Día en que se CAPTURA la retención (auth-hold) como respaldo si el creador aún no la
// cobró grabando el saludo. El hold de tarjeta expira ~7 días en Stripe, así que se
// captura al 6º día (el cron corre cada 6 h → margen antes de que expire). NO es la
// ventana de entrega (esa es 60 días); es solo el respaldo interno de captura.
export const HOLD_CAPTURE_DAYS = 6;
// (Legacy: algunos módulos aún importan este nombre; queda como alias del respaldo.)
export const GREETING_RESPONSE_DAYS = HOLD_CAPTURE_DAYS;

/**
 * Estados en los que la experiencia YA NO se va a entregar.
 *
 * `paymentStatus` no lo dice: sigue en "authorized" aunque el creador haya rechazado o
 * nadie se haya conectado. Por eso el respaldo del día 6 tiene que mirar `status`.
 */
/**
 * Estados de pago en los que el dinero YA volvió al comprador: la retención se liberó
 * (`canceled`) o el cobro se devolvió a saldo (`refunded`). Pedir devolución sobre esto
 * no tiene nada que devolver, y dejarlo pasar movía la experiencia a «en devolución» —
 * perdiendo el «intentar de nuevo»— por un dinero que el comprador ya tenía.
 */
const PAGO_YA_DEVUELTO = ["canceled", "refunded"];

const ESTADOS_SIN_ENTREGA = [
  "rejected",
  "auto_rejected_no_show",
  "refund_requested",
];

/**
 * Libera el hold de una experiencia que ya no se va a entregar y lo deja anotado.
 *
 * ⚠️ Se COMPRUEBA el resultado. Si entre medias se hubiera capturado, no se toca nada más:
 * la vía correcta con el cobro ya hecho es la devolución a saldo, no fingir que se liberó.
 */
async function liberarHoldMuerto(
  ref: FirebaseFirestore.DocumentReference,
  id: string,
  estado: string
) {
  const ahora = admin.firestore.Timestamp.now();
  try {
    const { canceled, alreadyCaptured } = await cancelPaymentIntentForRef(
      `greetingRequest__${id}`
    );
    if (canceled) {
      await ref.update({
        paymentStatus: "canceled",
        holdCanceledAt: ahora,
        updatedAt: ahora,
      });
      logger.info("hold_liberado_sin_entrega", { id, estado, sourceType: "greetingRequest" });
      return;
    }
    logger.warn("hold_no_liberado_sin_entrega", { id, estado, alreadyCaptured });
  } catch (e) {
    logger.error("hold_liberar_fallo", {
      id,
      estado,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function autoExpirePendingGreetingRequestsHandler(): Promise<number> {
  // Respaldo del hold: captura las retenciones aún "authorized" cercanas a expirar
  // (Stripe las libera a los ~7 días). NO cambia el status: el creador conserva su ventana
  // para grabar o rechazar; esto solo ASEGURA el dinero. El cobro normal ocurre al grabar.
  //
  // ⚠️ Se capturan las que SIGUEN VIVAS. Antes se capturaba «sin importar el status», y eso
  // se llevaba por delante las rechazadas y las que ya tenían devolución pedida: el
  // comprador acababa pagando en firme algo que nadie iba a entregarle, y para recuperarlo
  // tenía que pedir devolución y conformarse con saldo a favor. Ver `ESTADOS_SIN_ENTREGA`.
  const snap = await db
    .collection("greetingRequests")
    .where("paymentStatus", "==", "authorized")
    .limit(500)
    .get();
  if (snap.empty) return 0;

  const cutoffMs = Date.now() - HOLD_CAPTURE_DAYS * 24 * 60 * 60 * 1000;
  const now = admin.firestore.Timestamp.now();
  let captured = 0;

  await Promise.all(
    snap.docs.map(async (doc) => {
      const createdMs = doc.get("createdAt")?.toMillis?.() ?? 0;
      if (createdMs > cutoffMs) return; // aún dentro de la ventana: no capturar todavía

      // 🚨 NO capturar lo que ya está muerto.
      //
      // La consulta filtra solo por `paymentStatus == "authorized"`, y ese campo sigue
      // diciendo "authorized" en una experiencia RECHAZADA automáticamente (nadie se
      // conectó, el creador nunca contestó) o con devolución ya pedida. Sin esta salida,
      // el respaldo del día 6 cobraba en firme algo que no se iba a entregar: el
      // comprador acababa pagando una experiencia que nunca ocurrió y encima tenía que
      // pedir devolución para recuperarlo, ya solo como saldo a favor.
      //
      // El hold de estos se libera solo, más abajo.
      const estado = String(doc.get("status") ?? "");
      if (ESTADOS_SIN_ENTREGA.includes(estado)) {
        await liberarHoldMuerto(doc.ref, doc.id, estado);
        return;
      }
      try {
        await capturePaymentIntentForRef(`greetingRequest__${doc.id}`);
        await doc.ref.update({
          paymentStatus: "paid", // dispara recordEarning (pending) vía onGreetingLedger
          paidAt: now,
          holdCapturedAt: now,
          updatedAt: now,
        });
        captured++;
      } catch (e) {
        logger.error("greeting_hold_capture_failed", {
          id: doc.id,
          err: e instanceof Error ? e.message : String(e),
        });
        await doc.ref.update({ holdCaptureFailedAt: now, updatedAt: now });
      }
    })
  );

  logger.info("greeting_holds_captured", { captured, scanned: snap.size });
  return captured;
}

// Ventana de ENTREGA: días que tiene el creador para grabar/entregar (desde la compra)
// antes de que la experiencia YA COBRADA se marque RECHAZADA en automático — el mismo
// estado terminal que un rechazo manual, así el comprador puede pedir su devolución →
// crédito. Debe coincidir con el frontend (GREETING_RESPONSE_DAYS del overlay del comprador).
export const DELIVERY_WINDOW_DAYS = 60;

export async function autoRejectUndeliveredGreetingRequestsHandler(): Promise<number> {
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  );
  const snap = await db
    .collection("greetingRequests")
    .where("paymentStatus", "==", "paid")
    .where("createdAt", "<=", cutoff)
    .limit(200)
    .get();
  if (snap.empty) return 0;

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();
  let n = 0;
  snap.docs.forEach((doc) => {
    const status = String(doc.get("status") ?? "");
    // Solo las YA COBRADAS y aún SIN entregar (no terminales).
    if (["delivered", "rejected", "refund_requested", "refund_review"].includes(status)) return;
    batch.update(doc.ref, {
      status: "rejected" as GreetingStatus,
      rejectionReason: "El creador no entregó dentro de los 60 días.",
      autoRejectedNoDeliveryAt: now,
      rejectedAt: now,
      updatedAt: now,
    });
    n++;
  });
  if (n > 0) await batch.commit();
  logger.info("auto_reject_undelivered_greetings", { rejected: n, scanned: snap.size });
  return n;
}