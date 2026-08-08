import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// VISIBILIDAD DEL POST PREMIUM (monetizable) desde FUERA de la comunidad.
//
// Un post premium con alcance "público" debe poder verse BLOQUEADO por gente de
// fuera —incluidos los deslogueados— para que puedan pagar y desbloquearlo, aun
// cuando la comunidad sea privada o de suscripción. La comunidad OCULTA nunca
// expone nada.
//
// Se prueba la MISMA query que corre la página pública de la comunidad
// (`fetchGroupPublicPostsPage`): groupId + isDeleted + isShareable + createdAt.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra-premium",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8085,
    },
  });
}, 60_000);

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const OWNER = "owner";
const MEMBER = "member";
const OUTSIDER = "outsider";

type Visibility = "public" | "private" | "hidden";

async function seedGroup(groupId: string, visibility: Visibility, subscription = false) {
  await seed(`groups/${groupId}`, {
    ownerId: OWNER,
    visibility,
    isActive: true,
    monetization: subscription
      ? { subscriptionsEnabled: true, subscriptionPriceMonthly: 199 }
      : { subscriptionsEnabled: false },
  });
  await seed(`groups/${groupId}/members/${OWNER}`, {
    userId: OWNER,
    roleInGroup: "owner",
    status: "active",
  });
  await seed(`groups/${groupId}/members/${MEMBER}`, {
    userId: MEMBER,
    roleInGroup: "member",
    status: subscription ? "subscribed" : "active",
  });
}

/** Post premium tal como lo escribe el composer (buildPremiumAccessFields + buildShareMetadata). */
async function seedPremiumPost(params: {
  postId: string;
  groupId: string;
  groupVisibility: Visibility;
  accessMode: "public" | "members_only";
}) {
  await seed(`posts/${params.postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId: params.groupId,
    groupVisibility: params.groupVisibility,
    postType: "video",
    text: "video premium",
    isDeleted: false,
    // isShareable = premium público (ver buildShareMetadata)
    isShareable: params.accessMode === "public" && params.groupVisibility !== "hidden",
    premium: {
      enabled: true,
      kind: "video",
      accessMode: params.accessMode,
      freeFor: "none",
      price: 100,
      currency: "MXN",
      purchaseType: "one_time",
    },
    access: "paid",
    accessModel: "one_time_purchase",
    requiresPayment: true,
    requiresSubscription: false,
    oneTimePrice: 100,
    currency: "MXN",
    purchaseType: "video",
    createdAt: new Date(),
  });
}

/** Live EN CURSO con alcance "todos": cualquiera de fuera puede verlo/entrar. */
async function seedOpenLive(postId: string, groupId: string, groupVisibility: Visibility) {
  await seed(`posts/${postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId,
    groupVisibility,
    postType: "live",
    text: "en vivo abierto",
    isDeleted: false,
    isShareable: true,
    access: "free",
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    liveData: {
      status: "live",
      visibilityMode: "everyone",
      allowLoggedOutViewers: true,
      accessType: "free",
    },
    createdAt: new Date(),
  });
}

/** Live con BOLETO y alcance "todos", aún PRÓXIMO: de fuera se ve para comprarlo. */
async function seedPaidUpcomingLive(postId: string, groupId: string, groupVisibility: Visibility) {
  await seed(`posts/${postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId,
    groupVisibility,
    postType: "live",
    text: "en vivo con boleto",
    isDeleted: false,
    isShareable: true,
    access: "paid",
    accessModel: "one_time_purchase",
    requiresPayment: true,
    requiresSubscription: false,
    oneTimePrice: 150,
    currency: "MXN",
    liveData: {
      status: "upcoming",
      visibilityMode: "everyone",
      allowLoggedOutViewers: true,
      accessType: "paid",
      ticketPrice: 150,
    },
    createdAt: new Date(),
  });
}

/** Live con alcance "solo personas con cuenta": compartible pero cerrado a deslogueados. */
async function seedLoggedInOnlyLive(postId: string, groupId: string, groupVisibility: Visibility) {
  await seed(`posts/${postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId,
    groupVisibility,
    postType: "live",
    text: "en vivo solo con cuenta",
    isDeleted: false,
    isShareable: true, // visibilityMode !== "members_only" (ver post-service.create)
    access: "free",
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    liveData: {
      status: "live",
      visibilityMode: "logged_in_only",
      allowLoggedOutViewers: false,
      accessType: "free",
    },
    createdAt: new Date(),
  });
}

