import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, Timestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Activar la suscripción mensual de una comunidad devolvía "Missing or insufficient
// permissions", y NO por el contenido: `isValidGroupUpdate` pasaba el tope de 1000
// expresiones de Firestore en cuanto `monetization` cambiaba. El motor aborta la
// evaluación y eso se traduce en denegación.
//
// El coste no se ve leyendo la regla: hay que MEDIRLO. Estas pruebas lo fijan con un
// documento del tamaño de uno real —índice de búsqueda, 4 servicios, donación y el
// mapa de transiciones completo—, que es lo que hace que la cuenta se dispare. Con un
// documento mínimo la regla cabía de sobra y el fallo no aparecía.
// ─────────────────────────────────────────────────────────────────────────────

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

/** Comunidad con TODO lleno, como una de verdad. El tamaño es parte de la prueba. */
function grupoRealista(visibility: "public" | "private") {
  return {
    ownerId: OWNER,
    name: "Ferrari",
    description: "Fans de Ferrari",
    visibility,
    discoverable: true,
    isActive: true,
    category: "autos",
    tags: ["autos", "ferrari", "lujo"],
    ageMin: 18,
    ageMax: 99,
    welcomeMessage: "Bienvenido",
    coverUrl: "https://x/c.jpg",
    avatarUrl: "https://x/a.jpg",
    createdAt: Timestamp.fromMillis(1),
    permissions: { postingMode: "members", commentsEnabled: true },
    settings: { membersListVisibility: "members" },
    greetingsEnabled: true,
    search: {
      nameNormalized: "ferrari",
      descriptionNormalized: "fans de ferrari",
      categoryNormalized: "autos",
      categoryLabelNormalized: "autos",
      tagsNormalized: ["autos", "ferrari", "lujo"],
      tokens: ["ferrari", "fans", "de", "autos", "lujo"],
      prefixes: ["fe", "fer", "ferr", "ferra", "ferrar", "ferrari", "fa", "fan", "fans"],
      visibility,
      discoverable: true,
      isActive: true,
      version: 1,
      // ⚠️ NÚMERO, no Timestamp: es lo que dejan escrito algunos caminos. La regla
      // exigía `is timestamp` y con esto el documento quedaba MUERTO — su dueño no
      // podía tocar ni la descripción.
      updatedAt: 1778029366971,
    },
    offerings: [1, 2, 3, 4].map((n) => ({
      type: ["saludo", "consejo", "meet_greet_digital", "clase_personalizada"][n - 1],
      enabled: false, visible: false, visibility: "members", displayOrder: n,
      memberPrice: null, publicPrice: null, currency: null,
      requiresApproval: true, sourceScope: "group", meta: null, price: null,
    })),
    donation: {
      mode: "none", enabled: false, visible: false, currency: "USD",
      sourceScope: "group", title: null, description: null,
      suggestedAmounts: [], goalLabel: null,
    },
    monetization: {
      isPaid: false, priceMonthly: null, currency: null,
      subscriptionsEnabled: false, subscriptionPriceMonthly: null, subscriptionCurrency: null,
      paidPostsEnabled: false, paidLivesEnabled: false, paidVodEnabled: false,
      paidLiveCommentsEnabled: false, greetingsEnabled: true, adviceEnabled: true,
      customClassEnabled: false, digitalMeetGreetEnabled: true,
      transitions: {
        freeToSubscriptionPolicy: null,
        subscriptionToFreePolicy: "keep_members_free",
        subscriptionPriceIncreasePolicy: null,
        previousSubscriptionPriceMonthly: null,
        nextSubscriptionPriceMonthly: null,
        subscriptionPriceChangeCurrency: null,
        lastMonetizationChangeAt: 1778029127828,
        lastMonetizationChangeBy: OWNER,
        lastAppliedTransitionBy: OWNER,
        lastAppliedTransitionKey: "subscription_to_free__keep_members_free",
        lastAppliedTransitionAt: Timestamp.fromMillis(1),
      },
    },
  };
}

async function sembrar(visibility: "public" | "private") {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `groups/${GID}`), grupoRealista(visibility));
  });
}

beforeEach(async () => { await testEnv.clearFirestore(); });

const suscripcionActiva = {
  ...grupoRealista("private").monetization,
  subscriptionsEnabled: true,
  isPaid: true,
  subscriptionPriceMonthly: 10,
  subscriptionCurrency: "USD",
};

describe("guardar la configuración de una comunidad realista", () => {
  it("el dueño puede editar la descripción", async () => {
    await sembrar("private");
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(updateDoc(doc(db, `groups/${GID}`), { description: "hola" }));
  });

  it("🎯 el dueño puede ACTIVAR la suscripción mensual", async () => {
    await sembrar("private");
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(updateDoc(doc(db, `groups/${GID}`), { monetization: suscripcionActiva }));
  });

  it("🎯 y con el payload COMPLETO del panel (monetización + servicios + donación)", async () => {
    await sembrar("private");
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const g = grupoRealista("private");
    await assertSucceeds(
      updateDoc(doc(db, `groups/${GID}`), {
        monetization: suscripcionActiva,
        offerings: g.offerings,
        donation: g.donation,
        greetingsEnabled: true,
      })
    );
  });

  it("una comunidad PÚBLICA no puede tener suscripción", async () => {
    await sembrar("public");
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(updateDoc(doc(db, `groups/${GID}`), { monetization: suscripcionActiva }));
  });

  it("un extraño no puede tocarla", async () => {
    await sembrar("private");
    const db = testEnv.authenticatedContext("otro").firestore();
    await assertFails(updateDoc(doc(db, `groups/${GID}`), { description: "hola" }));
  });

  it("las políticas de transición siguen validándose", async () => {
    await sembrar("private");
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, `groups/${GID}`), {
        monetization: { ...suscripcionActiva, transitions: { freeToSubscriptionPolicy: "inventada" } },
      })
    );
  });
});
