import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
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
      ? body.grossAmount
      : 0;

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

  const db = getAdminFirestore();
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
