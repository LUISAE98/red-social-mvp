import { describe, it, expect } from "vitest";
import {
  normalizeOrderPaymentStatus,
  parseExternalReference,
  splitCompoundId,
} from "../src/payments/reconcile";

// Parseo del external_reference: liga cada pago de MP con su documento de dominio.
// Si esto parte mal el string, un pago aprobado se aplicaría al recurso equivocado
// (o a ninguno). El sourceId de live/superComment embebe DOS ids con "_", así que
// el orden de los cortes importa.
describe("parseExternalReference", () => {
  it("parte por el primer '__' en {sourceType}__{sourceId}", () => {
    expect(parseExternalReference("greetingRequest__abc123")).toEqual({
      sourceType: "greetingRequest",
      sourceId: "abc123",
    });
  });

  it("conserva guiones bajos simples dentro del sourceId (live/superComment)", () => {
    expect(parseExternalReference("liveAccess__live99_userXY")).toEqual({
      sourceType: "liveAccess",
      sourceId: "live99_userXY",
    });
  });

  it("sin '__' -> null (no crashea; el caller hace warn y no aplica nada)", () => {
    expect(parseExternalReference("sinSeparador")).toBeNull();
    expect(parseExternalReference("")).toBeNull();
  });

  it("solo parte en el PRIMER '__' aunque haya más", () => {
    expect(parseExternalReference("a__b__c")).toEqual({
      sourceType: "a",
      sourceId: "b__c",
    });
  });
});

describe("splitCompoundId", () => {
  it("parte por el primer '_' en {head}_{tail}", () => {
    expect(splitCompoundId("live99_userXY")).toEqual({ head: "live99", tail: "userXY" });
  });

  it("tail conserva guiones bajos posteriores", () => {
    expect(splitCompoundId("post1_donation_2")).toEqual({ head: "post1", tail: "donation_2" });
  });

  it("sin '_' -> null", () => {
    expect(splitCompoundId("soloUno")).toBeNull();
  });
});

// Normalización del estado de pago de MP a nuestro modelo. De aquí depende que
// una venta se marque como aprobada (dispara entrega + earning) o no. Un mapeo
// equivocado = entregar sin cobro, o cobrar y no entregar.
describe("normalizeOrderPaymentStatus", () => {
  it("mapea los estados aprobados", () => {
    for (const s of ["processed", "approved", "accredited", "APPROVED"]) {
      expect(normalizeOrderPaymentStatus(undefined, s)).toBe("approved");
    }
  });

  it("mapea los estados pendientes", () => {
    for (const s of ["pending", "in_process", "action_required", "at_terminal"]) {
      expect(normalizeOrderPaymentStatus(undefined, s)).toBe("pending");
    }
  });

  it("mapea los estados rechazados", () => {
    for (const s of ["rejected", "failed", "cancelled", "canceled", "expired"]) {
      expect(normalizeOrderPaymentStatus(undefined, s)).toBe("rejected");
    }
  });

  it("mapea refunded y charged_back", () => {
    expect(normalizeOrderPaymentStatus(undefined, "refunded")).toBe("refunded");
    expect(normalizeOrderPaymentStatus(undefined, "charged_back")).toBe("charged_back");
    expect(normalizeOrderPaymentStatus(undefined, "chargeback")).toBe("charged_back");
  });

  it("estado desconocido o vacío -> unknown", () => {
    expect(normalizeOrderPaymentStatus(undefined, "algo_raro")).toBe("unknown");
    expect(normalizeOrderPaymentStatus(undefined, undefined)).toBe("unknown");
    expect(normalizeOrderPaymentStatus("", "")).toBe("unknown");
  });

  it("prioriza el estado del PAGO sobre el de la ORDEN cuando difieren", () => {
    // Orden "processed" pero el pago fue "rejected" -> gana el pago.
    expect(normalizeOrderPaymentStatus("processed", "rejected")).toBe("rejected");
    // Orden pendiente pero el pago ya acreditó -> aprobado.
    expect(normalizeOrderPaymentStatus("pending", "accredited")).toBe("approved");
  });

  it("usa el estado de la orden si no hay estado de pago", () => {
    expect(normalizeOrderPaymentStatus("approved", undefined)).toBe("approved");
    expect(normalizeOrderPaymentStatus("expired", undefined)).toBe("rejected");
  });
});
