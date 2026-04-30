import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const DISPLAY_NAME_COOLDOWN_DAYS = 60;
const DISPLAY_NAME_COOLDOWN_MS =
  DISPLAY_NAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function getDateFromUnknown(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

export const updateProfileDisplayName = onCall(
  {
    region: "us-central1",
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para cambiar tu nombre."
      );
    }

    const nextDisplayName = normalizeDisplayName(
      request.data?.displayName
    );

    if (nextDisplayName.length < 3) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre debe tener al menos 3 caracteres."
      );
    }

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Perfil no encontrado.");
    }

    const userData = userSnap.data() ?? {};
    const lastChangedAt = getDateFromUnknown(
      userData.displayNameLastChangedAt
    );

    if (lastChangedAt) {
      const nextAllowedAt =
        lastChangedAt.getTime() + DISPLAY_NAME_COOLDOWN_MS;

      if (Date.now() < nextAllowedAt) {
        const remainingMs = nextAllowedAt - Date.now();
        const remainingDays = Math.ceil(
          remainingMs / (24 * 60 * 60 * 1000)
        );

        throw new HttpsError(
          "failed-precondition",
          `Podrás cambiar tu nombre nuevamente en ${remainingDays} día(s).`
        );
      }
    }

    const now = Timestamp.now();

    await userRef.update({
      displayName: nextDisplayName,
      displayNameLastChangedAt: now,
      updatedAt: now,
    });

    await getAuth().updateUser(uid, {
      displayName: nextDisplayName,
    });

    return {
      ok: true,
      displayName: nextDisplayName,
      displayNameLastChangedAt: now.toDate().toISOString(),
    };
  }
);