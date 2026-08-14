import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";

// El push se envía DIRECTO, sin pasar por `users/{uid}/notifications`: un DM no
// va a la campanita. Se mockea para poder afirmar a quién se le empuja y a quién
// no, sin depender de FCM (que no existe en el emulador).
vi.mock("../src/push", () => ({ sendPushToUser: vi.fn(async () => {}) }));

import { onDirectMessageCreated } from "../src/directMessages";
import { onDirectMessageChangedUpdatePreview } from "../src/directMessagePreview";
import { onDirectMessageDeletedCleanupImage } from "../src/directMessageImageCleanup";
import { sendPushToUser } from "../src/push";

// ─────────────────────────────────────────────────────────────────────────────
// Trigger de mensajes directos (directMessages.ts).
//
// Es el único que puede escribir `lastMessage`, `lastMessageAt` y `unread`: las
// rules se lo prohíben al cliente para que nadie pueda falsear su propio inbox.
// Aquí se comprueba que lo haga bien y —sobre todo— que NO empuje una solicitud
// pendiente ni un hilo bloqueado, y que NUNCA cree entrada en la campanita.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const testEnv = functionsTest();
const appOpt = { firebaseApp: admin.app() };

function uid(): string {
  return crypto.randomUUID();
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no definido. Corre: npm run test:emulator");
  }
});

beforeEach(() => {
  vi.mocked(sendPushToUser).mockClear();
});

async function seedConversation(params: {
  sender: string;
  recipient: string;
  status: "active" | "request" | "blocked";
  mutedBy?: string[];
}) {
  const conversationId = [params.sender, params.recipient].sort().join("_");
  await db.doc(`conversations/${conversationId}`).set({
    participants: [params.sender, params.recipient].sort(),
    participantsKey: conversationId,
    status: params.status,
    createdBy: params.sender,
    lastMessage: null,
    lastMessageAt: null,
    blockedBy: params.status === "blocked" ? params.recipient : null,
    unread: {},
    lastReadAt: {},
    firstMessageId: "m0",
    ...(params.mutedBy ? { mutedBy: params.mutedBy } : {}),
  });
  await db.doc(`users/${params.sender}`).set({ displayName: "Emisor" });
  await db.doc(`users/${params.recipient}`).set({ displayName: "Receptor" });
  return conversationId;
}

async function fireMessage(conversationId: string, senderId: string, text: string) {
  const messageId = `m_${uid()}`;
  const path = `conversations/${conversationId}/messages/${messageId}`;
  const data = {
    senderId,
    text,
    createdAt: admin.firestore.Timestamp.now(),
    isDeleted: false,
  };
  await db.doc(path).set(data);

  const wrapped = testEnv.wrap(onDirectMessageCreated);
  await wrapped({
    data: testEnv.firestore.makeDocumentSnapshot(data, path, appOpt),
    params: { conversationId, messageId },
  } as never);

  return messageId;
}

async function readConversation(conversationId: string) {
  const s = await db.doc(`conversations/${conversationId}`).get();
  return (s.data() ?? {}) as Record<string, unknown>;
}

async function notificationCount(recipient: string): Promise<number> {
  const s = await db.collection(`users/${recipient}/notifications`).get();
  return s.size;
}

describe("onDirectMessageCreated — resumen del hilo y no leídos", () => {
  it("denormaliza lastMessage/lastMessageAt e incrementa el unread del DESTINATARIO", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    await fireMessage(conversationId, sender, "hola");

    const conv = await readConversation(conversationId);
    const lastMessage = conv.lastMessage as Record<string, unknown>;
    expect(lastMessage.text).toBe("hola");
    expect(lastMessage.senderId).toBe(sender);
    expect(conv.lastMessageAt).toBeTruthy();

    const unread = conv.unread as Record<string, number>;
    expect(unread[recipient]).toBe(1);
    // Al emisor nunca se le cuenta como no leído lo que él mismo escribió.
    expect(unread[sender]).toBeUndefined();
  });

  it("varios mensajes acumulan el contador", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    await fireMessage(conversationId, sender, "uno");
    await fireMessage(conversationId, sender, "dos");
    await fireMessage(conversationId, sender, "tres");

    const conv = await readConversation(conversationId);
    const unread = conv.unread as Record<string, number>;
    expect(unread[recipient]).toBe(3);
    expect((conv.lastMessage as Record<string, unknown>).text).toBe("tres");
  });

  it("un hilo inexistente no rompe el trigger", async () => {
    const sender = `s_${uid()}`;
    const conversationId = `ghost_${uid()}`;
    await expect(fireMessage(conversationId, sender, "hola")).resolves.toBeTruthy();
  });
});