/**
 * La query EXACTA que corre la página pública de la comunidad para un NO-MIEMBRO
 * (ver GroupPostsFeed): genérica en comunidad pública, y en privada la de premium
 * público — que DEBE fijar `groupVisibility` y `premium.*`, porque en un `list`
 * las reglas solo ven los campos fijados con `==`.
 */
function publicFeedQuery(db: never, groupId: string, visibility: Visibility) {
  const base = collection(db, "posts");
  if (visibility === "public") {
    return query(
      base,
      where("groupId", "==", groupId),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      orderBy("createdAt", "desc"),
      limit(11),
    );
  }
  return query(
    base,
    where("groupId", "==", groupId),
    where("isDeleted", "==", false),
    where("isShareable", "==", true),
    where("groupVisibility", "==", visibility),
    where("premium.enabled", "==", true),
    where("premium.accessMode", "==", "public"),
    orderBy("createdAt", "desc"),
    limit(11),
  );
}

describe("premium público — comunidad PÚBLICA", () => {
  const gid = "gPublica";
  const pid = "pPremiumPub";

  beforeEach(async () => {
    await seedGroup(gid, "public");
    await seedPremiumPost({ postId: pid, groupId: gid, groupVisibility: "public", accessMode: "public" });
  });

  it("✅ deslogueado lista el feed público y ve el post", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "public")));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });

  it("✅ deslogueado puede abrir el post (get)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });
});

describe("premium público — comunidad PRIVADA", () => {
  const gid = "gPrivada";
  const pid = "pPremiumPriv";

  beforeEach(async () => {
    await seedGroup(gid, "private");
    await seedPremiumPost({ postId: pid, groupId: gid, groupVisibility: "private", accessMode: "public" });
  });

  it("✅ deslogueado lista el feed público y ve el post", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "private")));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });

  it("✅ deslogueado puede abrir el post (get)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });

  it("✅ no-miembro logueado lista el feed público y ve el post", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "private")));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });
});

describe("premium público — comunidad de SUSCRIPCIÓN (privada + monetización)", () => {
  const gid = "gSuscripcion";
  const pid = "pPremiumSub";

  beforeEach(async () => {
    await seedGroup(gid, "private", true);
    await seedPremiumPost({ postId: pid, groupId: gid, groupVisibility: "private", accessMode: "public" });
  });

  it("✅ deslogueado lista el feed público y ve el post", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "private")));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });

  it("✅ deslogueado puede abrir el post (get)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });
});

describe("premium — comunidad OCULTA (siempre solo miembros y de pago)", () => {
  const gid = "gOculta";
  const pid = "pPremiumOculto";

  beforeEach(async () => {
    await seedGroup(gid, "hidden");
    await seedPremiumPost({ postId: pid, groupId: gid, groupVisibility: "hidden", accessMode: "members_only" });
  });

  it("🔴 deslogueado NO puede abrir el post", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `posts/${pid}`)));
  });

  it("🔴 un ajeno logueado NO puede abrir el post", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(db, `posts/${pid}`)));
  });

  it("✅ un miembro sí puede abrirlo", async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });
});

