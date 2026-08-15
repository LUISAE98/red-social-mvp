import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// REDES SOCIALES DEL PERFIL
//
// `users/{uid}` es de LECTURA PÚBLICA, y lo que se guarde aquí termina en un
// `href` a la vista de cualquiera. Por eso se guarda el USUARIO de cada red y
// nunca la liga: la liga se arma en el cliente desde un catálogo cerrado
// (`lib/profile/socialNetworks.ts`).
//
// Estas reglas son la última línea. Alguien con el SDK en la mano puede escribir
// su propio documento sin pasar por nuestra interfaz, así que lo que se prueba
// aquí es que Firestore, por su cuenta, rechace:
//   - redes que no están en el catálogo (una clave inventada),
//   - valores que no son cadenas,
//   - cadenas larguísimas,
//   - vacíos,
// y que sí acepte lo que la interfaz manda de verdad.
//
// Que la liga se arme en código NO se prueba aquí — eso vive en el catálogo.
// Lo que se cierra aquí es la puerta de atrás.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // projectId propio: `clearFirestore()` vacía TODO el proyecto y vitest corre
    // los archivos en paralelo — compartirlo le borraría los datos a otra suite.
    projectId: "demo-vibra-social",
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

const UID = "social_uid";

let userFs: ReturnType<ReturnType<RulesTestEnvironment["authenticatedContext"]>["firestore"]>;

beforeAll(() => {
  userFs = testEnv
    .authenticatedContext(UID, { firebase: { sign_in_provider: "password" } })
    .firestore();
});

function profile(overrides: Record<string, unknown> = {}) {
  return {
    uid: UID,
    photoURL: null,
    coverUrl: null,
    handle: "socialuser",
    username: "socialuser",
    displayName: "Nombre Visible",
    firstName: "Nombre",
    lastName: "Apellido",
    bio: "",
    role: "user",
    profileReserved: false,
    profileRestricted: false,
    profileCommentsEnabled: true,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Deja el perfil ya creado, saltándose las reglas, para probar el update. */
async function seedProfile(socialLinks: unknown = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${UID}`), profile({ socialLinks }));
  });
}

describe("redes sociales del perfil / creación", () => {
  it("acepta el mapa vacío, que es lo que escribe quien no llena ninguna", async () => {
    await assertSucceeds(
      setDoc(doc(userFs, `users/${UID}`), profile({ socialLinks: {} }))
    );
  });

  it("acepta las seis redes del catálogo", async () => {
    await assertSucceeds(
      setDoc(
        doc(userFs, `users/${UID}`),
        profile({
          socialLinks: {
            instagram: "mivibra",
            tiktok: "mivibra",
            youtube: "mivibra",
            x: "mivibra",
            facebook: "mi.vibra",
            twitch: "mivibra",
          },
        })
      )
    );
  });

  it("rechaza una red que no está en el catálogo", async () => {
    await assertFails(
      setDoc(
        doc(userFs, `users/${UID}`),
        profile({ socialLinks: { onlyfans: "mivibra" } })
      )
    );
  });
});

describe("redes sociales del perfil / actualización", () => {
  it("el dueño puede cambiar solo sus redes", async () => {
    await seedProfile();
    await assertSucceeds(
      updateDoc(doc(userFs, `users/${UID}`), {
        socialLinks: { instagram: "otro" },
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rechaza una clave inventada, aunque el resto sea válido", async () => {
    await seedProfile();
    await assertFails(
      updateDoc(doc(userFs, `users/${UID}`), {
        socialLinks: { instagram: "mivibra", telegram: "mivibra" },
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rechaza un valor que no es cadena", async () => {
    await seedProfile();
    await assertFails(
      updateDoc(doc(userFs, `users/${UID}`), {
        socialLinks: { instagram: 42 },
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rechaza un valor vacío — se quita la red, no se guarda en blanco", async () => {
    await seedProfile();
    await assertFails(
      updateDoc(doc(userFs, `users/${UID}`), {
        socialLinks: { instagram: "" },
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rechaza una cadena por encima del tope de 40", async () => {
    await seedProfile();
    await assertFails(
      updateDoc(doc(userFs, `users/${UID}`), {
        socialLinks: { instagram: "x".repeat(41) },
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rechaza que las redes vengan como lista en vez de mapa", async () => {
    await seedProfile();
    await assertFails(
      updateDoc(doc(userFs, `users/${UID}`), {
        socialLinks: [{ instagram: "mivibra" }],
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("un tercero no puede tocar las redes de otro perfil", async () => {
    await seedProfile();
    const otherFs = testEnv
      .authenticatedContext("otro_uid", { firebase: { sign_in_provider: "password" } })
      .firestore();

    await assertFails(
      updateDoc(doc(otherFs, `users/${UID}`), {
        socialLinks: { instagram: "suplantador" },
        updatedAt: serverTimestamp(),
      })
    );
  });
});
