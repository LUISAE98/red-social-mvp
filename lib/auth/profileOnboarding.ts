import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { buildProfileSearchIndex } from "@/lib/profile/profileSearchIndex";
import { sanitizeSocialLinks } from "@/lib/profile/socialNetworks";

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

type CreateUserProfileInput = {
  /** Usuario ya autenticado (recién creado por email o por Google). */
  user: User;
  handle: string;
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  sex?: string | null;
  bio?: string;
  /** Método de alta: define provider/authProvider. */
  provider: "password" | "google";
  /** URL de foto ya subida; si se omite, usa la del proveedor (Google). */
  photoURL?: string | null;
  /** URL de portada ya subida (opcional). */
  coverUrl?: string | null;
  /**
   * Redes sociales tal como se teclearon. Se limpian aquí, no en quien llama:
   * los dos flujos de alta pasan por esta función y ninguno debe poder guardar
   * un usuario que no cumpla la forma del catálogo.
   */
  socialLinks?: unknown;
};

// Fuente ÚNICA de la creación del documento de perfil. La usan los dos flujos de
// alta (registro por email y onboarding de Google) para que ambos escriban EXACTO
// el mismo conjunto de campos —incluido el índice `search`— y no queden perfiles
// a medias según por dónde entró el usuario. Lanza errores con sentinel estable
// (HANDLE_TAKEN / PROFILE_EXISTS / HANDLE_INVALID) que cada caller traduce.
export async function createUserProfileDoc(
  db: Firestore,
  input: CreateUserProfileInput
) {
  const normalizedHandle = normalizeHandle(input.handle);
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  const displayName = `${firstName} ${lastName}`.trim();
  const email = input.user.email;
  const photoURL = input.photoURL ?? input.user.photoURL ?? null;

  if (!input.user.uid) {
    throw new Error("No se encontró el usuario autenticado.");
  }
  if (!email) {
    throw new Error("La cuenta no tiene correo disponible.");
  }
  if (!isValidHandle(normalizedHandle)) {
    throw new Error("HANDLE_INVALID");
  }

  const userRef = doc(db, "users", input.user.uid);
  const handleRef = doc(db, "handles", normalizedHandle);

  await runTransaction(db, async (transaction) => {
    const existingUserSnap = await transaction.get(userRef);
    const existingHandleSnap = await transaction.get(handleRef);

    if (existingUserSnap.exists()) {
      throw new Error("PROFILE_EXISTS");
    }
    if (existingHandleSnap.exists()) {
      throw new Error("HANDLE_TAKEN");
    }

    const updatedAt = serverTimestamp();

    // Datos personales fuera del documento público: `users/{uid}` lo lee
    // cualquiera (perfiles, búsqueda, feeds) y Firestore no oculta campos
    // sueltos, así que el correo, la fecha de nacimiento y el sexo de toda la
    // base eran extraíbles con una consulta. Van en la misma transacción para
    // que un perfil nunca exista sin su identidad, ni al revés.
    transaction.set(doc(db, "users", input.user.uid, "private", "identity"), {
      email,
      emailLower: email.toLowerCase(),
      birthDate: input.birthDate ?? null,
      sex: input.sex ?? null,
      provider: input.provider,
      authProvider: input.provider === "google" ? "google.com" : "password",
      createdAt: serverTimestamp(),
      updatedAt,
    });

    transaction.set(userRef, {
      uid: input.user.uid,
      photoURL,
      coverUrl: input.coverUrl ?? null,
      handle: normalizedHandle,
      username: normalizedHandle,
      displayName,
      firstName,
      lastName,
      // birthDate, sex, email, provider y authProvider viven en
      // `users/{uid}/private/identity` — ver el comentario de arriba.
      bio: input.bio?.trim() ?? "",
      // Solo el usuario de cada red, nunca la liga: este documento es de lectura
      // pública y la liga se arma al pintarla, desde el catálogo.
      socialLinks: sanitizeSocialLinks(input.socialLinks),
      role: "user",
      profileReserved: false,
      // Defaults de privacidad para usuarios nuevos:
      // - perfil NO restringido → todos pueden ver sus publicaciones.
      // - comentarios habilitados → todos pueden comentar.
      profileRestricted: false,
      profileCommentsEnabled: true,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt,
      // Índice de búsqueda: ambos flujos lo escriben ahora (antes el de Google
      // lo omitía y esos perfiles no salían en el buscador hasta editar algo).
      search: buildProfileSearchIndex({
        handle: normalizedHandle,
        displayName,
        firstName,
        lastName,
        isActive: true,
        profileSearchable: true,
        updatedAt,
      }),
    });

    transaction.set(handleRef, {
      uid: input.user.uid,
      handle: normalizedHandle,
      createdAt: serverTimestamp(),
    });
  });
}

type CompleteGoogleProfileInput = {
  user: User;
  handle: string;
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  sex?: string | null;
  bio?: string;
  /** Foto/portada ya subidas en el onboarding (opcionales). Si no se pasa
   *  photoURL, createUserProfileDoc usa la foto del proveedor (Google). */
  photoURL?: string | null;
  coverUrl?: string | null;
};

// Onboarding de Google: delega en la fuente única y traduce los sentinels a los
// mensajes que ya mostraba este flujo (para no cambiar su UI de errores).
export async function completeGoogleProfile(
  db: Firestore,
  input: CompleteGoogleProfileInput
) {
  try {
    await createUserProfileDoc(db, { ...input, provider: "google" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "HANDLE_TAKEN") throw new Error("Ese username ya está ocupado.");
    if (msg === "PROFILE_EXISTS") throw new Error("Este perfil ya existe.");
    if (msg === "HANDLE_INVALID") {
      throw new Error("El username no tiene un formato válido.");
    }
    throw err;
  }
}