describe("premium público — PERFIL", () => {
  const pid = "pPremiumPerfil";

  beforeEach(async () => {
    await seed(`users/${OWNER}`, { uid: OWNER, handle: "owner" });
    await seed(`posts/${pid}`, {
      authorId: OWNER,
      contextType: "profile",
      profileId: OWNER,
      profileRestricted: false,
      postType: "video",
      text: "video premium de perfil",
      isDeleted: false,
      isShareable: true,
      premium: {
        enabled: true,
        kind: "video",
        accessMode: "public",
        freeFor: "none",
        price: 100,
        currency: "MXN",
        purchaseType: "one_time",
      },
      access: "paid",
      accessModel: "one_time_purchase",
      requiresPayment: true,
      requiresSubscription: false,
      oneTimePrice: 100,
      currency: "MXN",
      purchaseType: "video",
      createdAt: new Date(),
    });
  });

  it("✅ deslogueado puede abrir el post de perfil", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });

  // Carril "public" de fetchProfileFeedDocs.
  it("✅ deslogueado lista el feed del perfil y ve el post", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("contextType", "==", "profile"),
      where("profileId", "==", OWNER),
      where("authorId", "==", OWNER),
      where("isDeleted", "==", false),
      orderBy("createdAt", "desc"),
      limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CARRILES del feed de no-miembros en comunidad PRIVADA (fetchGroupPublicPremium
// PostsPage): premium público, contenido de pago compartible y live en curso
// abierto. Cada uno fija con `==` todos los campos que mira su regla.
// ─────────────────────────────────────────────────────────────────────────────
describe("carriles del feed de fuera — comunidad PRIVADA", () => {
  const gid = "gPrivadaCarriles";
  const premiumId = "pPremiumCarril";
  const openLiveId = "pLiveAbierto";
  const paidLiveId = "pLiveConBoleto";
  const restrictedLiveId = "pLiveSoloCuenta";

  const base = (db: never) => [
    where("groupId", "==", gid),
    where("isDeleted", "==", false),
    where("isShareable", "==", true),
    where("groupVisibility", "==", "private"),
  ] as const;

  beforeEach(async () => {
    await seedGroup(gid, "private");
    await seedPremiumPost({ postId: premiumId, groupId: gid, groupVisibility: "private", accessMode: "public" });
    await seedOpenLive(openLiveId, gid, "private");
    await seedPaidUpcomingLive(paidLiveId, gid, "private");
    await seedLoggedInOnlyLive(restrictedLiveId, gid, "private");
  });

  it("✅ carril LIVE: el deslogueado ve el live en curso abierto", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"), ...base(db as never),
      where("liveData.status", "==", "live"),
      where("liveData.allowLoggedOutViewers", "==", true),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toEqual([openLiveId]);
  });

  it("✅ carril PAGO: el deslogueado ve el live con boleto (para comprarlo)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"), ...base(db as never),
      where("requiresPayment", "==", true),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toEqual(expect.arrayContaining([paidLiveId, premiumId]));
  });

  it("✅ carril PREMIUM sigue funcionando", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"), ...base(db as never),
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toEqual([premiumId]);
  });

  it("🔴 ningún carril entrega el live 'solo con cuenta' al deslogueado", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const lanes = await Promise.all([
      getDocs(query(collection(db, "posts"), ...base(db as never),
        where("liveData.status", "==", "live"),
        where("liveData.allowLoggedOutViewers", "==", true),
        orderBy("createdAt", "desc"), limit(11))),
      getDocs(query(collection(db, "posts"), ...base(db as never),
        where("requiresPayment", "==", true),
        orderBy("createdAt", "desc"), limit(11))),
      getDocs(query(collection(db, "posts"), ...base(db as never),
        where("premium.enabled", "==", true),
        where("premium.accessMode", "==", "public"),
        orderBy("createdAt", "desc"), limit(11))),
    ]);
    const ids = lanes.flatMap((snap) => snap.docs.map((d) => d.id));
    expect(ids).not.toContain(restrictedLiveId);
  });

  it("✅ los tres carriles también funcionan para un no-miembro LOGUEADO", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertSucceeds(getDocs(query(collection(db, "posts"), ...base(db as never),
      where("liveData.status", "==", "live"),
      where("liveData.allowLoggedOutViewers", "==", true),
      orderBy("createdAt", "desc"), limit(11))));
    await assertSucceeds(getDocs(query(collection(db, "posts"), ...base(db as never),
      where("requiresPayment", "==", true),
      orderBy("createdAt", "desc"), limit(11))));
    await assertSucceeds(getDocs(query(collection(db, "posts"), ...base(db as never),
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
      orderBy("createdAt", "desc"), limit(11))));
  });
});

