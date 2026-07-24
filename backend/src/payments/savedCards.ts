// Tarjetas guardadas — Mercado Pago Customers & Cards (Bloque 3).
//
// MP custodia la tarjeta tokenizada; nosotros guardamos SOLO referencias
// (mpCustomerId, mpCardId, últimos 4, marca) en `users/{buyerId}/paymentMethods`.
// Cobrar una tarjeta guardada SIEMPRE requiere re-capturar el CVV (MP no lo
// almacena): el cliente genera un token con `createCardToken({ cardId })` + CVV.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { mpFetch } from "./mpClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type MpCustomer = { id?: string };
type MpCard = {
  id?: string;
  last_four_digits?: string;
  payment_method?: { id?: string; name?: string };
};

/** Busca el customer por email; si no existe, lo crea. Devuelve el id o null. */
export async function getOrCreateCustomer(email: string): Promise<string | null> {
  const clean = email.trim();
  if (!clean) return null;

  const search = await mpFetch<{ results?: MpCustomer[] }>(
    `/v1/customers/search?email=${encodeURIComponent(clean)}`
  );
  if (search.ok) {
    const existing = search.data?.results?.[0]?.id;
    if (existing) return existing;
  }

  const created = await mpFetch<MpCustomer>("/v1/customers", {
    method: "POST",
    body: { email: clean },
  });
  if (created.ok && created.data?.id) return created.data.id;

  logger.error("getOrCreateCustomer failed", {
    status: created.ok ? "no_id" : created.status,
  });
  return null;
}

/**
 * Guarda la tarjeta (con un token de guardado) en el customer del comprador y
 * almacena las referencias en Firestore. Best-effort: si falla, solo loguea.
 */
export async function saveCardForBuyer(
  buyerId: string,
  email: string,
  saveToken: string
): Promise<void> {
  if (!email || !saveToken) return;

  const customerId = await getOrCreateCustomer(email);
  if (!customerId) return;

  const res = await mpFetch<MpCard>(`/v1/customers/${customerId}/cards`, {
    method: "POST",
    body: { token: saveToken },
  });
  if (!res.ok || !res.data?.id) {
    logger.warn("saveCardForBuyer: no se pudo guardar la tarjeta", {
      buyerId,
      status: res.ok ? "no_id" : res.status,
    });
    return;
  }

  const card = res.data;
  await db.doc(`users/${buyerId}/paymentMethods/${card.id}`).set(
    {
      buyerId,
      mpCustomerId: customerId,
      mpCardId: card.id,
      lastFour: card.last_four_digits ?? null,
      brand: card.payment_method?.id ?? null,
      brandName: card.payment_method?.name ?? null,
      paymentMethodId: card.payment_method?.id ?? null,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info("saveCardForBuyer saved", { buyerId, cardId: card.id });
}

/** Lee la referencia de una tarjeta guardada del comprador (customer + método). */
export async function getSavedCardRef(
  buyerId: string,
  cardId: string
): Promise<{ mpCustomerId: string; paymentMethodId: string } | null> {
  const snap = await db.doc(`users/${buyerId}/paymentMethods/${cardId}`).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const mpCustomerId = typeof d.mpCustomerId === "string" ? d.mpCustomerId : null;
  const paymentMethodId =
    typeof d.paymentMethodId === "string"
      ? d.paymentMethodId
      : typeof d.brand === "string"
        ? d.brand
        : null;
  if (!mpCustomerId || !paymentMethodId) return null;
  return { mpCustomerId, paymentMethodId };
}
