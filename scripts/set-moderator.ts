import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Uso: npx ts-node scripts/set-moderator.ts --uid=<UID_DEL_USUARIO>
// Para quitar el rol: npx ts-node scripts/set-moderator.ts --uid=<UID> --remove

function initializeAdmin() {
  if (getApps().length) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ??
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ??
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local"
    );
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  initializeAdmin();

  const args = process.argv.slice(2);
  const uidArg = args.find((a) => a.startsWith("--uid="));
  const remove = args.includes("--remove");

  if (!uidArg) {
    console.error("❌  Debes pasar --uid=<UID_DEL_USUARIO>");
    process.exit(1);
  }

  const uid = uidArg.replace("--uid=", "").trim();

  if (!uid) {
    console.error("❌  El UID no puede estar vacío");
    process.exit(1);
  }

  const auth = getAuth();

  let userRecord;
  try {
    userRecord = await auth.getUser(uid);
  } catch {
    console.error(`❌  No se encontró ningún usuario con UID: ${uid}`);
    process.exit(1);
  }

  const currentClaims = (userRecord.customClaims as Record<string, unknown>) ?? {};

  if (remove) {
    const newClaims = { ...currentClaims };
    delete newClaims.role;
    await auth.setCustomUserClaims(uid, newClaims);
    console.log(`✅  Rol de moderador ELIMINADO para ${userRecord.email ?? uid}`);
  } else {
    await auth.setCustomUserClaims(uid, { ...currentClaims, role: "moderator" });
    console.log(`✅  Rol de moderador ASIGNADO a ${userRecord.email ?? uid}`);
  }

  console.log("");
  console.log("⚠️  El usuario debe cerrar sesión y volver a iniciarla para que el claim se actualice en su token.");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