// ¿La query GENÉRICA de comunidad pública (fetchGroupPublicPostsPage) le entrega
// a un deslogueado un live "solo con cuenta"? `guestAllowedForLive()` mira
// `liveData`, que esa query NO fija — y lo no fijado se comporta como ausente.
describe("comunidad PÚBLICA — feed genérico con un live 'solo con cuenta'", () => {
  const gid = "gPublicaConLiveRestringido";
  const premiumId = "pPremiumPubCarril";
  const restrictedLiveId = "pLiveSoloCuentaPub";

  beforeEach(async () => {
    await seedGroup(gid, "public");
    await seedPremiumPost({ postId: premiumId, groupId: gid, groupVisibility: "public", accessMode: "public" });
    await seedLoggedInOnlyLive(restrictedLiveId, gid, "public");
  });

  // ⚠️ Documenta un límite REAL: las reglas SÍ le entregan el doc del live
  // restringido al deslogueado. `guestAllowedForLive()` mira `liveData`, y en un
  // `list` lo no fijado se comporta como ausente, así que la guarda no aplica.
  // Quien lo oculta es el filtro de cliente de `fetchGroupPublicPostsPage`
  // (`allowLoggedOutViewers !== false`), que por tanto NO es cosmético: si se
  // quita, el invitado vería la tarjeta del live (portada y título; el stream
  // sigue cerrado por el proxy y por el gate de `visibilityMode` en el visor).
  it("las reglas entregan el live restringido; ocultarlo es trabajo del cliente", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "public")));
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain(premiumId);
    expect(ids).toContain(restrictedLiveId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOD (grabación tras terminar el live). Hereda el alcance del live:
//   everyone        → lo ve todo el mundo, incluso sin sesión
//   logged_in_only  → solo con cuenta
//   members_only    → solo miembros de la comunidad
// ─────────────────────────────────────────────────────────────────────────────

/** Live TERMINADO con su grabación visible (VOD), heredando el alcance del live. */
async function seedVod(params: {
  postId: string;
  groupId: string;
  groupVisibility: Visibility;
  visibilityMode: "everyone" | "logged_in_only" | "members_only";
  paid?: boolean;
}) {
  const membersOnly = params.visibilityMode === "members_only" || params.groupVisibility === "hidden";
  await seed(`posts/${params.postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId: params.groupId,
    groupVisibility: params.groupVisibility,
    postType: "live",
    text: "EN VIVO - grabación",
    isDeleted: false,
    // updateLiveVodSettings: isShareable = !vodHidden && !membersOnlyScope
    isShareable: !membersOnly,
    ...(params.paid
      ? {
          premium: {
            enabled: true, kind: "video",
            accessMode: membersOnly ? "members_only" : "public",
            freeFor: "none", price: 80, currency: "MXN", purchaseType: "one_time",
          },
          access: "paid",
          accessModel: "one_time_purchase",
          requiresPayment: true,
          oneTimePrice: 80,
        }
      : {
          premium: null,
          access: "free",
          accessModel: "free",
          requiresPayment: false,
          oneTimePrice: null,
        }),
    requiresSubscription: false,
    liveData: {
      status: "ended",
      visibilityMode: params.visibilityMode,
      allowLoggedOutViewers: params.visibilityMode === "everyone" && params.groupVisibility !== "hidden",
      accessType: "free",
      vodStatus: "ready",
      vodHidden: false,
      vodSettingsConfirmed: true,
    },
    createdAt: new Date(),
  });
}

describe("VOD — hereda el alcance del live", () => {
  const gPriv = "gPrivadaVod";
  const gPub = "gPublicaVod";

  beforeEach(async () => {
    await seedGroup(gPriv, "private");
    await seedGroup(gPub, "public");
  });

  it("✅ everyone (comunidad privada): el deslogueado lo abre", async () => {
    await seedVod({ postId: "vodTodos", groupId: gPriv, groupVisibility: "private", visibilityMode: "everyone" });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "posts/vodTodos")));
  });

  it("✅ everyone (privada): aparece en el feed de fuera para el deslogueado", async () => {
    await seedVod({ postId: "vodTodos", groupId: gPriv, groupVisibility: "private", visibilityMode: "everyone" });
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("groupId", "==", gPriv),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      where("groupVisibility", "==", "private"),
      where("accessModel", "==", "free"),
      where("requiresPayment", "==", false),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toContain("vodTodos");
  });

  it("🔴 logged_in_only: el deslogueado NO lo abre", async () => {
    await seedVod({ postId: "vodCuenta", groupId: gPriv, groupVisibility: "private", visibilityMode: "logged_in_only" });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "posts/vodCuenta")));
  });

  it("✅ logged_in_only: un logueado no-miembro sí lo abre", async () => {
    await seedVod({ postId: "vodCuenta", groupId: gPriv, groupVisibility: "private", visibilityMode: "logged_in_only" });
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertSucceeds(getDoc(doc(db, "posts/vodCuenta")));
  });

  it("🔴 members_only (comunidad privada): un logueado no-miembro NO lo abre", async () => {
    await seedVod({ postId: "vodMiembrosPriv", groupId: gPriv, groupVisibility: "private", visibilityMode: "members_only" });
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(db, "posts/vodMiembrosPriv")));
  });

  it("🔴 members_only (comunidad PÚBLICA): un logueado no-miembro NO lo abre", async () => {
    await seedVod({ postId: "vodMiembrosPub", groupId: gPub, groupVisibility: "public", visibilityMode: "members_only" });
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(db, "posts/vodMiembrosPub")));
  });

  it("🔴 members_only (comunidad PÚBLICA): el deslogueado NO lo abre", async () => {
    await seedVod({ postId: "vodMiembrosPub", groupId: gPub, groupVisibility: "public", visibilityMode: "members_only" });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "posts/vodMiembrosPub")));
  });

  it("✅ members_only: el MIEMBRO sí lo abre (pública y privada)", async () => {
    await seedVod({ postId: "vodMiembrosPriv", groupId: gPriv, groupVisibility: "private", visibilityMode: "members_only" });
    await seedVod({ postId: "vodMiembrosPub", groupId: gPub, groupVisibility: "public", visibilityMode: "members_only" });
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDoc(doc(db, "posts/vodMiembrosPriv")));
    await assertSucceeds(getDoc(doc(db, "posts/vodMiembrosPub")));
  });

  it("✅ el AUTOR siempre abre su VOD, sea cual sea el alcance", async () => {
    await seedVod({ postId: "vodMiembrosPriv", groupId: gPriv, groupVisibility: "private", visibilityMode: "members_only" });
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(getDoc(doc(db, "posts/vodMiembrosPriv")));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGLAS CRUZADAS: un live se PUBLICA TAMBIÉN en otros destinos
// (`liveData.broadcastGroupIds`). No se duplica el post: sigue habiendo UN solo
// documento en su contexto de origen y en cada destino se enciende el anillo
// (`groups/{gid}.activeLivePostId`). Por tanto el alcance que manda es SIEMPRE
// el del live de origen, no el del destino.
// ─────────────────────────────────────────────────────────────────────────────

/** Live de PERFIL (perfil público) publicado además en otras comunidades. */
async function seedProfileLive(params: {
  postId: string;
  visibilityMode: "everyone" | "logged_in_only";
  broadcastGroupIds: string[];
}) {
  await seed(`users/${OWNER}`, { uid: OWNER, handle: "owner", activeLivePostId: params.postId });
  await seed(`posts/${params.postId}`, {
    authorId: OWNER,
    contextType: "profile",
    profileId: OWNER,
    profileRestricted: false,
    postType: "live",
    text: "live de perfil",
    isDeleted: false,
    isShareable: true,
    access: "free",
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    liveData: {
      status: "live",
      visibilityMode: params.visibilityMode,
      allowLoggedOutViewers: params.visibilityMode === "everyone",
      accessType: "free",
      broadcastGroupIds: params.broadcastGroupIds,
    },
    createdAt: new Date(),
  });
}

/** Live nacido en una comunidad, publicado además en el perfil del creador. */
async function seedGroupLiveBroadcastToProfile(params: {
  postId: string;
  groupId: string;
  groupVisibility: Visibility;
  visibilityMode: "everyone" | "members_only";
}) {
  await seed(`posts/${params.postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId: params.groupId,
    groupVisibility: params.groupVisibility,
    postType: "live",
    text: "live de comunidad",
    isDeleted: false,
    isShareable: params.visibilityMode !== "members_only" && params.groupVisibility !== "hidden",
    access: "free",
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    liveData: {
      status: "live",
      visibilityMode: params.visibilityMode,
      allowLoggedOutViewers: params.visibilityMode === "everyone" && params.groupVisibility !== "hidden",
      accessType: "free",
      broadcastGroupIds: ["__profile__"],
    },
    createdAt: new Date(),
  });
}

describe("cruzado — live de PERFIL publicado también en una comunidad PRIVADA", () => {
  const gid = "gPrivadaDestino";
  const pid = "liveDePerfil";

  beforeEach(async () => {
    await seedGroup(gid, "private");
  });

  it("✅ alcance 'todos': hasta un DESLOGUEADO lo abre, aunque no sea miembro", async () => {
    await seedProfileLive({ postId: pid, visibilityMode: "everyone", broadcastGroupIds: [gid] });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });

  it("✅ el anillo del destino se ve desde fuera (grupo privado legible)", async () => {
    await seedProfileLive({ postId: pid, visibilityMode: "everyone", broadcastGroupIds: [gid] });
    await seed(`groups/${gid}`, {
      ownerId: OWNER, visibility: "private", isActive: true, activeLivePostId: pid,
    });
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDoc(doc(db, `groups/${gid}`)));
    expect((snap as { data: () => Record<string, unknown> }).data().activeLivePostId).toBe(pid);
  });

  it("🔴 alcance 'solo con cuenta': el deslogueado NO lo abre…", async () => {
    await seedProfileLive({ postId: pid, visibilityMode: "logged_in_only", broadcastGroupIds: [gid] });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `posts/${pid}`)));
  });

  it("✅ …pero un logueado NO-MIEMBRO de esa comunidad sí", async () => {
    await seedProfileLive({ postId: pid, visibilityMode: "logged_in_only", broadcastGroupIds: [gid] });
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });
});

