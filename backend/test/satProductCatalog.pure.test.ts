// Las claves del SAT que van en cada factura al comprador.
//
// Se fijan en un test porque es lo que aparece en TODAS las facturas: un error aquí no se ve en
// pantalla, se ve meses después en una revisión.

import { describe, it, expect } from "vitest";
import { productForType } from "../src/facturacion/satProductCatalog";
import type { LedgerServiceType } from "../src/wallet/ledger";

/** Los once. Si se añade uno y no se pone aquí, el test de cobertura falla. */
const TODOS: LedgerServiceType[] = [
  "supercomment", "profile_donation", "live_donation", "live_ticket", "premium_post",
  "greeting", "advice", "exclusive_session", "live_session", "subscription", "vod_ticket",
];

describe("claves del SAT por servicio", () => {
  it("el contenido grabado va con Entretenimiento grabado en video", () => {
    for (const t of ["greeting", "advice", "premium_post", "vod_ticket"] as const) {
      expect(productForType(t).productKey).toBe("90131602");
    }
  });

  it("lo que ocurre en directo va con Actuaciones en vivo", () => {
    for (const t of ["live_ticket", "exclusive_session", "live_session"] as const) {
      expect(productForType(t).productKey).toBe("90131500");
    }
  });

  it("la suscripción va con Plataformas de multimedia", () => {
    // No compra una pieza, compra acceso continuo.
    expect(productForType("subscription").productKey).toBe("43233419");
  });

  it("los apoyos van gravados como servicio, no como donativo", () => {
    // ⚠️ Vibra no es donataria autorizada y el creador tampoco: este dinero es un ingreso por
    // su actividad. Y en el súper comentario hay contraprestación, el mensaje se destaca.
    for (const t of ["profile_donation", "live_donation", "supercomment"] as const) {
      expect(productForType(t).productKey).toBe("90131602");
    }
  });
});

describe("cobertura", () => {
  it("los once tienen descripción propia, ninguno cae al genérico", () => {
    // 🚨 Esto es lo que estaba roto antes del 2026-08-29: el mapa usaba claves escritas a mano
    // —`saludo` en vez de `greeting`— y SIETE de los once caían a «Servicio digital en Vibra».
    const genericos = TODOS.filter(
      (t) => productForType(t).description === "Servicio digital en Vibra"
    );
    expect(genericos).toEqual([]);
  });

  it("los once tienen una de las tres claves acordadas", () => {
    const validas = ["90131602", "90131500", "43233419"];
    for (const t of TODOS) {
      expect(validas).toContain(productForType(t).productKey);
    }
  });

  it("los once usan la unidad de servicio", () => {
    for (const t of TODOS) expect(productForType(t).unitKey).toBe("E48");
  });

  it("un tipo desconocido no rompe la factura", () => {
    // Un asiento viejo podría traer un tipo que ya no existe. Mejor genérico que un CFDI que
    // no timbra.
    const r = productForType("tipo_que_ya_no_existe");
    expect(r.description).toBe("Servicio digital en Vibra");
    expect(r.productKey).toBe("90131602");
    expect(r.unitKey).toBe("E48");
  });
});
