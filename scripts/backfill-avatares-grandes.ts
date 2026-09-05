/**
 * Redimensiona los avatares y portadas que se subieron ANTES del tope.
 *
 * Desde el 2026-09-04 el recorte se guarda con un lado máximo de 512 px
 * (avatar) y 1600 px (portada), pero eso solo aplica a lo que se sube desde
 * entonces. Lo que ya estaba puede ser de 2 000 × 2 000, y un avatar es la
 * imagen que más se repite en pantalla: una lista de mensajes o un feed pintan
 * decenas.
 *
 *   npx tsx scripts/backfill-avatares-grandes.ts            → SOLO MIDE, no toca nada
 *   npx tsx scripts/backfill-avatares-grandes.ts --aplicar  → redimensiona de verdad
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 El token de descarga se CONSERVA. Ni una sola escritura en Firestore.
 *
 * Las URLs de Firebase Storage llevan un `?token=…`, y sobrescribir un objeto
 * normalmente genera uno nuevo — con lo que la URL guardada en `photoURL` o
 * `avatarUrl` dejaría de servir y TODOS los avatares se romperían.
 *
 * La primera versión de este script resolvía eso reescribiendo la URL en cada
 * documento. Funciona, pero es peor por dos motivos: obliga a acertar en qué
 * campo vive cada URL (son distintos entre perfiles y comunidades), y si algo
 * falla entre subir la imagen y escribir el documento, queda un avatar roto.
 *
 * Lo que hace ahora es más simple y no puede romper nada: lee el token que ya
 * tiene el objeto y lo vuelve a poner al subir la versión redimensionada. La URL
 * guardada sigue siendo válida, apunta al mismo sitio, y Firestore no se toca.
 *
 * Si un objeto no tuviera token, se salta y se reporta: sin él no hay forma de
 * conservar la URL, y adivinar no es una opción.
 *
 * De paso se le pone `cacheControl`, que a lo ya guardado le faltaba — ver el
 * pendiente de caché de Storage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

const APLICAR = process.argv.includes("--aplicar");

/** Mismos topes que `ProfileClient` y `groupImageHelpers`. Si cambian allí, aquí. */
const TOPE_AVATAR_PX = 512;
const TOPE_PORTADA_PX = 1600;

/**
 * Por debajo de esto no se mira siquiera el contenido. Un JPEG de 512 px ronda
 * los 60-90 KB; descargar los que ya son pequeños para confirmarlo sería pagar
 * ancho de banda por nada.
 */
const UMBRAL_SOSPECHA_BYTES = 150 * 1024;

type Objetivo = {
  /** Ruta en Storage. */
  ruta: string;
  /** Lado máximo permitido, según sea avatar o portada. */
  tope: number;
};

function inicializar() {
  if (admin.apps.length) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ?? process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ?? process.env.FIREBASE_ADMIN_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey || !storageBucket) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY o NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET en .env.local"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    storageBucket,
  });
}

const kb = (n: number) => (n / 1024).toFixed(0);

/** Reconoce las rutas de avatar y portada, y con qué tope se mide cada una. */
function objetivoDeRuta(ruta: string): Objetivo | null {
  const m = ruta.match(/^(users|groups)\/[^/]+\/(avatar|cover)\/[^/]+$/);
  if (!m) return null;

  return { ruta, tope: m[2] === "avatar" ? TOPE_AVATAR_PX : TOPE_PORTADA_PX };
}