describe("cruzado — ¿se puede LISTAR el live de perfil dentro del feed de la comunidad destino?", () => {
  const gid = "gPrivadaDestinoLista";
  const pid = "liveDePerfilLista";

  beforeEach(async () => {
    await seedGroup(gid, "private");
    await seedProfileLive({ postId: pid, visibilityMode: "everyone", broadcastGroupIds: [gid] });
  });

  // Consulta candidata para que el live retransmitido salga como un post más del
  // feed de la comunidad, en vez de depender del anillo (`activeLivePostId`).
  it("✅ un deslogueado puede listar por broadcastGroupIds fijando los campos del post de perfil", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("liveData.broadcastGroupIds", "array-contains", gid),
      where("contextType", "==", "profile"),
      where("profileRestricted", "==", false),
      where("isDeleted", "==", false),
      where("accessModel", "==", "free"),
      where("requiresPayment", "==", false),
      where("requiresSubscription", "==", false),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });
});

// Caso reportado: live de PERFIL con alcance "solo personas con cuenta",
// publicado además en una comunidad PÚBLICA. Al invitado no debe llegarle por
// ninguna vía — ni el post, ni la tarjeta en el feed de esa comunidad.
describe("cruzado — live 'solo con cuenta' retransmitido a una comunidad PÚBLICA", () => {
  const gid = "gPublicaDestinoRestringido";
  const pid = "liveRestringidoRetransmitido";

  beforeEach(async () => {
    await seedGroup(gid, "public");
    await seedProfileLive({ postId: pid, visibilityMode: "logged_in_only", broadcastGroupIds: [gid] });
  });

  it("🔴 el deslogueado NO puede abrir el post", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `posts/${pid}`)));
  });

  it("🔴 el carril de retransmitidos NO se lo entrega (fija allowLoggedOutViewers)", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("liveData.broadcastGroupIds", "array-contains", gid),
      where("contextType", "==", "profile"),
      where("profileRestricted", "==", false),
      where("isDeleted", "==", false),
      where("accessModel", "==", "free"),
      where("requiresPayment", "==", false),
      where("requiresSubscription", "==", false),
      where("liveData.allowLoggedOutViewers", "==", true),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).not.toContain(pid);
  });

  it("✅ un LOGUEADO sí lo ve por el carril (sin fijar el campo) y puede abrirlo", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("liveData.broadcastGroupIds", "array-contains", gid),
      where("contextType", "==", "profile"),
      where("profileRestricted", "==", false),
      where("isDeleted", "==", false),
      where("accessModel", "==", "free"),
      where("requiresPayment", "==", false),
      where("requiresSubscription", "==", false),
      orderBy("createdAt", "desc"), limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });
});

