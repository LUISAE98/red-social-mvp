import { describe, it, expect } from "vitest";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";

import {
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  buildOffering,
  buildServiceBlockDraft,
  calcNetAmount,
  createEmptyDraft,
  createEmptyWeeklyAvailability,
  normalizeDurationMeta,
  normalizeSuggestedAmounts,
  pickDonation,
  pickOffering,
  sameDraft,
  sameWeeklyAvailability,
  type DonationInput,
  type ServiceBlockDraft,
} from "../../lib/services/serviceDraft";
import type { CreatorServiceMeta } from "../../types/group";

/**
 * Estas funciones nacieron duplicadas en los dos paneles de configuración de
 * experiencias (perfil y comunidad) y se fusionaron en un solo módulo. Los tests
 * fijan las TRES reglas que de verdad difieren entre superficies, que es
 * justamente lo que se podía romper al unificar.
 *
 * Es código de dinero: precios, monedas y visibilidad de servicios de pago. Un
 * fallo aquí no revienta, cobra mal o esconde un servicio.
 */

const block = (over: Partial<ServiceBlockDraft> = {}): ServiceBlockDraft => ({
  enabled: true,
  price: "100",
  currency: "MXN",
  visible: true,
  visibility: "public",
  ...over,
});

describe("Borrador vacío · la visibilidad por omisión depende de la superficie", () => {
  it("en perfil los servicios nacen públicos", () => {
    const draft = createEmptyDraft("profile");
    expect(draft.saludo.visibility).toBe("public");
    expect(draft.consejo.visibility).toBe("public");
    expect(draft.meetGreet.visibility).toBe("public");
    expect(draft.customClass.visibility).toBe("public");
  });

  it("en comunidad nacen restringidos a miembros", () => {
    const draft = createEmptyDraft("community");
    expect(draft.saludo.visibility).toBe("members");
    expect(draft.customClass.visibility).toBe("members");
  });

  it("nace todo apagado y sin precio, en la moneda de liquidación", () => {
    const draft = createEmptyDraft("profile");
    expect(draft.saludo.enabled).toBe(false);
    expect(draft.saludo.price).toBe("");
    expect(draft.saludo.currency).toBe(SETTLEMENT_CURRENCY);
    expect(draft.donationMode).toBe("none");
  });

  it("la disponibilidad semanal arranca con los siete días vacíos", () => {
    const { availability } = createEmptyDraft("profile").customClass;
    expect(Object.keys(availability)).toHaveLength(7);
    expect(Object.values(availability).every((day) => day.length === 0)).toBe(true);
  });

  it("🚨 cada bloque es un objeto independiente, no una referencia compartida", () => {
    // Si `emptyBlock()` se reusara por referencia, tocar el precio de un
    // servicio cambiaría el de todos los demás.
    const draft = createEmptyDraft("profile");
    draft.saludo.price = "500";
    expect(draft.consejo.price).toBe("");
  });
});

describe("Lectura de un servicio guardado · precedencia de precio", () => {
  const offerings = [
    { type: "saludo" as const, enabled: true, publicPrice: 200, memberPrice: 120, price: 999 },
  ];

  it("🚨 el perfil toma el precio PÚBLICO primero", () => {
    expect(pickOffering("profile", offerings, "saludo").price).toBe(200);
  });

  it("🚨 la comunidad toma el precio de MIEMBRO primero", () => {
    expect(pickOffering("community", offerings, "saludo").price).toBe(120);
  });

  it("cae a `price` cuando no hay ni público ni de miembro", () => {
    const legacy = [{ type: "saludo" as const, enabled: true, price: 80 }];
    expect(pickOffering("profile", legacy, "saludo").price).toBe(80);
    expect(pickOffering("community", legacy, "saludo").price).toBe(80);
  });

  it("un servicio inexistente devuelve apagado y sin precio", () => {
    const result = pickOffering("profile", offerings, "consejo");
    expect(result.enabled).toBe(false);
    expect(result.price).toBeNull();
  });

  it("sin lista o con basura no revienta", () => {
    expect(pickOffering("profile", null, "saludo").enabled).toBe(false);
    expect(pickOffering("profile", undefined, "saludo").enabled).toBe(false);
  });

  it("`visible` cae al valor de `enabled` cuando no está guardado", () => {
    const sinVisible = [{ type: "saludo" as const, enabled: true, publicPrice: 10 }];
    expect(pickOffering("profile", sinVisible, "saludo").visible).toBe(true);
  });
});

