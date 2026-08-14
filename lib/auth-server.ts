import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase-admin";

export async function getServerSessionUser() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("__session")?.value;

    if (!sessionCookie) {
      return null;
    }

    // `checkRevoked: true`. Con `false` la cookie seguía valiendo hasta 14 días
    // aunque la cuenta estuviera baneada o el usuario hubiera cerrado sesión en
    // todos los dispositivos: se validaba la firma y nada más. Cuesta una
    // consulta a Firebase Auth, y es exactamente la consulta que hace que una
    // revocación signifique algo.
    const decodedClaims = await getAdminAuth().verifySessionCookie(
      sessionCookie,
      true
    );

    return {
      uid: decodedClaims.uid,
      email: decodedClaims.email ?? null,
    };
  } catch {
    return null;
  }
}