describe("cruzado — live de COMUNIDAD publicado también en el perfil", () => {
  const gid = "gPrivadaOrigen";
  const pid = "liveDeComunidad";

  beforeEach(async () => {
    await seedGroup(gid, "private");
    await seed(`users/${OWNER}`, { uid: OWNER, handle: "owner", activeLivePostId: pid });
  });

  it("✅ alcance 'todos' (el composer lo fuerza al elegir destino público): cualquiera lo abre", async () => {
    await seedGroupLiveBroadcastToProfile({
      postId: pid, groupId: gid, groupVisibility: "private", visibilityMode: "everyone",
    });
    const guest = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(guest, `posts/${pid}`)));
    const outsider = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertSucceeds(getDoc(doc(outsider, `posts/${pid}`)));
  });

  it("🔴 alcance 'solo miembros': ni el deslogueado ni un logueado ajeno lo abren, aunque el anillo esté en el perfil", async () => {
    await seedGroupLiveBroadcastToProfile({
      postId: pid, groupId: gid, groupVisibility: "private", visibilityMode: "members_only",
    });
    const guest = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(guest, `posts/${pid}`)));
    const outsider = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(outsider, `posts/${pid}`)));
  });

  it("🔴 'solo miembros' desde una comunidad PÚBLICA tampoco se abre desde fuera", async () => {
    await seedGroup("gPublicaOrigen", "public");
    await seedGroupLiveBroadcastToProfile({
      postId: "liveMiembrosPub", groupId: "gPublicaOrigen", groupVisibility: "public", visibilityMode: "members_only",
    });
    const outsider = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(outsider, "posts/liveMiembrosPub")));
  });

  it("✅ el MIEMBRO sí lo abre en ambos casos", async () => {
    await seedGroupLiveBroadcastToProfile({
      postId: pid, groupId: gid, groupVisibility: "private", visibilityMode: "members_only",
    });
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDoc(doc(db, `posts/${pid}`)));
  });
});

