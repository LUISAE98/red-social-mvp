import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMEMBER_ME_EXPIRES_IN = 1000 * 60 * 60 * 24 * 14; // 14 días
const NON_REMEMBER_EXPIRES_IN = 1000 * 60 * 60 * 12; // 12 horas

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const idToken = body?.idToken;
    const keepSession = Boolean(body?.keepSession);

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { ok: false, error: "idToken es requerido" },
        { status: 400 }
      );
    }

    const adminAuth = getAdminAuth();

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const authTimeMs = decodedToken.auth_time * 1000;
    const now = Date.now();

    if (now - authTimeMs > 5 * 60 * 1000) {
      return NextResponse.json(
        {
          ok: false,
          error: "La autenticación es demasiado antigua. Inicia sesión nuevamente.",
        },
        { status: 401 }
      );
    }

    const expiresIn = keepSession
      ? REMEMBER_ME_EXPIRES_IN
      : NON_REMEMBER_EXPIRES_IN;

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn,
    });

    const response = NextResponse.json(
      {
        ok: true,
        uid: decodedToken.uid,
      },
      { status: 200 }
    );

    response.cookies.set({
      name: "__session",
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(expiresIn / 1000),
    });

    return response;
  } catch (error) {
    console.error("Error creando session cookie:", error);

    return NextResponse.json(
      { ok: false, error: "No se pudo crear la sesión" },
      { status: 500 }
    );
  }
}