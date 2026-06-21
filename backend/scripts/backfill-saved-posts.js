/**
 * Backfill savedPosts via Firestore REST API usando el access_token del Firebase CLI.
 * Repara:
 *   1. users/{uid}/savedPosts/{postId} no existe (save viejo sin dual-write).
 *   2. El doc existe pero le falta savedAt (excluido por orderBy).
 */

const fs   = require("fs");
const https = require("https");
const os    = require("os");

const PROJECT = "red-social-mvp";
const BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const config = JSON.parse(fs.readFileSync(os.homedir() + "/.config/configstore/firebase-tools.json", "utf8"));
const TOKEN  = config.tokens.access_token;

if (!TOKEN) { console.error("No access_token. Ejecuta 'firebase login'."); process.exit(1); }

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        Authorization:  "Bearer " + TOKEN,
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        else resolve(raw ? JSON.parse(raw) : {});
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Firestore structured query (runQuery)
function runQuery(parent, query) {
  return new Promise((resolve, reject) => {
    const url  = new URL(`https://firestore.googleapis.com/v1/${parent}:runQuery`);
    const data = JSON.stringify({ structuredQuery: query });
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   "POST",
      headers: {
        Authorization:  "Bearer " + TOKEN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        else resolve(JSON.parse(raw));
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Firestore value helpers ──────────────────────────────────────────────────

function fStr(v)  { return { stringValue: v }; }
function fBool(v) { return { booleanValue: v }; }
function fNull()  { return { nullValue: "NULL_VALUE" }; }
function fNow()   { return { timestampValue: new Date().toISOString() }; }
function fInt(v)  { return { integerValue: String(v) }; }

function extractValue(v) {
  if (!v) return null;
  if ("stringValue"    in v) return v.stringValue;
  if ("booleanValue"   in v) return v.booleanValue;
  if ("integerValue"   in v) return Number(v.integerValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue"      in v) return null;
  if ("mapValue"       in v) return extractMap(v.mapValue.fields || {});
  return null;
}

function extractMap(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = extractValue(v);
  return out;
}

function docToObj(doc) {
  return extractMap(doc.fields || {});
}

// ─── Get a single document ────────────────────────────────────────────────────

async function getDoc(collPath) {
  try {
    return await request("GET", "/" + collPath);
  } catch (e) {
    if (e.message.startsWith("HTTP 404")) return null;
    throw e;
  }
}

// ─── Patch / Create document (PATCH with updateMask) ─────────────────────────

async function setDoc(collPath, fields) {
  const keys   = Object.keys(fields).join(",");
  const url    = `/${collPath}?updateMask.fieldPaths=${encodeURIComponent(keys)}`;
  return request("PATCH", url, { fields });
}

// ─── Collect all docs from a collectionGroup via runQuery pages ───────────────

async function getAllSaves() {
  const parent = `projects/${PROJECT}/databases/(default)/documents`;
  const results = [];
  let offset    = 0;

  while (true) {
    const query = {
      from: [{ collectionId: "saves", allDescendants: true }],
      limit: 300,
      offset,
    };
    const rows = await runQuery(parent, query);
    const docs = rows.filter((r) => r.document).map((r) => r.document);
    results.push(...docs);
    if (docs.length < 300) break;
    offset += docs.length;
    process.stdout.write(`  [query] loaded ${results.length} saves so far...\r`);
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Cargando todos los saves (collectionGroup)...");
  const saves = await getAllSaves();
  console.log(`Total saves: ${saves.length}\n`);

  let created = 0, patched = 0, skipped = 0, errors = 0;

  for (let i = 0; i < saves.length; i++) {
    const saveDoc = saves[i];

    // Extraer postId y uid del path
    // path: projects/.../documents/posts/{postId}/saves/{uid}
    const segments = saveDoc.name.split("/");
    const savesIdx = segments.lastIndexOf("saves");
    if (savesIdx < 0) { skipped++; continue; }
    const uid    = segments[savesIdx + 1];
    const postId = segments[savesIdx - 1];
    if (!uid || !postId) { skipped++; continue; }

    if ((i + 1) % 25 === 0) {
      console.log(`  Progreso ${i + 1}/${saves.length} | created=${created} patched=${patched} skipped=${skipped} errors=${errors}`);
    }

    try {
      // Revisar si ya existe users/{uid}/savedPosts/{postId} con savedAt
      const savedPostPath = `users/${uid}/savedPosts/${postId}`;
      const existingDoc   = await getDoc(savedPostPath);

      if (existingDoc && existingDoc.fields?.savedAt) {
        skipped++;
        continue;
      }

      // Obtener datos del post
      const postDoc = await getDoc(`posts/${postId}`);
      if (!postDoc) { skipped++; continue; }

      const postData = docToObj(postDoc);
      if (postData.isDeleted === true || postData.deletedAt != null) { skipped++; continue; }

      const saveData  = docToObj(saveDoc);
      const savedAt   = saveDoc.fields?.createdAt || { timestampValue: new Date().toISOString() };
      const contextType = postData.contextType === "profile" ? "profile" : "group";

      const fields = {
        postId:               fStr(postId),
        userId:               fStr(uid),
        contextType:          fStr(contextType),
        groupId:              typeof postData.groupId   === "string" ? fStr(postData.groupId)   : fNull(),
        profileId:            typeof postData.profileId === "string" ? fStr(postData.profileId) : fNull(),
        authorId:             typeof postData.authorId  === "string" ? fStr(postData.authorId)  : fNull(),
        isVisible:            fBool(true),
        isDeleted:            fBool(false),
        groupVisibility:      typeof postData.groupVisibility === "string" ? fStr(postData.groupVisibility) : fNull(),
        profileRestricted:    fBool(postData.profileRestricted === true),
        accessModel:          fStr(typeof postData.accessModel === "string" ? postData.accessModel : "free"),
        requiresPayment:      fBool(postData.requiresPayment === true),
        requiresSubscription: fBool(postData.requiresSubscription === true),
        savedAt,
        updatedAt:            fNow(),
        version:              fInt(1),
      };

      // postCreatedAt si existe
      if (postDoc.fields?.createdAt) fields.postCreatedAt = postDoc.fields.createdAt;

      await setDoc(savedPostPath, fields);

      if (!existingDoc) {
        console.log(`  [CREATED] uid=${uid} post=${postId}`);
        created++;
      } else {
        console.log(`  [PATCHED] uid=${uid} post=${postId} (savedAt faltaba)`);
        patched++;
      }
    } catch (err) {
      console.error(`  [ERROR] uid=${uid} post=${postId}: ${err.message}`);
      errors++;
    }
  }

  console.log("\n=== BACKFILL COMPLETADO ===");
  console.log({ total: saves.length, created, patched, skipped, errors });
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
