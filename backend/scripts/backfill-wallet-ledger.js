/**
 * Backfill del libro mayor de wallet: procesa las VENTAS PASADAS de los 10
 * servicios ya cableados y las registra en el ledger según su estado actual.
 *
 * - Idempotente: usa los MISMOS sourceType/sourceId que los triggers, así que
 *   no dobla ganancias aunque un trigger ya haya procesado un registro.
 * - Reutiliza los helpers compilados (backend/lib/wallet/ledger.js) para que la
 *   lógica y el resumen sean idénticos a los triggers.
 *
 * Uso:
 *   node scripts/backfill-wallet-ledger.js            # DRY RUN (solo cuenta)
 *   DRY_RUN=false node scripts/backfill-wallet-ledger.js   # ejecuta de verdad
 */

const fs = require("fs");
const path = require("path");

// ── Credenciales admin desde el .env.local de la raíz ───────────────────────
const envPath = path.join(__dirname, "..", "..", ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const clean = (v) => (v || "").replace(/^["']|["']$/g, "");

const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: clean(env.FIREBASE_PROJECT_ID),
    clientEmail: clean(env.FIREBASE_CLIENT_EMAIL),
    privateKey: clean(env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();
// Se requiere DESPUÉS de initializeApp para que el ledger use esta credencial.
const { recordEarning, settleEarning, reverseEarning, stampOccurredAt, stampChannel } = require("../lib/wallet/ledger.js");

const DRY = process.env.DRY_RUN !== "false";
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v : null);
// Canal de la venta: si hay groupId → comunidad; si no → perfil.
const channelFromGroupId = (groupId) =>
  groupId
    ? { channelType: "group", channelId: groupId }
    : { channelType: "profile", channelId: null };
// Fecha real de la venta (del doc de origen) como Date.
const toJsDate = (v) => {
  if (v && typeof v.toDate === "function") { try { return v.toDate(); } catch { return null; } }
  if (v instanceof Date) return v;
  return null;
};
// Registra + sella fecha real y canal en la entrada (nueva o ya existente).
async function record(creatorId, params, occurredDate, channel) {
  if (DRY) return;
  await recordEarning(creatorId, {
    ...params,
    occurredAt: occurredDate || undefined,
    ...(channel || {}),
  });
  if (occurredDate) {
    await stampOccurredAt(creatorId, params.sourceType, params.sourceId, occurredDate);
  }
  if (channel) {
    await stampChannel(creatorId, params.sourceType, params.sourceId, channel.channelType, channel.channelId);
  }
}

const stats = {};
function tally(service, kind, gross) {
  if (!stats[service]) stats[service] = { earned: 0, pending: 0, reversed: 0, gross: 0 };
  stats[service][kind] += 1;
  stats[service].gross += gross;
}

const postAuthorCache = new Map();
async function getPostAuthor(postRef) {
  if (postAuthorCache.has(postRef.path)) return postAuthorCache.get(postRef.path);
  const snap = await postRef.get();
  const data = snap.exists ? snap.data() : null;
  postAuthorCache.set(postRef.path, data);
  return data;
}

// ── Grupo A: cuentan como ganado al pagar ───────────────────────────────────

async function backfillSuperComments() {
  const snap = await db.collectionGroup("superComments").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.status !== "paid") continue;
    const gross = num(d.amount);
    if (gross <= 0) continue;
    const postRef = doc.ref.parent.parent;
    if (!postRef) continue;
    const post = await getPostAuthor(postRef);
    const authorId = str(post && post.authorId);
    if (!authorId) continue;
    const hasText = str(d.text) !== null;
    const service = hasText ? "supercomment" : "live_donation";
    tally(service, "earned", gross);
    await record(
      authorId,
      {
        type: hasText ? "supercomment" : "live_donation",
        grossAmount: gross,
        sourceType: "superComment",
        sourceId: `${postRef.id}_${doc.id}`,
        buyerId: str(d.userId) || str(d.guestId),
        earnedImmediately: true,
      },
      toJsDate(d.createdAt),
      channelFromGroupId(str(post && post.groupId))
    );
  }
}

async function backfillLiveAccess() {
  const liveDocs = await db.collection("liveAccess").get();
  for (const live of liveDocs.docs) {
    const users = await live.ref.collection("users").get();
    for (const u of users.docs) {
      const d = u.data();
      if (d.status !== "paid") continue;
      const gross = num(d.amount);
      const authorId = str(d.authorId);
      if (gross <= 0 || !authorId) continue;
      tally("live_ticket", "earned", gross);
      await record(
        authorId,
        {
          type: "live_ticket",
          grossAmount: gross,
          sourceType: "liveAccess",
          sourceId: `${live.id}_${u.id}`,
          buyerId: u.id,
          earnedImmediately: true,
        },
        toJsDate(d.createdAt),
        channelFromGroupId(str(d.groupId))
      );
    }
  }
}

async function backfillPostAccess() {
  const snap = await db.collection("postAccess").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.status !== "active") continue;
    const postId = str(d.postId);
    if (!postId) continue;
    const post = await getPostAuthor(db.collection("posts").doc(postId));
    const creatorId = str(d.creatorId) || str(post && post.authorId);
    if (!creatorId) continue;
    let gross = num(d.price);
    if (gross <= 0 && post && post.premium) gross = num(post.premium.oneTimePrice);
    if (gross <= 0) continue;
    const isVod = !!(post && post.liveData != null);
    const service = isVod ? "vod_ticket" : "premium_post";
    tally(service, "earned", gross);
    await record(
      creatorId,
      {
        type: isVod ? "vod_ticket" : "premium_post",
        grossAmount: gross,
        sourceType: "postAccess",
        sourceId: doc.id,
        buyerId: str(d.buyerId),
        earnedImmediately: true,
      },
      toJsDate(d.createdAt),
      channelFromGroupId(str(d.groupId) || str(post && post.groupId))
    );
  }
}

