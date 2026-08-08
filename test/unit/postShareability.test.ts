import { describe, it, expect, vi } from "vitest";

// `post-service.hydration` arrastra el cliente de Firebase por sus vecinos de
// módulo; aquí solo se prueban funciones puras, así que se stubea (sin esto,
// `getAuth` revienta por falta de credenciales en el entorno de tests).
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, storage: {}, app: {} }));

// El módulo del backend inicializa Admin SDK al importarse; se stubea porque
// `resolveIsShareable` es pura y es justo la que tiene que coincidir con la del
// frontend.
vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: () => undefined,
  firestore: () => ({}),
}));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentUpdated: () => ({}) }));
vi.mock("firebase-functions/logger", () => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}));

import { buildShareMetadata } from "@/lib/posts/post-service.hydration";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- el backend está fuera del tsconfig del front; en runtime vitest lo resuelve igual
import { resolveIsShareable } from "../../backend/src/groupPostsVisibilitySync";

// ─────────────────────────────────────────────────────────────────────────────
// `isShareable` es el interruptor del que cuelga TODA la visibilidad hacia fuera
// de una comunidad: si queda mal, el post premium no se puede vender desde
// fuera, o —peor— se expone contenido que no debía salir.
//
// Se escribe en DOS sitios que deben coincidir siempre:
//   1. al crear el post           → buildShareMetadata (frontend)
//   2. al cambiar la visibilidad  → resolveIsShareable (Cloud Function)
// ─────────────────────────────────────────────────────────────────────────────

type Visibility = "public" | "private" | "hidden";

const premium = (accessMode: "public" | "members_only") => ({
  enabled: true as const,
  kind: "video" as const,
  accessMode,
  freeFor: "none" as const,
  price: 100,
  currency: "MXN" as const,
  purchaseType: "one_time" as const,
});

function shareableAtCreate(params: {
  groupVisibility?: Visibility | null;
  contextType?: "group" | "profile";
  profileRestricted?: boolean;
  premium?: ReturnType<typeof premium> | null;
  accessModel?: "free" | "one_time_purchase";
  requiresPayment?: boolean;
}): boolean {
  return buildShareMetadata({
    text: "post",
    contextType: params.contextType ?? "group",
    groupVisibility: params.groupVisibility ?? null,
    profileRestricted: params.profileRestricted ?? false,
    premium: params.premium ?? null,
    accessModel: params.accessModel ?? "free",
    requiresPayment: params.requiresPayment ?? false,
    requiresSubscription: false,
  }).isShareable === true;
}

describe("post premium — isShareable al CREAR", () => {
  it("premium público en comunidad PÚBLICA → compartible", () => {
    expect(
      shareableAtCreate({
        groupVisibility: "public",
        premium: premium("public"),
        accessModel: "one_time_purchase",
        requiresPayment: true,
      }),
    ).toBe(true);
  });

  it("premium público en comunidad PRIVADA (o de suscripción) → compartible", () => {
    expect(
      shareableAtCreate({
        groupVisibility: "private",
        premium: premium("public"),
        accessModel: "one_time_purchase",
        requiresPayment: true,
      }),
    ).toBe(true);
  });

  it("premium SOLO MIEMBROS en comunidad privada → NO compartible", () => {
    expect(
      shareableAtCreate({
        groupVisibility: "private",
        premium: premium("members_only"),
        accessModel: "one_time_purchase",
        requiresPayment: true,
      }),
    ).toBe(false);
  });

  it("comunidad OCULTA nunca expone nada, ni marcado como público", () => {
    expect(
      shareableAtCreate({
        groupVisibility: "hidden",
        premium: premium("public"),
        accessModel: "one_time_purchase",
        requiresPayment: true,
      }),
    ).toBe(false);
  });

  it("post gratis en comunidad privada → NO compartible", () => {
    expect(shareableAtCreate({ groupVisibility: "private" })).toBe(false);
  });

  it("post gratis en comunidad pública → compartible", () => {
    expect(shareableAtCreate({ groupVisibility: "public" })).toBe(true);
  });

  it("premium de PERFIL: el perfil manda (no depende de comunidad)", () => {
    expect(
      shareableAtCreate({
        contextType: "profile",
        premium: premium("public"),
        accessModel: "one_time_purchase",
        requiresPayment: true,
        profileRestricted: false,
      }),
    ).toBe(false); // de pago ⇒ no entra por la vía "gratis + perfil público"
    expect(shareableAtCreate({ contextType: "profile", profileRestricted: false })).toBe(true);
    expect(shareableAtCreate({ contextType: "profile", profileRestricted: true })).toBe(false);
  });
});

describe("VOD / live — isShareable al RESINCRONIZAR (Cloud Function)", () => {
  const live = (visibilityMode: string, extra: Record<string, unknown> = {}) => ({
    liveData: { visibilityMode, ...extra },
  });

  it("live/VOD para TODOS → compartible", () => {
    expect(resolveIsShareable(live("everyone"), "private")).toBe(true);
  });

  it("live/VOD SOLO CON CUENTA → compartible (el filtro de invitados va aparte)", () => {
    expect(resolveIsShareable(live("logged_in_only"), "private")).toBe(true);
  });

  it("live/VOD SOLO MIEMBROS → NO compartible", () => {
    expect(resolveIsShareable(live("members_only"), "private")).toBe(false);
    expect(resolveIsShareable(live("members_only"), "public")).toBe(false);
  });

  it("VOD oculto por el creador → NO compartible aunque el live fuera para todos", () => {
    expect(resolveIsShareable(live("everyone", { vodHidden: true }), "public")).toBe(false);
  });

  it("comunidad OCULTA → nunca", () => {
    expect(resolveIsShareable(live("everyone"), "hidden")).toBe(false);
  });
});

describe("paridad entre CREAR y RESINCRONIZAR (no pueden divergir)", () => {
  const cases: Array<{
    name: string;
    visibility: Visibility;
    premium: ReturnType<typeof premium> | null;
    paid: boolean;
  }> = [
    { name: "premium público / pública", visibility: "public", premium: premium("public"), paid: true },
    { name: "premium público / privada", visibility: "private", premium: premium("public"), paid: true },
    { name: "premium miembros / privada", visibility: "private", premium: premium("members_only"), paid: true },
    { name: "premium público / oculta", visibility: "hidden", premium: premium("public"), paid: true },
    { name: "gratis / pública", visibility: "public", premium: null, paid: false },
    { name: "gratis / privada", visibility: "private", premium: null, paid: false },
    { name: "gratis / oculta", visibility: "hidden", premium: null, paid: false },
  ];

  for (const c of cases) {
    it(`coinciden: ${c.name}`, () => {
      const atCreate = shareableAtCreate({
        groupVisibility: c.visibility,
        premium: c.premium,
        accessModel: c.paid ? "one_time_purchase" : "free",
        requiresPayment: c.paid,
      });

      const atSync = resolveIsShareable(
        {
          premium: c.premium,
          accessModel: c.paid ? "one_time_purchase" : "free",
          requiresPayment: c.paid,
          requiresSubscription: false,
        },
        c.visibility,
      );

      expect(atSync).toBe(atCreate);
    });
  }
});
