// TEMPORAL — siembra de contenido de PRUEBA para el descubrimiento.
// Crea comunidades públicas + perfiles con intereses + posts públicos variados
// (categorías, tags, texto y engagement distintos) para poder observar el
// algoritmo. Todo queda marcado con `seeded: true` → borrable con cleanup.
// Borrar este archivo y sus funciones cuando termines de probar.

import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const Timestamp = admin.firestore.Timestamp;

const CREATORS = [
  { n: 1, displayName: "Ana Viajera", handle: "anaviajera", interests: ["viajes", "comida"] },
  { n: 2, displayName: "Beto Motor", handle: "betomotor", interests: ["autos", "tecnologia"] },
  { n: 3, displayName: "Caro Gamer", handle: "carogamer", interests: ["gaming", "musica"] },
];

const COMMUNITIES = [
  { id: "seed_group_1", name: "Mochileros del Mundo", category: "viajes", tags: ["viajes", "mochilero", "aventura", "europa"], creator: 1 },
  { id: "seed_group_2", name: "Fierros y Motores", category: "autos", tags: ["autos", "motor", "clasicos", "tuning"], creator: 2 },
  { id: "seed_group_3", name: "Cocina Casera", category: "comida", tags: ["comida", "recetas", "cocina", "postres"], creator: 1 },
  { id: "seed_group_4", name: "Gamers MX", category: "gaming", tags: ["gaming", "videojuegos", "esports", "rpg"], creator: 3 },
  { id: "seed_group_5", name: "Parroquia San Juan", category: "instituciones", tags: ["iglesia", "catolica", "parroquia", "oracion"], creator: 1 },
  { id: "seed_group_6", name: "Ayuntamiento Digital", category: "instituciones", tags: ["gobierno", "tramites", "municipio", "ciudadania"], creator: 2 },
];

const COMMUNITY_POSTS = [
  { g: 0, text: "Ruta mochilera por Europa: 5 ciudades baratas para conocer este verano.", likes: 40, comments: 8, saves: 12, ageDays: 1 },
  { g: 0, text: "Consejos para viajar barato: hostales, trenes y comida local en tu aventura.", likes: 15, comments: 3, saves: 5, ageDays: 6 },
  { g: 0, text: "Mi experiencia recorriendo la Patagonia con mochila y poco presupuesto.", likes: 60, comments: 10, saves: 20, ageDays: 30 },
  { g: 1, text: "Restauracion de un motor clasico paso a paso para dejarlo como nuevo.", likes: 25, comments: 5, saves: 6, ageDays: 2 },
  { g: 1, text: "Tuning responsable: mejoras de rendimiento sin arruinar tu auto.", likes: 12, comments: 2, saves: 3, ageDays: 8 },
  { g: 1, text: "Los autos clasicos mas buscados del mercado este año.", likes: 30, comments: 6, saves: 9, ageDays: 20 },
  { g: 2, text: "Receta facil de tacos al pastor caseros para el fin de semana.", likes: 50, comments: 9, saves: 18, ageDays: 1 },
  { g: 2, text: "Postres rapidos: flan napolitano en veinte minutos.", likes: 22, comments: 4, saves: 8, ageDays: 5 },
  { g: 2, text: "Cocina casera: como hacer pan artesanal sin horno profesional.", likes: 18, comments: 3, saves: 7, ageDays: 15 },
  { g: 3, text: "Guia del nuevo RPG: mejores builds para empezar en esports.", likes: 35, comments: 7, saves: 10, ageDays: 2 },
  { g: 3, text: "Torneo de videojuegos este sabado, inscripciones abiertas para gamers.", likes: 20, comments: 5, saves: 4, ageDays: 4 },
  { g: 3, text: "Setup gamer economico: perifericos que valen la pena.", likes: 28, comments: 6, saves: 11, ageDays: 12 },
  { g: 4, text: "Horarios de misa y grupos de oracion en la parroquia esta semana.", likes: 14, comments: 2, saves: 3, ageDays: 3 },
  { g: 4, text: "Catequesis para jovenes: inscripciones abiertas en la iglesia.", likes: 9, comments: 1, saves: 2, ageDays: 10 },
  { g: 5, text: "Nuevos tramites en linea del municipio: como sacar tu cita ciudadana.", likes: 11, comments: 3, saves: 2, ageDays: 2 },
  { g: 5, text: "Calendario de pagos y servicios del gobierno local para este mes.", likes: 8, comments: 1, saves: 1, ageDays: 9 },
];

const PROFILE_POSTS = [
  { creator: 1, text: "Nuevo video de mi viaje a Oaxaca: mercados, comida y playas.", likes: 20, comments: 4, saves: 6, ageDays: 2 },
  { creator: 1, text: "Recomiendo estos destinos economicos para viajar en pareja.", likes: 12, comments: 2, saves: 3, ageDays: 7 },
  { creator: 2, text: "Reseña del auto que probe esta semana, un clasico restaurado.", likes: 18, comments: 3, saves: 5, ageDays: 3 },
  { creator: 3, text: "Stream de gaming hoy en la noche, jugamos el nuevo RPG.", likes: 25, comments: 5, saves: 7, ageDays: 1 },
];