async function backfillSubscriptions() {
  // Se usa el doc de membresía del USUARIO (users/{uid}/groupMemberships/{groupId})
  // porque ese sí trae ownerId. Sin where() para no requerir índice.
  const snap = await db.collectionGroup("groupMemberships").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.accessType !== "subscription" || d.subscriptionActive !== true) continue;
    const ownerId = str(d.ownerId);
    const gross = num(d.subscriptionPriceMonthly);
    const userRef = doc.ref.parent.parent; // users/{uid}
    if (!ownerId || gross <= 0 || !userRef) continue;
    const uid = userRef.id;
    const groupId = doc.id;
    if (ownerId === uid) continue;
    tally("subscription", "earned", gross);
    await record(
      ownerId,
      {
        type: "subscription",
        grossAmount: gross,
        sourceType: "groupSubscription",
        sourceId: `${groupId}_${uid}`,
        buyerId: uid,
        earnedImmediately: true,
      },
      toJsDate(d.subscribedAt || d.joinedAt || d.updatedAt),
      { channelType: "group", channelId: groupId }
    );
  }
}

async function backfillProfileDonations() {
  const snap = await db.collection("profileDonations").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const paid = d.paymentStatus === "simulated_paid" || d.paymentStatus === "paid";
    if (!paid) continue;
    const gross = num(d.amount);
    const creatorId = str(d.creatorId);
    const buyerId = str(d.buyerId);
    if (!creatorId || gross <= 0) continue;
    if (buyerId === creatorId) continue;
    tally("profile_donation", "earned", gross);
    await record(
      creatorId,
      {
        type: "profile_donation",
        grossAmount: gross,
        sourceType: "profileDonation",
        sourceId: doc.id,
        buyerId,
        earnedImmediately: true,
      },
      toJsDate(d.createdAt),
      { channelType: "profile", channelId: null }
    );
  }
}

// ── Grupo B: pendiente al pagar → ganado al entregar/concluir ────────────────

async function backfillRequests(opts) {
  const snap = await db.collection(opts.collection).get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const isPaid = d.paymentStatus === "simulated_paid" || d.paymentStatus === "paid";
    if (!isPaid) continue;
    const creatorId = str(d.creatorId);
    const gross = num(d.priceSnapshot);
    if (!creatorId || gross <= 0) continue;

    const status = String(d.status || "");
    const service = opts.resolveType(d);
    const delivered = opts.deliveredStatuses.includes(status);
    const reversed = opts.reversedStatuses.includes(status);
    tally(service, delivered ? "earned" : reversed ? "reversed" : "pending", gross);

    await record(
      creatorId,
      {
        type: service,
        grossAmount: gross,
        sourceType: opts.sourceType,
        sourceId: doc.id,
        buyerId: str(d.buyerId),
        earnedImmediately: false,
      },
      toJsDate(d.createdAt),
      channelFromGroupId(str(d.groupId))
    );
    if (!DRY && delivered) {
      await settleEarning(creatorId, opts.sourceType, doc.id);
    } else if (!DRY && reversed) {
      await reverseEarning(creatorId, opts.sourceType, doc.id);
    }
  }
}

async function main() {
  console.log(`\n=== BACKFILL WALLET LEDGER ${DRY ? "(DRY RUN — no escribe)" : "(EJECUTANDO)"} ===\n`);

  await backfillSuperComments();
  await backfillLiveAccess();
  await backfillPostAccess();
  await backfillSubscriptions();
  await backfillProfileDonations();

  await backfillRequests({
    collection: "greetingRequests",
    sourceType: "greetingRequest",
    resolveType: (d) => (d.type === "consejo" ? "advice" : "greeting"),
    deliveredStatuses: ["delivered"],
    reversedStatuses: ["rejected", "refund_requested"],
  });
  await backfillRequests({
    collection: "exclusiveSessionRequests",
    sourceType: "exclusiveSessionRequest",
    resolveType: () => "exclusive_session",
    deliveredStatuses: ["completed"],
    reversedStatuses: ["rejected", "refund_requested"],
  });
  await backfillRequests({
    collection: "meetGreetRequests",
    sourceType: "meetGreetRequest",
    resolveType: () => "live_session",
    deliveredStatuses: ["completed"],
    reversedStatuses: ["rejected", "refund_requested"],
  });

  console.log("Servicio            | ganado | pendiente | revertido | bruto total MXN");
  console.log("--------------------|--------|-----------|-----------|----------------");
  let totalGross = 0;
  for (const [svc, s] of Object.entries(stats)) {
    totalGross += s.gross;
    console.log(
      `${svc.padEnd(19)} | ${String(s.earned).padStart(6)} | ${String(s.pending).padStart(9)} | ${String(s.reversed).padStart(9)} | ${s.gross.toFixed(2).padStart(15)}`
    );
  }
  console.log(`\nBruto total procesado: $${totalGross.toFixed(2)} MXN  (neto ≈ $${(totalGross * 0.77).toFixed(2)} MXN)`);
  console.log(DRY ? "\n(DRY RUN — no se escribió nada. Corre con DRY_RUN=false para ejecutar.)\n" : "\n✅ Backfill ejecutado.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Error en backfill:", e);
  process.exit(1);
});
