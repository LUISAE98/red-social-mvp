import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { initializeTestEnvironment, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, Timestamp } from "firebase/firestore";

// El guardado REAL del panel de una comunidad: monetización + los 4 servicios + donación
// activa, todo en la misma escritura. Es el peor caso de COSTE de la regla, y el que
// revienta el tope de 1000 expresiones de Firestore.

let testEnv: RulesTestEnvironment;
const OWNER = "owner";
const GID = "g1";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  });
}, 60_000);
afterAll(async () => { await testEnv.cleanup(); });

const TIPOS = ["saludo", "consejo", "meet_greet_digital", "clase_personalizada"];

function ofertas(activas: boolean) {
  return TIPOS.map((type, i) => ({
    type, enabled: activas, visible: activas, visibility: "members", displayOrder: i + 1,
    memberPrice: activas ? 20 : null, publicPrice: activas ? 20 : null,
    currency: activas ? "USD" : null, requiresApproval: true,
    sourceScope: "group", meta: activas ? { durationMinutes: 20 } : null,
    price: activas ? 20 : null,
  }));
}

const donacionActiva = {
  mode: "general", enabled: true, visible: true, currency: "USD",
  sourceScope: "group", title: "Apóyanos", description: "Gracias",
  suggestedAmounts: [3, 7, 15, 30], goalLabel: null,
};

function grupo() {
  return {
    ownerId: OWNER, name: "Star Wars Fans", description: "Fans",
    visibility: "private", discoverable: true, isActive: true,
    category: "cine", tags: ["cine", "starwars"], ageMin: 18, ageMax: 99,
    welcomeMessage: "Hola", coverUrl: "https://x/c.jpg", avatarUrl: "https://x/a.jpg",
    imageUrl: "https://x/i.jpg",
    createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
    permissions: { postingMode: "members", commentsEnabled: true },
    settings: { membersListVisibility: "members" },
    greetingsEnabled: true,
    search: {
      nameNormalized: "star wars fans", descriptionNormalized: "fans",
      categoryNormalized: "cine", categoryLabelNormalized: "cine",
      tagsNormalized: ["cine", "starwars"], tokens: ["star", "wars", "fans", "cine"],
      prefixes: ["st", "sta", "star", "wa", "war", "wars", "fa", "fan", "fans"],
      visibility: "private", discoverable: true, isActive: true, version: 1,
      updatedAt: 1778029366971,
    },
    offerings: ofertas(false),
    donation: { mode: "none", enabled: false, visible: false, currency: "USD",
      sourceScope: "group", title: null, description: null, suggestedAmounts: [], goalLabel: null },
    monetization: {
      isPaid: false, priceMonthly: null, currency: null,
      subscriptionsEnabled: false, subscriptionPriceMonthly: null, subscriptionCurrency: null,
      paidPostsEnabled: false, paidLivesEnabled: false, paidVodEnabled: false,
      paidLiveCommentsEnabled: false, greetingsEnabled: true, adviceEnabled: true,
      customClassEnabled: false, digitalMeetGreetEnabled: true,
      transitions: {
        freeToSubscriptionPolicy: null, subscriptionToFreePolicy: null,
        subscriptionPriceIncreasePolicy: null, previousSubscriptionPriceMonthly: null,
        nextSubscriptionPriceMonthly: null, subscriptionPriceChangeCurrency: null,
        lastMonetizationChangeAt: 1778029127828, lastMonetizationChangeBy: OWNER,
        lastAppliedTransitionBy: OWNER, lastAppliedTransitionKey: "k",
        lastAppliedTransitionAt: Timestamp.fromMillis(1),
      },
    },
  };
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `groups/${GID}`), grupo());
  });
});

// Exactamente lo que la consola mostró al fallar.
const monetizacionReal = {
  adviceEnabled: false, currency: "USD", customClassEnabled: false,
  digitalMeetGreetEnabled: false, greetingsEnabled: false, isPaid: true,
  paidLiveCommentsEnabled: false, paidLivesEnabled: false, paidPostsEnabled: false,
  paidVodEnabled: false, priceMonthly: 10, subscriptionCurrency: "USD",
  subscriptionPriceMonthly: 10, subscriptionsEnabled: true,
  transitions: {
    freeToSubscriptionPolicy: "legacy_free", subscriptionToFreePolicy: null,
    subscriptionPriceIncreasePolicy: null, previousSubscriptionPriceMonthly: null,
    nextSubscriptionPriceMonthly: null, subscriptionPriceChangeCurrency: null,
    lastMonetizationChangeAt: Timestamp.fromMillis(2), lastMonetizationChangeBy: OWNER,
  },
};

describe("guardado completo del panel de comunidad", () => {
  it("🎯 monetización + 4 servicios + donación activa, en una sola escritura", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(updateDoc(doc(db, `groups/${GID}`), {
      monetization: monetizacionReal,
      offerings: ofertas(true),
      donation: donacionActiva,
      greetingsEnabled: false,
    }));
  });
});

describe("guardián de coste — la regla debe caber en el presupuesto", () => {
  // Cada validador que se añada a la ruta de `groups` gasta presupuesto. Si alguien mete
  // uno nuevo sin medir, ESTA prueba se pone en rojo antes de que un creador se quede sin
  // poder guardar su comunidad. El caso es el peor razonable: todo lleno a la vez.
  it("con 10 servicios, donación llena y monetización cambiando", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const diez = Array.from({ length: 10 }, (_, i) => ({
      ...ofertas(true)[i % 4], displayOrder: i + 1,
    }));
    await assertSucceeds(updateDoc(doc(db, `groups/${GID}`), {
      monetization: monetizacionReal,
      offerings: diez,
      donation: { ...donacionActiva, suggestedAmounts: [3, 7, 15, 30, 50, 75, 100, 150, 200, 300, 400, 500] },
      greetingsEnabled: false,
    }));
  });
});
