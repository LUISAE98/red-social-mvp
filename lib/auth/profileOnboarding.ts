import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import type { User } from "firebase/auth";

export const MONTHS = [
  { value: "1", label: "Enero" },
  { value: "2", label: "Febrero" },
  { value: "3", label: "Marzo" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Mayo" },
  { value: "6", label: "Junio" },
  { value: "7", label: "Julio" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
];

export function normalizeHandle(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

export function isValidHandle(value: string) {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

export function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 50);
}

export function getDaysInMonth(month: number, year: number) {
  if (!month || month < 1 || month > 12) return 31;

  const safeYear = year && year >= 1900 ? year : new Date().getFullYear();
  return new Date(safeYear, month, 0).getDate();
}

export function buildBirthDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (!y || !m || !d) return null;
  if (y < 1900 || y > new Date().getFullYear()) return null;
  if (m < 1 || m > 12) return null;

  const maxDay = getDaysInMonth(m, y);
  if (d < 1 || d > maxDay) return null;

  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(
    d
  ).padStart(2, "0")}`;
}

export function calculateAgeFromBirthDate(birthDate: string | null) {
  if (!birthDate) return 0;

  const [year, month, day] = birthDate.split("-").map(Number);
  const today = new Date();

  let age = today.getFullYear() - year;
  const hasBirthdayPassed =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hasBirthdayPassed) age -= 1;

  return age;
}

type CompleteGoogleProfileInput = {
  user: User;
  handle: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: string;
  bio?: string;
};

export async function completeGoogleProfile(
  db: Firestore,
  input: CompleteGoogleProfileInput
) {
const normalizedHandle = normalizeHandle(input.handle);
const firstName = cleanName(input.firstName);
const lastName = cleanName(input.lastName);
const displayName = `${firstName} ${lastName}`.trim();
const email = input.user.email;
const photoURL = input.user.photoURL;

  if (!input.user.uid) {
    throw new Error("No se encontró el usuario autenticado.");
  }

if (!email) {
  throw new Error("Tu cuenta de Google no tiene correo disponible.");
}

  if (!isValidHandle(normalizedHandle)) {
    throw new Error("El username no tiene un formato válido.");
  }

  const userRef = doc(db, "users", input.user.uid);
  const handleRef = doc(db, "handles", normalizedHandle);

  await runTransaction(db, async (transaction) => {
    const existingUserSnap = await transaction.get(userRef);
    const existingHandleSnap = await transaction.get(handleRef);

    if (existingUserSnap.exists()) {
      throw new Error("Este perfil ya existe.");
    }

    if (existingHandleSnap.exists()) {
      throw new Error("Ese username ya está ocupado.");
    }

    transaction.set(userRef, {
      uid: input.user.uid,
      email,
      emailLower: email.toLowerCase(),
      photoURL: photoURL || null,
      handle: normalizedHandle,
      username: normalizedHandle,
      displayName,
      firstName,
      lastName,
      birthDate: input.birthDate,
      sex: input.sex,
      bio: input.bio?.trim() ?? "",
      role: "user",
      provider: "google",
      authProvider: "google.com",
      profileReserved: false,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(handleRef, {
      uid: input.user.uid,
      handle: normalizedHandle,
      createdAt: serverTimestamp(),
    });
  });
}