describe("Guardado de un servicio · las reglas que separan perfil de comunidad", () => {
  it("🚨 el perfil descarta la visibilidad elegida y guarda public/hidden", () => {
    const activo = buildOffering({
      surface: "profile",
      type: "saludo",
      draft: block({ visibility: "members" }),
      displayOrder: 0,
    });
    // Un perfil no tiene miembros: "members" no significa nada ahí.
    expect(activo.visibility).toBe("public");

    const apagado = buildOffering({
      surface: "profile",
      type: "saludo",
      draft: block({ enabled: false, visibility: "members" }),
      displayOrder: 0,
    });
    expect(apagado.visibility).toBe("hidden");
  });

  it("🚨 la comunidad SÍ respeta la visibilidad elegida", () => {
    const offering = buildOffering({
      surface: "community",
      type: "saludo",
      draft: block({ visibility: "members" }),
      displayOrder: 0,
    });
    expect(offering.visibility).toBe("members");
  });

  it("🚨 el perfil fuerza `visible: false` al apagar; la comunidad no", () => {
    const perfil = buildOffering({
      surface: "profile",
      type: "saludo",
      draft: block({ enabled: false, visible: true }),
      displayOrder: 0,
    });
    expect(perfil.visible).toBe(false);

    const comunidad = buildOffering({
      surface: "community",
      type: "saludo",
      draft: block({ enabled: false, visible: true }),
      displayOrder: 0,
    });
    expect(comunidad.visible).toBe(true);
  });

  it("el origen queda marcado según la superficie", () => {
    expect(
      buildOffering({ surface: "profile", type: "saludo", draft: block(), displayOrder: 0 })
        .sourceScope
    ).toBe("profile");
    expect(
      buildOffering({ surface: "community", type: "saludo", draft: block(), displayOrder: 0 })
        .sourceScope
    ).toBe("group");
  });

  it("🚨 un servicio apagado se guarda SIN precio y SIN moneda", () => {
    // Dejar precio en un servicio apagado deja munición para cobrar por algo
    // que el creador cree desactivado.
    const offering = buildOffering({
      surface: "profile",
      type: "saludo",
      draft: block({ enabled: false }),
      displayOrder: 0,
    });
    expect(offering.memberPrice).toBeNull();
    expect(offering.publicPrice).toBeNull();
    expect(offering.price).toBeNull();
    expect(offering.currency).toBeNull();
  });

  // 🚨 El guardián del bug de `resolveStoredPrice`: el borrador puede traer CUALQUIER
  // moneda y buildOffering tiene que forzar la de liquidación. Lo que cambió con el corte
  // a USD (2026-08-18) es cuál es esa moneda, no la invariante. El caso adversario ahora
  // es un borrador en MXN, que es la que quedó obsoleta.
  it("🚨 el precio se guarda SIEMPRE en la moneda de liquidación, diga lo que diga el borrador", () => {
    const offering = buildOffering({
      surface: "profile",
      type: "saludo",
      draft: block({ currency: "MXN", price: "250" }),
      displayOrder: 0,
    });
    expect(offering.currency).toBe(SETTLEMENT_CURRENCY);
    expect(offering.price).toBe(250);
  });

  it("un precio vacío se guarda como nulo, no como cero", () => {
    const offering = buildOffering({
      surface: "profile",
      type: "saludo",
      draft: block({ price: "  " }),
      displayOrder: 0,
    });
    expect(offering.price).toBeNull();
  });
});

describe("Comparadores · protegen lo que estás editando", () => {
  it("dos borradores recién creados de la misma superficie son iguales", () => {
    expect(sameDraft(createEmptyDraft("profile"), createEmptyDraft("profile"))).toBe(true);
  });

  it("🚨 detecta un cambio de precio, que es lo que se estaría pisando", () => {
    const a = createEmptyDraft("profile");
    const b = createEmptyDraft("profile");
    b.saludo.price = "150";
    expect(sameDraft(a, b)).toBe(false);
  });

  it("detecta cambios en cualquiera de los servicios, no solo en el primero", () => {
    for (const key of ["saludo", "consejo", "meetGreet", "customClass"] as const) {
      const a = createEmptyDraft("profile");
      const b = createEmptyDraft("profile");
      b[key].enabled = true;
      expect(sameDraft(a, b), `no detectó el cambio en ${key}`).toBe(false);
    }
  });

  it("detecta cambios en la duración, que no está en el bloque común", () => {
    const a = createEmptyDraft("profile");
    const b = createEmptyDraft("profile");
    b.meetGreet.durationMinutes = "15";
    expect(sameDraft(a, b)).toBe(false);
  });

  it("detecta cambios en los datos de donación", () => {
    const a = createEmptyDraft("profile");
    const b = createEmptyDraft("profile");
    b.donationGoalLabel = "Para el estudio";
    expect(sameDraft(a, b)).toBe(false);

    const c = createEmptyDraft("profile");
    c.donationSuggestedAmounts = ["1", "2", "3", "4"];
    expect(sameDraft(a, c)).toBe(false);
  });

  it("🚨 perfil y comunidad NO son iguales: difieren en la visibilidad de origen", () => {
    expect(sameDraft(createEmptyDraft("profile"), createEmptyDraft("community"))).toBe(false);
  });

  it("la disponibilidad semanal compara horarios, no solo cantidad", () => {
    const vacia = createEmptyWeeklyAvailability();

    const conFranja = createEmptyWeeklyAvailability();
    conFranja.monday = [{ start: "09:00", end: "10:00" }];
    expect(sameWeeklyAvailability(vacia, conFranja)).toBe(false);

    const otraHora = createEmptyWeeklyAvailability();
    otraHora.monday = [{ start: "11:00", end: "12:00" }];
    expect(sameWeeklyAvailability(conFranja, otraHora)).toBe(false);

    const igual = createEmptyWeeklyAvailability();
    igual.monday = [{ start: "09:00", end: "10:00" }];
    expect(sameWeeklyAvailability(conFranja, igual)).toBe(true);
  });

  it("compara los siete días, no solo el lunes", () => {
    const a = createEmptyWeeklyAvailability();
    const b = createEmptyWeeklyAvailability();
    b.sunday = [{ start: "08:00", end: "09:00" }];
    expect(sameWeeklyAvailability(a, b)).toBe(false);
  });
});

