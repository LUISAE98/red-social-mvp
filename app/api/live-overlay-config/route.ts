import { NextResponse } from "next/server";

// Devuelve la config pública de Firebase para el overlay de OBS.
// Estas claves son seguras para exponer — la protección viene de las Firestore Rules.
//
// Incluye también la clave de reCAPTCHA de App Check. El overlay es un HTML
// estático servido desde nuestro propio dominio, así que no puede leer variables
// de entorno pero SÍ cumple la restricción de dominio de la clave. Sin esto, al
// activar la exigencia de App Check en Firestore el Browser Source de OBS
// dejaría de recibir supercomentarios: es el único cliente de Vibra que habla
// con Firestore fuera del bundle de Next.
export async function GET() {
  return NextResponse.json({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    appCheckSiteKey: process.env.NEXT_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY ?? "",
  });
}
