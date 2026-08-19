/**
 * Muestras de saludo y consejo.
 *
 * Un creador que acaba de activar el servicio no tiene nada que enseñar: su
 * vitrina está en cero y el comprador no sabe qué va a recibir. Una MUESTRA es
 * un saludo o consejo que el propio creador graba, con un contexto de ejemplo
 * escrito por él, para llenar ese hueco.
 *
 * 🚨 POR QUÉ NO REUSA `greetingRequests` 🚨
 * Sería el atajo obvio —crear una solicitud ficticia y grabar contra ella— y es
 * exactamente lo que no se debe hacer. Esa colección mueve dinero: tiene captura
 * de cobro, plazos de entrega, reembolsos, no-show y notificaciones al
 * comprador. De hecho el webhook de Mux, al ver `contextType: "greeting"`,
 * CAPTURA el pago (`capturePaymentIntentForRef`). Una muestra por ahí intentaría
 * cobrar algo que no existe.
 *
 * Por eso las muestras viven en su propia colección y viajan a Mux con su propio
 * `contextType`, sin rozar nada de pagos.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";
import { assertAccountNotBanned } from "./accountStatus";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

type SampleType = "saludo" | "consejo";
type SampleSource = "profile" | "group";

/** Tope del contexto de ejemplo. Es una petición corta, no un ensayo. */
const MAX_CONTEXT_LENGTH = 500;

/**
 * Cuántas muestras puede tener un creador por servicio y superficie.
 *
 * No es una restricción de producto caprichosa: cada muestra es un asset de Mux
 * que se factura y se almacena para siempre. Sin tope, un creador puede subir
 * cien videos gratis por servicio.
 */
const MAX_SAMPLES_PER_SERVICE = 5;

function assertString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `Falta ${field}.`);
  }
  const clean = value.trim();
  if (clean.length > max) {
    throw new HttpsError("invalid-argument", `${field} es demasiado largo.`);
  }
  return clean;
}

/**
 * Prepara la subida de una muestra: crea el documento y devuelve la URL de Mux.
 *
 * El `playbackId` no llega aquí — lo escribe el webhook cuando Mux termina de
 * procesar. Hasta entonces la muestra queda en `processing`.
 */
export const createGreetingSampleUpload = onCall(
  {
    region: "us-central1",
    cors: true,
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const creatorId = auth.uid;

    // Subir a Mux cuesta factura: no se le concede a una cuenta suspendida
    // aunque su token todavía no haya caducado.
    await assertAccountNotBanned(creatorId);

    const rawType = request.data?.type;
    if (rawType !== "saludo" && rawType !== "consejo") {
      throw new HttpsError("invalid-argument", "Tipo de muestra inválido.");
    }
    const type = rawType as SampleType;

    const rawSource = request.data?.source;
    if (rawSource !== "profile" && rawSource !== "group") {
      throw new HttpsError("invalid-argument", "Origen de muestra inválido.");
    }
    const source = rawSource as SampleSource;

    const groupId =
      source === "group"
        ? assertString(request.data?.groupId, "groupId", 200)
        : null;

    const rawToName = request.data?.toName;
    const toName =
      typeof rawToName === "string" && rawToName.trim()
        ? assertString(rawToName, "toName", 120)
        : null;

    // El contexto es opcional al crear: el creador puede escribirlo después,
    // desde "Agregar contexto".
    const rawContext = request.data?.context;
    const context =
      typeof rawContext === "string" && rawContext.trim()
        ? assertString(rawContext, "context", MAX_CONTEXT_LENGTH)
        : null;

    // Solo el dueño puede poner muestras en una comunidad.
    if (source === "group" && groupId) {
      const groupSnap = await db.doc(`groups/${groupId}`).get();
      if (!groupSnap.exists) {
        throw new HttpsError("not-found", "La comunidad no existe.");
      }
      if (groupSnap.get("ownerId") !== creatorId) {
        throw new HttpsError(
          "permission-denied",
          "Solo el creador puede agregar muestras a esta comunidad."
        );
      }
    }

    const scopeKey = source === "group" ? groupId : creatorId;

    const existing = await db
      .collection("greetingSamples")
      .where("creatorId", "==", creatorId)
      .where("type", "==", type)
      .where("scopeKey", "==", scopeKey)
      .where("isDeleted", "==", false)
      .count()
      .get();

    if (existing.data().count >= MAX_SAMPLES_PER_SERVICE) {
      throw new HttpsError(
        "resource-exhausted",
        `Puedes tener hasta ${MAX_SAMPLES_PER_SERVICE} muestras de este servicio.`
      );
    }

    const sampleRef = db.collection("greetingSamples").doc();
    const mux = createMuxClient();

    let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;

    try {
      upload = await mux.video.uploads.create({
        cors_origin: "*",
        new_asset_settings: {
          playback_policy: ["public"],
          mp4_support: "standard",
          // `contextType` propio: el webhook NO debe tratarlo como un saludo
          // real ni tocar cobros.
          passthrough: JSON.stringify({
            contextType: "greeting_sample",
            sampleId: sampleRef.id,
            creatorId,
          }),
        },
      });
    } catch (error) {
      logger.error("createGreetingSampleUpload: Mux falló", {
        creatorId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError("internal", "No se pudo crear la subida de video.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await sampleRef.set({
      creatorId,
      type,
      source,
      groupId,
      scopeKey,
      toName,
      context,
      provider: "mux",
      muxUploadId: upload.id,
      muxAssetId: null,
      muxPlaybackId: null,
      videoDuration: null,
      status: "uploading",
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      uploadUrlCreated: true,
      contextType: "greeting_sample",
      sampleId: sampleRef.id,
      authorId: creatorId,
      status: "waiting_for_upload",
      assetId: null,
      playbackId: null,
      createdAt: now,
      updatedAt: now,
    });

    logger.info("createGreetingSampleUpload creado", {
      sampleId: sampleRef.id,
      uploadId: upload.id,
      creatorId,
      type,
      source,
    });

    return {
      sampleId: sampleRef.id,
      uploadId: upload.id,
      uploadUrl: upload.url,
    };
  }
);

/** Escribe o corrige el contexto de ejemplo de una muestra. */
export const updateGreetingSampleContext = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const sampleId = assertString(request.data?.sampleId, "sampleId", 200);
    const context = assertString(
      request.data?.context,
      "context",
      MAX_CONTEXT_LENGTH
    );

    const sampleRef = db.doc(`greetingSamples/${sampleId}`);
    const snap = await sampleRef.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "La muestra no existe.");
    }
    if (snap.get("creatorId") !== auth.uid) {
      throw new HttpsError("permission-denied", "No es tu muestra.");
    }

    await sampleRef.update({
      context,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
  }
);

/**
 * Borra una muestra. Marcado lógico, no borrado físico: la historia creada a
 * partir de ella puede seguir viva y se limpia por su propio camino.
 */
export const deleteGreetingSample = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const sampleId = assertString(request.data?.sampleId, "sampleId", 200);
    const sampleRef = db.doc(`greetingSamples/${sampleId}`);
    const snap = await sampleRef.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "La muestra no existe.");
    }
    if (snap.get("creatorId") !== auth.uid) {
      throw new HttpsError("permission-denied", "No es tu muestra.");
    }

    await sampleRef.update({
      isDeleted: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
  }
);
