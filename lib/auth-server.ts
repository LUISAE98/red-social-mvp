import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase-admin";

export async function getServerSessionUser() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("__session")?.value;

    if (!sessionCookie) {
      return null;
    }

    const decodedClaims = await adminAuth.verifySessionCookie(
      sessionCookie,
      false
    );

    return {
      uid: decodedClaims.uid,
      email: decodedClaims.email ?? null,
    };
  } catch {
    return null;
  }
}