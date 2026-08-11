import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";

// El push se envía DIRECTO, sin pasar por `users/{uid}/notifications`: un DM no
// va a la campanita. Se mockea para poder afirmar a quién se le empuja y a quién
// no, sin depender de FCM (que no existe en el emulador).
vi.mock("../src/push", () => ({ sendPushToUser: vi.fn(async () => {}) }));

import { onDirectMessageCreated } from "../src/directMessages";
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
});