function creatorRef(n: number) {
  return `seed_creator_${n}`;
}

export const seedDiscovery = onRequest(
  { region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
    const now = Date.now();
    const nowTs = Timestamp.now();
    const batch = db.batch();

    // Perfiles creadores (públicos, con intereses)
    for (const c of CREATORS) {
      batch.set(db.collection("users").doc(creatorRef(c.n)), {
        uid: creatorRef(c.n),
        displayName: c.displayName,
        firstName: c.displayName.split(" ")[0],
        lastName: c.displayName.split(" ").slice(1).join(" "),
        handle: c.handle,
        username: c.handle,
        interests: c.interests,
        isActive: true,
        showPosts: true,
        profileRestricted: false,
        avatarUrl: null,
        photoURL: null,
        followersCount: 0,
        createdAt: nowTs,
        updatedAt: nowTs,
        seeded: true,
      });
    }

    // Comunidades públicas
    COMMUNITIES.forEach((com) => {
      batch.set(db.collection("groups").doc(com.id), {
        name: com.name,
        description: `Comunidad de prueba sobre ${com.name}.`,
        category: com.category,
        tags: com.tags,
        visibility: "public",
        isActive: true,
        discoverable: true,
        ownerId: creatorRef(com.creator),
        memberCount: 1,
        permissions: { postingMode: "members" },
        createdAt: nowTs,
        updatedAt: nowTs,
        seeded: true,
      });
    });

    function buildPost(
      id: string,
      opts: {
        context: "group" | "profile";
        com?: (typeof COMMUNITIES)[number];
        creatorN: number;
        text: string;
        likes: number;
        comments: number;
        saves: number;
        ageDays: number;
      }
    ) {
      const creator = CREATORS.find((c) => c.n === opts.creatorN)!;
      const createdAt = Timestamp.fromMillis(now - opts.ageDays * 86400000);
      const isGroup = opts.context === "group";
      return {
        contextType: opts.context,
        groupId: isGroup ? opts.com!.id : null,
        groupName: isGroup ? opts.com!.name : null,
        groupAvatarUrl: null,
        groupVisibility: isGroup ? "public" : null,
        groupCategory: isGroup ? opts.com!.category : null,
        groupTags: isGroup ? opts.com!.tags : [],
        profileId: isGroup ? null : creatorRef(creator.n),
        profileName: isGroup ? null : creator.displayName,
        profileAvatarUrl: null,
        profileUsername: isGroup ? null : creator.handle,
        profileRestricted: isGroup ? null : false,
        authorId: creatorRef(creator.n),
        authorName: creator.displayName,
        authorAvatarUrl: null,
        authorUsername: creator.handle,
        text: opts.text,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
        isDeleted: false,
        isPinnedInGroup: false,
        groupPinnedAt: null,
        groupPinnedBy: null,
        isPinnedOnProfile: false,
        profilePinnedAt: null,
        profilePinnedBy: null,
        isShareable: true,
        publicSlug: null,
        shareTitle: null,
        shareDescription: null,
        shareImageUrl: null,
        access: "free",
        premium: null,
        media: [],
        counts: { comments: opts.comments, likes: opts.likes, saves: opts.saves },
        postType: "text",
        accessModel: "free",
        accessScope: opts.context,
        requiresPayment: false,
        requiresSubscription: false,
        oneTimePrice: null,
        currency: null,
        purchaseType: null,
        liveData: null,
        videoData: null,
        scheduledData: null,
        playback: null,
        processing: {
          status: "none",
          provider: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: null,
        },
        seeded: true,
      };
    }

    COMMUNITY_POSTS.forEach((p, i) => {
      const com = COMMUNITIES[p.g];
      batch.set(
        db.collection("posts").doc(`seed_post_g${i}`),
        buildPost(`seed_post_g${i}`, {
          context: "group",
          com,
          creatorN: com.creator,
          text: p.text,
          likes: p.likes,
          comments: p.comments,
          saves: p.saves,
          ageDays: p.ageDays,
        })
      );
    });

    PROFILE_POSTS.forEach((p, i) => {
      batch.set(
        db.collection("posts").doc(`seed_post_p${i}`),
        buildPost(`seed_post_p${i}`, {
          context: "profile",
          creatorN: p.creator,
          text: p.text,
          likes: p.likes,
          comments: p.comments,
          saves: p.saves,
          ageDays: p.ageDays,
        })
      );
    });

    await batch.commit();

    res.json({
      ok: true,
      creators: CREATORS.length,
      communities: COMMUNITIES.length,
      communityPosts: COMMUNITY_POSTS.length,
      profilePosts: PROFILE_POSTS.length,
    });
  }
);

export const cleanupSeedDiscovery = onRequest(
  { region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
    let deleted = 0;
    for (const col of ["posts", "groups", "users"]) {
      const snap = await db.collection(col).where("seeded", "==", true).get();
      let batch = db.batch();
      let n = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref);
        deleted += 1;
        n += 1;
        if (n >= 400) {
          await batch.commit();
          batch = db.batch();
          n = 0;
        }
      }
      if (n > 0) await batch.commit();
    }
    res.json({ ok: true, deleted });
  }
);
