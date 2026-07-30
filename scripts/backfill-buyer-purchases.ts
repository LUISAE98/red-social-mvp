import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

// Backfill del espejo de compras del COMPRADOR (Opción A).
//
// Recorre TODAS las entradas del libro mayor de los creadores
// (`collectionGroup("walletLedger")`) y refleja cada una que tenga `buyerId` en
// `users/{buyerId}/purchases/{entryId}`, con el MISMO mapeo que el trigger
// `mirrorLedgerToBuyerPurchase` (backend/src/wallet/buyerPurchases.ts).
//
// Es idempotente: usa `set(..., { merge: true })` con el mismo id determinista
// del ledger, así que se puede correr varias veces sin duplicar.
//
// Uso:
//   npx ts-node scripts/backfill-buyer-purchases.ts                 (aplica a TODOS)
//   npx ts-node scripts/backfill-buyer-purchases.ts --dry           (solo cuenta, no escribe)
//   npx ts-node scripts/backfill-buyer-purchases.ts --buyer=<uid>   (solo un comprador; ideal para probar en local)

const PAGE_SIZE = 500;
const BATCH_LIMIT = 400;

function initializeAdmin() {
  if (getApps().length) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ?? process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ?? process.env.FIREBASE_ADMIN_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local"
    );
  }

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

// Estado del ledger (creador) → estado de la compra (comprador). Mismo criterio
// que el trigger: el comprador ya pagó en "pending"/"earned".
function buyerStatusFromLedger(status: unknown): "paid" | "refunded" | "rejected" {
  if (status === "refunded") return "refunded";
  if (status === "rejected") return "rejected";
  return "paid";
}

async function main() {
  const dry = process.argv.includes("--dry");
  const buyerArg = process.argv.find((a) => a.startsWith("--buyer="));
  const onlyBuyer = buyerArg ? buyerArg.replace("--buyer=", "").trim() : null;
  initializeAdmin();
  const db = getFirestore();

  let scanned = 0;
  let mirrored = 0;
  let skippedNoBuyer = 0;
  let last: QueryDocumentSnapshot | null = null;
  let batch = db.batch();
  let batchCount = 0;

  console.log(
    `▶  Backfill de compras del comprador ${onlyBuyer ? `(solo ${onlyBuyer})` : ""} ${dry ? "(DRY-RUN, sin escribir)" : ""}`
  );

  // Paginación por id de documento sobre el collectionGroup.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collectionGroup("walletLedger")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const d = doc.data();
      const buyerId =
        typeof d.buyerId === "string" && d.buyerId.trim().length > 0 ? d.buyerId : null;
      if (!buyerId) {
        skippedNoBuyer += 1;
        continue;
      }
      if (onlyBuyer && buyerId !== onlyBuyer) continue;

      // creatorId: del dato o del padre users/{creatorId}/walletLedger/{id}.
      const creatorId =
        (typeof d.creatorId === "string" && d.creatorId) ||
        doc.ref.parent.parent?.id ||
        null;

      const purchaseRef = db
        .collection("users")
        .doc(buyerId)
        .collection("purchases")
        .doc(doc.id);

      if (!dry) {
        batch.set(
          purchaseRef,
          {
            buyerId,
            creatorId,
            type: d.type ?? null,
            status: buyerStatusFromLedger(d.status),
            grossAmount: typeof d.grossAmount === "number" ? d.grossAmount : 0,
            currency: typeof d.currency === "string" ? d.currency : "USD",
            sourceType: d.sourceType ?? null,
            sourceId: d.sourceId ?? null,
            channelType: d.channelType ?? "profile",
            channelId: d.channelId ?? null,
            liveId: d.liveId ?? null,
            postId: d.postId ?? null,
            taxAmount: typeof d.taxAmount === "number" ? d.taxAmount : 0,
            occurredAt: d.occurredAt ?? d.createdAt ?? null,
            createdAt: d.createdAt ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        batchCount += 1;
        if (batchCount >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      mirrored += 1;
    }

    last = snap.docs[snap.docs.length - 1];
    console.log(`   … escaneadas ${scanned}, espejadas ${mirrored}`);
    if (snap.size < PAGE_SIZE) break;
  }

  if (!dry && batchCount > 0) await batch.commit();

  console.log("");
  console.log(`✅  Listo. Escaneadas: ${scanned} · Espejadas: ${mirrored} · Sin comprador: ${skippedNoBuyer}`);
  if (dry) console.log("   (DRY-RUN: no se escribió nada. Corre sin --dry para aplicar.)");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