describe("onDirectMessageCreated — a quién se le empuja", () => {
  it("un hilo ACTIVO sí manda push, al DESTINATARIO", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    await fireMessage(conversationId, sender, "hola");

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    const [uidArg, payload] = vi.mocked(sendPushToUser).mock.calls[0];
    expect(uidArg).toBe(recipient);
    expect(payload.body).toBe("hola");
    // El hilo vive en su propia ruta desde que se separó de comunidades; el
    // deep link viejo (`/groups?dm=…`) ya no existe en ningún lado.
    expect(payload.link).toBe(`/mensajes/${conversationId}`);
    // Mismo tag por hilo ⇒ los avisos seguidos se colapsan en el dispositivo.
    expect(payload.tag).toBe(`dm_${conversationId}`);
  });

  // Lo importante de este bloque: una solicitud de un desconocido no debe sonar
  // en el teléfono de nadie. Se ve al entrar a la bandeja de Solicitudes.
  it("🔴 una SOLICITUD pendiente NO manda push", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "request" });

    await fireMessage(conversationId, sender, "hola desconocido");

    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("🔴 un hilo BLOQUEADO tampoco manda push", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "blocked" });

    await fireMessage(conversationId, sender, "hola");

    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  // Un DM tiene su propia bandeja (la pestaña de Mensajes). Duplicarlo en la
  // campanita sería ruido, así que el trigger NO escribe ahí nunca.
  it("🔴 un DM NUNCA crea entrada en la campanita", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    await fireMessage(conversationId, sender, "uno");
    await fireMessage(conversationId, sender, "dos");

    expect(await notificationCount(recipient)).toBe(0);
    expect(await notificationCount(sender)).toBe(0);
  });

  it("pero la solicitud SÍ actualiza el resumen del hilo (solo no empuja)", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "request" });

    await fireMessage(conversationId, sender, "hola");

    const conv = await readConversation(conversationId);
    expect((conv.lastMessage as Record<string, unknown>).text).toBe("hola");
    expect((conv.unread as Record<string, number>)[recipient]).toBe(1);
  });

  // Silenciar apaga el aviso, NO la conversación. Es la distinción que importa:
  // si además dejara de contar los no leídos, silenciar sería esconder mensajes.
  it("🔴 un hilo SILENCIADO por el destinatario no manda push", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({
      sender,
      recipient,
      status: "active",
      mutedBy: [recipient],
    });

    await fireMessage(conversationId, sender, "hola");

    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("silenciado, el mensaje se sigue guardando y contando", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({
      sender,
      recipient,
      status: "active",
      mutedBy: [recipient],
    });

    await fireMessage(conversationId, sender, "hola");

    const conv = await readConversation(conversationId);
    expect((conv.lastMessage as Record<string, unknown>).text).toBe("hola");
    expect((conv.unread as Record<string, number>)[recipient]).toBe(1);
  });

  // Silenciar es de UNO: que yo calle un hilo no puede callárselo al otro.
  it("si quien silenció es el EMISOR, al destinatario sí le llega", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({
      sender,
      recipient,
      status: "active",
      mutedBy: [sender],
    });

    await fireMessage(conversationId, sender, "hola");

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vista previa del inbox (directMessagePreview.ts).
//
// `lastMessage` se escribe al CREAR el mensaje y nadie la volvía a tocar. El caso
// que de verdad importa: retiras un mensaje y la frase que querías quitar se
// seguía leyendo en la lista de conversaciones.
// ─────────────────────────────────────────────────────────────────────────────

/** Dispara el trigger de cambio con el antes y el después del mensaje. */
async function fireMessageChange(
  conversationId: string,
  messageId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const path = `conversations/${conversationId}/messages/${messageId}`;
  await db.doc(path).set(after);

  const wrapped = testEnv.wrap(onDirectMessageChangedUpdatePreview);
  await wrapped({
    data: {
      before: testEnv.firestore.makeDocumentSnapshot(before, path, appOpt),
      after: testEnv.firestore.makeDocumentSnapshot(after, path, appOpt),
    },
    params: { convId: conversationId, messageId },
  } as never);
}

describe("onDirectMessageChangedUpdatePreview — la bandeja no se queda vieja", () => {
  it("editar el último mensaje actualiza la vista previa", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    const messageId = await fireMessage(conversationId, sender, "texto viejo");
    const createdAt = admin.firestore.Timestamp.now();

    await fireMessageChange(
      conversationId,
      messageId,
      { senderId: sender, text: "texto viejo", isDeleted: false, createdAt },
      { senderId: sender, text: "texto nuevo", isDeleted: false, createdAt }
    );

    const conv = await readConversation(conversationId);
    expect((conv.lastMessage as Record<string, unknown>).text).toBe("texto nuevo");
  });

  // Lo importante: del mensaje retirado NO se guarda el texto. Se manda una
  // bandera y la frase la pone la interfaz, en el idioma de quien mira.
  it("retirar el último mensaje borra su texto de la vista previa", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    const messageId = await fireMessage(conversationId, sender, "algo comprometedor");
    const createdAt = admin.firestore.Timestamp.now();

    await fireMessageChange(
      conversationId,
      messageId,
      { senderId: sender, text: "algo comprometedor", isDeleted: false, createdAt },
      { senderId: sender, text: "algo comprometedor", isDeleted: true, createdAt }
    );

    const lastMessage = (await readConversation(conversationId)).lastMessage as Record<
      string,
      unknown
    >;
    expect(lastMessage.text).toBe("");
    expect(lastMessage.isDeleted).toBe(true);
  });

  it("🔴 editar un mensaje que NO es el último deja la vista previa en paz", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    const primero = await fireMessage(conversationId, sender, "el primero");
    await fireMessage(conversationId, sender, "el último");
    const createdAt = (
      await db.doc(`conversations/${conversationId}/messages/${primero}`).get()
    ).data()?.createdAt;

    await fireMessageChange(
      conversationId,
      primero,
      { senderId: sender, text: "el primero", isDeleted: false, createdAt },
      { senderId: sender, text: "editado", isDeleted: false, createdAt }
    );

    const conv = await readConversation(conversationId);
    expect((conv.lastMessage as Record<string, unknown>).text).toBe("el último");
  });

  // `deletedFor` es ocultar SOLO para uno. El resumen es común a los dos, así que
  // no debe moverse: si lo hiciera, ocultar un mensaje se lo cambiaría al otro.
  it("🔴 ocultar para uno mismo no toca la vista previa", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });

    const messageId = await fireMessage(conversationId, sender, "hola");
    const createdAt = admin.firestore.Timestamp.now();

    await fireMessageChange(
      conversationId,
      messageId,
      { senderId: sender, text: "hola", isDeleted: false, createdAt },
      { senderId: sender, text: "hola", isDeleted: false, createdAt, deletedFor: [recipient] }
    );

    const conv = await readConversation(conversationId);
    expect((conv.lastMessage as Record<string, unknown>).text).toBe("hola");
    expect((conv.lastMessage as Record<string, unknown>).isDeleted).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Limpieza de imágenes (directMessageImageCleanup.ts).