async function main() {
  inicializar();

  const bucket = admin.storage().bucket();

  const [deUsuarios] = await bucket.getFiles({ prefix: "users/" });
  const [deGrupos] = await bucket.getFiles({ prefix: "groups/" });

  const candidatos = [...deUsuarios, ...deGrupos]
    .map((f) => ({ fichero: f, objetivo: objetivoDeRuta(f.name) }))
    .filter((c): c is { fichero: (typeof deUsuarios)[0]; objetivo: Objetivo } => !!c.objetivo);

  let pesoTotal = 0;
  const sospechosos: Array<{ fichero: (typeof deUsuarios)[0]; objetivo: Objetivo; bytes: number }> = [];

  for (const { fichero, objetivo } of candidatos) {
    const bytes = Number(fichero.metadata?.size ?? 0);
    pesoTotal += bytes;
    if (bytes > UMBRAL_SOSPECHA_BYTES) sospechosos.push({ fichero, objetivo, bytes });
  }

  sospechosos.sort((a, b) => b.bytes - a.bytes);

  console.log(`\nAvatares y portadas guardados: ${candidatos.length}`);
  console.log(`Peso total: ${kb(pesoTotal)} KB`);
  console.log(
    `Sospechosos (>${kb(UMBRAL_SOSPECHA_BYTES)} KB): ${sospechosos.length} — ` +
      `${kb(sospechosos.reduce((a, s) => a + s.bytes, 0))} KB\n`
  );

  for (const s of sospechosos.slice(0, 10)) {
    console.log(`  ${String(kb(s.bytes)).padStart(6)} KB  ${s.objetivo.ruta}`);
  }

  if (sospechosos.length === 0) {
    console.log("Nada que redimensionar. 👍");
    return;
  }

  if (!APLICAR) {
    console.log(
      `\n(pasada en seco: no se tocó nada)\n` +
        `Para redimensionar de verdad:  npx tsx scripts/backfill-avatares-grandes.ts --aplicar\n`
    );
    return;
  }

  // `sharp` se carga solo al aplicar: la pasada en seco no lo necesita, y así
  // medir no depende de tenerlo instalado.
  const sharp = (await import("sharp")).default;

  let redimensionados = 0;
  let saltados = 0;
  const fallos: string[] = [];
  const sinToken: string[] = [];

  for (const { fichero, objetivo, bytes } of sospechosos) {
    try {
      const [original] = await fichero.download();
      const meta = await sharp(original).metadata();
      const ladoMayor = Math.max(meta.width ?? 0, meta.height ?? 0);

      // Idempotente: si ya cabe en el tope no se toca, aunque pese mucho por
      // otra razón (calidad alta, PNG sin comprimir).
      if (ladoMayor <= objetivo.tope) {
        saltados++;
        continue;
      }

      const nuevo = await sharp(original)
        .resize({ width: objetivo.tope, height: objetivo.tope, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();

      /**
       * 🚨 El token que ya tenía. Sin esto la URL guardada se rompe.
       *
       * Se lee ANTES de sobrescribir y se vuelve a poner en la misma escritura,
       * así que la URL de Firestore sigue siendo válida y no hay que tocarla.
       */
      const [metaActual] = await fichero.getMetadata();
      const token = (metaActual.metadata as Record<string, string> | undefined)
        ?.firebaseStorageDownloadTokens;

      if (!token) {
        sinToken.push(objetivo.ruta);
        console.warn(`  ⚠ sin token, se salta: ${objetivo.ruta}`);
        continue;
      }

      await fichero.save(nuevo, {
        contentType: "image/jpeg",
        metadata: {
          // El `cacheControl` que a lo ya guardado le faltaba: sin él el
          // navegador redescarga la imagen en cada visita.
          cacheControl: "public, max-age=604800",
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });

      redimensionados++;
      console.log(
        `  ✔ ${objetivo.ruta}  ${kb(bytes)} KB → ${kb(nuevo.length)} KB  (${ladoMayor} → ${objetivo.tope} px)`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fallos.push(`${objetivo.ruta}: ${msg}`);
      console.error(`  ✘ ${objetivo.ruta} — ${msg}`);
    }
  }

  console.log(
    `\nlisto — redimensionados: ${redimensionados}, ya cabían: ${saltados}, ` +
      `sin token: ${sinToken.length}, fallos: ${fallos.length}`
  );

  if (sinToken.length > 0) {
    console.warn(
      "\n⚠ Estos no se tocaron porque no tenían token de descarga. Redimensionarlos\n" +
        "  habría roto su URL guardada, así que se dejaron como estaban:"
    );
    for (const r of sinToken) console.warn(`   ${r}`);
  }

  if (fallos.length > 0) {
    console.error("\n🚨 Estos fallaron. Volver a correr el script los reintenta:");
    for (const f of fallos) console.error(`   ${f}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
