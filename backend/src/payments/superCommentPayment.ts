// paySuperComment — cobra un supercomentario en vivo con Mercado Pago.
//
// Pagar-luego-crear: se materializa como super-comentario CON texto en
// posts/{postId}/superComments/{scId} al aprobar el pago (reconcile), lo que
// dispara onSuperCommentLedger (earning `supercomment`, porque el texto no va
// vacío) Y lo muestra destacado en el chat del en vivo. El monto es FIJO = precio
// del tier, validado SERVER-SIDE contra la config del live (nunca se confía en el
// precio del cliente). Cada llamada = un supercomentario nuevo.
// Reusa `chargeServiceIntent` (cobra grossAmount).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const MAX_SUPER_COMMENT = 100000; // tope de seguridad (evita errores/abuso)

// Fallback si el live no trae config de supercomentarios (espejo de
// DEFAULT_SUPER_COMMENT_TIERS en lib/liveChat/types.ts). El precio siempre sale de
// aquí o de la config guardada, NUNCA del cliente.
type Tier = { id: string; name: string; maxChars: number; price: number; color: string; displaySeconds: number };
const DEFAULT_TIERS: Tier[] = [
  { id: "t1", name: "Chispa",    maxChars: 60,  price: 15,  color: "#a855f7", displaySeconds: 10 },
  { id: "t2", name: "Llama",     maxChars: 120, price: 35,  color: "#f72fbe", displaySeconds: 15 },
  { id: "t3", name: "Fuego",     maxChars: 240, price: 75,  color: "#3b82f6", displaySeconds: 20 },
  { id: "t4", name: "Explosión", maxChars: 400, price: 150, color: "#facc15", displaySeconds: 25 },
  { id: "t5", name: "Volcán",    maxChars: 600, price: 300, color: "#4ade80", displaySeconds: 30 },
];

function resolveTier(post: Record<string, unknown>, tierId: string): Tier | null {
  const liveData = (post.liveData ?? {}) as Record<string, unknown>;
  const config = (liveData.superCommentConfig ?? {}) as Record<string, unknown>;
  const rawTiers = Array.isArray(config.tiers) && config.tiers.length
    ? (config.tiers as unknown[])
    : DEFAULT_TIERS;
  const found = rawTiers.find(
    (t) => t && typeof t === "object" && (t as Record<string, unknown>).id === tierId
  ) as Record<string, unknown> | undefined;
  if (!found) return null;
  const price = Number(found.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(found.id),
    name: String(found.name ?? "Supercomentario"),
    maxChars: Number(found.maxChars) > 0 ? Number(found.maxChars) : 600,
    price,
    color: String(found.color ?? "#a855f7"),
    displaySeconds: Number(found.displaySeconds) > 0 ? Number(found.displaySeconds) : 15,
  };
}

export const paySuperComment = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    const tierId = String(data.tierId ?? "").trim();
    if (!tierId) throw new HttpsError("invalid-argument", "Falta el nivel del supercomentario.");

    const text = String(data.text ?? "").trim();
    if (!text) throw new HttpsError("invalid-argument", "El supercomentario no puede ir vacío.");

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    // Debe ser un live, para que onSuperCommentLedger atribuya el earning al live (liveId).
    if (!post.liveData && post.postType !== "live") {
      throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) {
      throw new HttpsError("failed-precondition", "No puedes enviarte un supercomentario a ti mismo.");
    }

    // Precio SERVER-AUTHORITATIVE: se resuelve el tier contra la config del live.
    const tier = resolveTier(post, tierId);
    if (!tier) throw new HttpsError("invalid-argument", "Nivel de supercomentario inválido.");
    const amount = tier.price;
    if (amount > MAX_SUPER_COMMENT) {
      throw new HttpsError("failed-precondition", "El precio del supercomentario es demasiado alto.");
    }
    const safeText = text.slice(0, tier.maxChars);

    // Perfil del comprador (para el super-comentario destacado del chat).
    let username = "Anónimo";
    let avatarUrl: string | null = null;
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      username = String(u.displayName ?? u.handle ?? u.username ?? "Anónimo");
      avatarUrl = u.photoURL ? String(u.photoURL) : null;
    }

    // Id único por supercomentario (se pueden enviar varios). Es el id del doc.
    const scId = db.collection("posts").doc(postId).collection("superComments").doc().id;
    const externalReference = `superComment__${postId}_${scId}`;

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: amount,
      sourceType: "superComment",
      sourceId: `${postId}_${scId}`,
      status: "created",
      // Payload = super-comentario CON texto → onSuperCommentLedger lo cuenta como
      // supercomment. `status: "paid"` es OBLIGATORIO (el trigger filtra por él).
      pendingSuperComment: {
        userId: uid,
        username,
        avatarUrl,
        text: safeText,
        tierId: tier.id,
        tierName: tier.name,
        color: tier.color,
        displaySeconds: tier.displaySeconds,
        amount,
        currency: "MXN",
        status: "paid",
        hidden: false,
        isDeleted: false,
        played: false,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return chargeServiceIntent(externalReference, uid, {
      token: String(data.token ?? "").trim(),
      paymentMethodId: String(data.paymentMethodId ?? "").trim(),
      paymentType: String(data.paymentType ?? "credit_card").trim(),
      installments: Number(data.installments),
      payerEmail: String(data.payerEmail ?? request.auth?.token?.email ?? "").trim(),
      saveToken: data.saveToken ? String(data.saveToken).trim() : undefined,
      savedCardId: data.savedCardId ? String(data.savedCardId).trim() : undefined,
      // 🧾 IVA — país fiscal del comprador (por IP en el cliente); el backend suma el IVA.
      taxCountry: data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null,
    });
  }
);
