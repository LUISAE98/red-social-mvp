import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Tope por comprador: 30 registros por hora. Una persona real no concreta 30
// compras en una hora, y acota lo que puede inflar una cuenta comprometida.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Techo de cordura del importe. No sustituye a la verificación real (ver la nota
// de arriba), pero impide que un solo POST meta un número absurdo en `grossSum`.
const MAX_GROSS_AMOUNT = 100_000;

// Tamaño de celda de la rejilla (~10 km). Redondeamos la lat/lng aproximada de
// la IP a esta celda: agrupa compras cercanas en un mismo punto y evita guardar
// la ubicación fina de cada persona.
const CELL = 0.1;

const ALLOWED_SERVICES = new Set([
  "supercomment",
  "live_donation",
  "live_ticket",
  "premium_post",
  "vod_ticket",
  "greeting",
  "advice",
  "exclusive_session",
  "live_session",
  "subscription",
  "profile_donation",
]);

function roundToCell(v: number): number {
  return Math.round(v / CELL) * CELL;
}

// Clave de documento segura a partir de la celda (sin "." ni "-").
function cellKey(lat: number, lng: number): string {
  const enc = (n: number) => n.toFixed(1).replace("-", "m").replace(".", "p");
  return `${enc(lat)}_${enc(lng)}`;
}

// ⚠️ LÍMITE CONOCIDO: `creatorId`, `serviceType` y `grossAmount` siguen viniendo
// del cliente. Volverlos autoritativos exige una referencia de compra (entrada
// del ledger o intent de pago), pero la escribe un webhook de forma ASÍNCRONA y
// esta llamada ocurre justo al concretar el pago, así que a menudo todavía no
// existe. La alternativa —registrar la geo desde el propio webhook— pierde la IP
// del comprador, que es justo el dato que da sentido al mapa. Mientras se decide
// eso, aquí se exige sesión, se acota el ritmo y se topa el importe: el abuso
// pasa de anónimo e ilimitado a atribuible y acotado. Solo corrompe analítica
// del planeta 3D; NUNCA toca el ledger ni el saldo.
export async function POST(request: NextRequest) {
  // Exige sesión de Firebase. Se acepta la ANÓNIMA a propósito: las compras de
  // invitado son un flujo legítimo del producto y también deben pintar el mapa.
  const authHeader = request.headers.get("Authorization");
  const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  let buyerUid: string;
  try {
    buyerUid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const creatorId =
    typeof body.creatorId === "string" ? body.creatorId.trim() : "";
  if (!creatorId || creatorId.length > 200) {
    return NextResponse.json({ ok: false, error: "creatorId" }, { status: 400 });
  }

  const serviceType =
    typeof body.serviceType === "string" && ALLOWED_SERVICES.has(body.serviceType)
      ? body.serviceType
      : "other";
  const grossAmount =
    typeof body.grossAmount === "number" &&
    Number.isFinite(body.grossAmount) &&
    body.grossAmount > 0
      ? Math.min(body.grossAmount, MAX_GROSS_AMOUNT)
      : 0;

  const db = getAdminFirestore();

  // Ritmo por comprador. Vive fuera de `users/{uid}` a propósito: ahí el cliente
  // puede escribir varios campos y podría reiniciar su propia ventana. Esta
  // colección no la escribe nadie salvo el Admin SDK.
  const limitRef = db.collection("purchaseGeoLimits").doc(buyerUid);
  try {
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(limitRef);
      const now = Date.now();
      const windowStart = (snap.data()?.windowStart as number | undefined) ?? 0;
      const count = (snap.data()?.count as number | undefined) ?? 0;

      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        tx.set(limitRef, { windowStart: now, count: 1 });
        return true;
      }
      if (count >= RATE_LIMIT_MAX) return false;
      tx.set(limitRef, { windowStart, count: count + 1 }, { merge: true });
      return true;
    });
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
  } catch {
    // Si el control de ritmo falla, no se bloquea el registro: es telemetría.
  }

  // Geo aproximada por IP (la inyecta Vercel en cada request).
  const latRaw = request.headers.get("x-vercel-ip-latitude");
  const lngRaw = request.headers.get("x-vercel-ip-longitude");
  const lat = latRaw ? Number(latRaw) : NaN;
  const lng = lngRaw ? Number(lngRaw) : NaN;

  // Sin geo (entorno local o IP desconocida): no registramos ubicación.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: true, geo: false });
  }

  const country = request.headers.get("x-vercel-ip-country");
  const cityRaw = request.headers.get("x-vercel-ip-city");
  let city: string | null = null;
  if (cityRaw) {
    try {
      city = decodeURIComponent(cityRaw);
    } catch {
      city = cityRaw;
    }
  }

  const cellLat = roundToCell(lat);
  const cellLng = roundToCell(lng);

  const ref = db
    .collection("users")
    .doc(creatorId)
    .collection("purchaseGeo")
    .doc(cellKey(cellLat, cellLng));

  await ref.set(
    {
      lat: cellLat,
      lng: cellLng,
      country: country ?? null,
      city,
      purchases: FieldValue.increment(1),
      grossSum: FieldValue.increment(grossAmount),
      lastServiceType: serviceType,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, geo: true });
}