//
// Retirar un mensaje es un borrado lógico: el documento se queda. El archivo NO
// debe quedarse. Y hay que distinguir las dos formas de borrar del DM.
// ─────────────────────────────────────────────────────────────────────────────

async function fireImageCleanup(
  conversationId: string,
  messageId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const path = `conversations/${conversationId}/messages/${messageId}`;
  await db.doc(path).set(after);

  const wrapped = testEnv.wrap(onDirectMessageDeletedCleanupImage);
  await wrapped({
    data: {
      before: testEnv.firestore.makeDocumentSnapshot(before, path, appOpt),
      after: testEnv.firestore.makeDocumentSnapshot(after, path, appOpt),
    },
    params: { convId: conversationId, messageId },
  } as never);

  return (await db.doc(path).get()).data() ?? {};
}

describe("onDirectMessageDeletedCleanupImage — el archivo no sobrevive al mensaje", () => {
  const imagen = {
    path: "dmImages/c/u/images/a.jpg",
    thumbnailPath: "dmImages/c/u/thumbnails/a.jpg",
  };

  it("retirar para los dos limpia la imagen del documento", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });
    const createdAt = admin.firestore.Timestamp.now();

    const after = await fireImageCleanup(
      conversationId,
      `m_${uid()}`,
      { senderId: sender, text: "", isDeleted: false, createdAt, image: imagen },
      { senderId: sender, text: "", isDeleted: true, createdAt, image: imagen }
    );

    expect(after.image).toBeNull();
  });

  // La distinción que hay que no romper nunca: ocultar para MÍ no puede borrarle
  // la foto al otro, que no ha borrado nada.
  it("🔴 ocultar solo para uno NO toca la imagen", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });
    const createdAt = admin.firestore.Timestamp.now();

    const after = await fireImageCleanup(
      conversationId,
      `m_${uid()}`,
      { senderId: sender, text: "", isDeleted: false, createdAt, image: imagen },
      {
        senderId: sender,
        text: "",
        isDeleted: false,
        createdAt,
        image: imagen,
        deletedFor: [recipient],
      }
    );

    expect(after.image).toEqual(imagen);
  });

  // Reintentar un trigger es normal; la segunda vuelta no debe hacer nada.
  it("🔴 un mensaje que YA estaba retirado no vuelve a limpiarse", async () => {
    const sender = `s_${uid()}`;
    const recipient = `r_${uid()}`;
    const conversationId = await seedConversation({ sender, recipient, status: "active" });
    const createdAt = admin.firestore.Timestamp.now();

    const after = await fireImageCleanup(
      conversationId,
      `m_${uid()}`,
      { senderId: sender, text: "", isDeleted: true, createdAt, image: imagen },
      { senderId: sender, text: "", isDeleted: true, createdAt, image: imagen }
    );

    expect(after.image).toEqual(imagen);
  });
});