describe("Neto que recibe el creador", () => {
  it("descuenta la comisión de la plataforma", () => {
    // 25% de comisión ⇒ el creador se queda con el 75%.
    expect(calcNetAmount("100")).toEqual({ gross: 100, net: 75 });
  });

  it("rechaza vacío, cero, negativos y texto", () => {
    expect(calcNetAmount("")).toBeNull();
    expect(calcNetAmount("   ")).toBeNull();
    expect(calcNetAmount("0")).toBeNull();
    expect(calcNetAmount("-50")).toBeNull();
    expect(calcNetAmount("abc")).toBeNull();
  });
});

describe("Montos sugeridos de donación", () => {
  it("siempre devuelve exactamente cuatro", () => {
    expect(normalizeSuggestedAmounts([])).toHaveLength(4);
    expect(normalizeSuggestedAmounts(null)).toHaveLength(4);
    expect(normalizeSuggestedAmounts([1, 2, 3, 4, 5, 6])).toHaveLength(4);
  });

  it("conserva los válidos y rellena el resto con el default de esa posición", () => {
    const result = normalizeSuggestedAmounts([10, "no", 0, 400]);
    expect(result[0]).toBe("10");
    expect(result[1]).toBe(DEFAULT_DONATION_SUGGESTED_AMOUNTS[1]);
    expect(result[2]).toBe(DEFAULT_DONATION_SUGGESTED_AMOUNTS[2]);
    expect(result[3]).toBe("400");
  });
});

describe("Duración de los servicios con tiempo", () => {
  it("lee los minutos de cada modo", () => {
    const meta = {
      meetGreet: { durationMinutes: 15 },
      customClass: { durationMinutes: 60, availability: {} },
    } as unknown as CreatorServiceMeta;
    expect(normalizeDurationMeta(meta, "meetGreet")).toBe("15");
    expect(normalizeDurationMeta(meta, "customClass")).toBe("60");
  });

  it("descarta ausencias, ceros y valores no numéricos", () => {
    expect(normalizeDurationMeta(null, "meetGreet")).toBe("");
    expect(normalizeDurationMeta({ meetGreet: { durationMinutes: 0 } } as CreatorServiceMeta, "meetGreet")).toBe("");
    expect(
      normalizeDurationMeta({ meetGreet: { durationMinutes: "x" } } as unknown as CreatorServiceMeta, "meetGreet")
    ).toBe("");
  });
});

describe("Lectura de la donación", () => {
  it("acepta solo los modos conocidos", () => {
    expect(pickDonation({ mode: "general" }).mode).toBe("general");
    expect(pickDonation({ mode: "wedding" }).mode).toBe("wedding");
    // Un modo desconocido (dato viejo o corrupto) cae a "none", no lo propaga.
    expect(pickDonation({ mode: "cualquier-cosa" } as unknown as DonationInput).mode).toBe("none");
    expect(pickDonation(null).mode).toBe("none");
  });

  it("los textos ausentes quedan como cadena vacía, no como undefined", () => {
    const donation = pickDonation(null);
    expect(donation.goalLabel).toBe("");
    expect(donation.message).toBe("");
    expect(donation.videoUrl).toBe("");
    expect(donation.playbackId).toBe("");
    expect(donation.currency).toBe(SETTLEMENT_CURRENCY);
  });
});

describe("Construcción del bloque desde lo guardado", () => {
  it("convierte el precio numérico a texto editable", () => {
    const draft = buildServiceBlockDraft({
      enabled: true,
      price: 150,
      currency: "MXN",
      visible: true,
      visibility: "public",
    });
    expect(draft.price).toBe("150");
  });

  it("un precio nulo se edita como campo vacío", () => {
    const draft = buildServiceBlockDraft({
      enabled: false,
      price: null,
      currency: "MXN",
      visible: false,
      visibility: "public",
    });
    expect(draft.price).toBe("");
  });
});