// El feed del perfil trae además los posts de COMUNIDAD del creador que son
// compartibles (carril `shareable_group_posts`): ahí es donde debería aparecer
// el premium público de una comunidad privada cuando alguien visita el perfil.
describe("feed del PERFIL — carril de posts de comunidad compartibles", () => {
  const gid = "gPrivadaPerfil";
  const pid = "pPremiumPrivPerfil";

  beforeEach(async () => {
    await seed(`users/${OWNER}`, { uid: OWNER, handle: "owner" });
    await seedGroup(gid, "private");
    await seedPremiumPost({ postId: pid, groupId: gid, groupVisibility: "private", accessMode: "public" });
  });

  it("✅ deslogueado lista el carril y ve el premium de la comunidad privada", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("authorId", "==", OWNER),
      where("contextType", "==", "group"),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      where("groupVisibility", "==", "private"),
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
      orderBy("createdAt", "desc"),
      limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });

  it("✅ un ajeno logueado también lo ve en el perfil", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("authorId", "==", OWNER),
      where("contextType", "==", "group"),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      where("groupVisibility", "==", "private"),
      where("premium.enabled", "==", true),
      where("premium.accessMode", "==", "public"),
      orderBy("createdAt", "desc"),
      limit(11),
    )));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });

  it("✅ el carril de comunidad PÚBLICA del perfil también lista", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDocs(query(
      collection(db, "posts"),
      where("authorId", "==", OWNER),
      where("contextType", "==", "group"),
      where("isDeleted", "==", false),
      where("isShareable", "==", true),
      where("groupVisibility", "==", "public"),
      orderBy("createdAt", "desc"),
      limit(11),
    )));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESIÓN: un live "solo personas con cuenta" en la misma comunidad envenena
// la query entera del feed público. Firestore evalúa las reglas documento por
// documento, pero si UNO solo no pasa, DENIEGA LA CONSULTA COMPLETA: el
// deslogueado deja de ver también el post premium que sí debería ver.
// ─────────────────────────────────────────────────────────────────────────────
describe("premium público + live 'solo con cuenta' en la misma comunidad privada", () => {
  const gid = "gPrivadaConLive";
  const pid = "pPremiumConLive";
  const liveId = "pLiveLoggedIn";

  beforeEach(async () => {
    await seedGroup(gid, "private");
    await seedPremiumPost({ postId: pid, groupId: gid, groupVisibility: "private", accessMode: "public" });
    await seedLoggedInOnlyLive(liveId, gid, "private");
  });

  it("✅ el deslogueado sigue viendo el post premium en el feed público", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "private")));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });

  it("🔴 pero el live restringido NO se le entrega", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "private")));
    expect(snap.docs.map((d) => d.id)).not.toContain(liveId);
  });

  it("✅ un no-miembro LOGUEADO también ve el premium (no se cae por coste de reglas)", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    const snap = await assertSucceeds(getDocs(publicFeedQuery(db as never, gid, "private")));
    expect(snap.docs.map((d) => d.id)).toContain(pid);
  });
});
