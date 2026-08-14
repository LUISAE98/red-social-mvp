import { describe, it, expect } from "vitest";
import {
  deriveConnectStatus,
  canReceiveTransfers,
  accountToDoc,
  isCrossBorder,
  PLATFORM_COUNTRY,
} from "../../backend/src/payments/stripe/stripeConnect";

const base = {
  accountId: "acct_123",
  payoutsEnabled: false,
  requirementsCurrentlyDue: [] as string[],
  disabledReason: null as string | null,
};

describe("Connect · estado de la cuenta del creador", () => {
  it("sin documento o sin accountId → no empezó", () => {
    expect(deriveConnectStatus(null)).toBe("not_started");
    expect(deriveConnectStatus({ ...base, accountId: "" })).toBe("not_started");
  });

  it("cuenta lista → enabled", () => {
    expect(deriveConnectStatus({ ...base, payoutsEnabled: true })).toBe("enabled");
  });

  // 🚨 EL ORDEN DE LAS RAMAS ES LO QUE PROTEGE ESTE TEST 🚨
  //
  // Stripe puede seguir reportando `payouts_enabled: true` mientras corre el plazo de un
  // requisito recién pedido. Si mirásemos solo esa bandera, le diríamos al creador que
  // está listo y la transferencia se rechazaría después. Los requisitos vencidos GANAN.
  it("🚨 requisitos vencidos ganan sobre payoutsEnabled", () => {
    const doc = {
      ...base,
      payoutsEnabled: true,
      requirementsCurrentlyDue: ["individual.verification.document"],
    };
    expect(deriveConnectStatus(doc)).toBe("requirements_due");
    expect(canReceiveTransfers(doc)).toBe(false);
  });

  // Una cuenta deshabilitada NO es "pendiente": mostrarla como pendiente mandaría al
  // creador a rellenar un formulario que no va a desbloquear nada.
  it("🚨 deshabilitada gana sobre todo lo demás", () => {
    const doc = {
      ...base,
      payoutsEnabled: true,
      requirementsCurrentlyDue: ["algo"],
      disabledReason: "rejected.fraud",
    };
    expect(deriveConnectStatus(doc)).toBe("disabled");
    expect(canReceiveTransfers(doc)).toBe(false);
  });

  it("payoutsEnabled en false sin requisitos explícitos sigue sin poder cobrar", () => {
    expect(deriveConnectStatus(base)).toBe("requirements_due");
    expect(canReceiveTransfers(base)).toBe(false);
  });

  // `canReceiveTransfers` es el ÚNICO gate del retiro. Solo un estado lo abre.
  it("🚨 solo `enabled` habilita la transferencia", () => {
    expect(canReceiveTransfers({ ...base, payoutsEnabled: true })).toBe(true);
    expect(canReceiveTransfers(null)).toBe(false);
  });
});

describe("Connect · normalización del objeto de Stripe", () => {
  it("extrae banderas y requisitos", () => {
    const doc = accountToDoc({
      id: "acct_abc",
      country: "mx",
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {
        currently_due: ["external_account", 42],
        eventually_due: ["individual.ssn_last_4"],
        disabled_reason: null,
      },
    });
    expect(doc).not.toBeNull();
    expect(doc!.accountId).toBe("acct_abc");
    expect(doc!.country).toBe("MX");
    expect(doc!.payoutsEnabled).toBe(true);
    // Los no-string se descartan: Stripe no debería mandarlos, pero un array sucio
    // no debe convertirse en un requisito fantasma que bloquee al creador para siempre.
    expect(doc!.requirementsCurrentlyDue).toEqual(["external_account"]);
    expect(doc!.requirementsEventuallyDue).toEqual(["individual.ssn_last_4"]);
    expect(doc!.disabledReason).toBeNull();
  });

  it("sin id devuelve null en vez de un documento a medias", () => {
    expect(accountToDoc({ country: "MX" })).toBeNull();
    expect(accountToDoc(null)).toBeNull();
  });

  it("requirements ausente no revienta ni inventa requisitos", () => {
    const doc = accountToDoc({ id: "acct_x", payouts_enabled: false });
    expect(doc!.requirementsCurrentlyDue).toEqual([]);
    expect(doc!.disabledReason).toBeNull();
  });
});

// 🚨 Transferir a una cuenta de otro país devuelve ERROR de Stripe, no un cobro
// degradado, salvo que la plataforma esté habilitada para pagos transfronterizos.
// Vibra es mexicana: hasta que Stripe lo habilite, solo se puede pagar dentro de México.
describe("Connect · frontera", () => {
  it("la plataforma es MX", () => {
    expect(PLATFORM_COUNTRY).toBe("MX");
  });

  it("🚨 detecta la transferencia transfronteriza", () => {
    expect(isCrossBorder("MX")).toBe(false);
    expect(isCrossBorder("mx")).toBe(false);
    expect(isCrossBorder("US")).toBe(true);
    expect(isCrossBorder("ES")).toBe(true);
  });

  it("país desconocido no se marca como transfronterizo (no hay dato que lo afirme)", () => {
    expect(isCrossBorder(null)).toBe(false);
    expect(isCrossBorder("")).toBe(false);
  });
});
