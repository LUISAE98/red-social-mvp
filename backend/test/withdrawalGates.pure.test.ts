// Las puertas del retiro y el mapeo de estados de Stripe.
//
// 🚨 POR QUÉ EXISTE ESTE ARCHIVO
//
// Estas comprobaciones vivían dentro del `onCall`, enredadas con la transacción de Firestore,
// y por eso nunca se probaron: para comprobar que un mexicano sin sello no puede retirar hacía
// falta levantar el emulador, sembrar cuatro documentos e invocar un callable. Nadie lo hizo.
//
// El precio se pagó: el gate del sello llegó a estar en el panel y en el botón de Finanzas
// pero NO en el servidor, así que bastaba con llamar al callable a mano para retirar sin él.
// Un botón escondido no es un control.
//
// Ahora `motivoDeBloqueo` es una función pura y estos tests llaman al MISMO código que corre
// en producción — no a una copia de su aritmética, que es lo que hace el test del emulador y
// lo que su propio comentario reconoce como debilidad.

import { describe, it, expect } from "vitest";

import {
  motivoDeBloqueo,
  estadoDeStripe,
  type EntradaPuertas,
} from "../src/wallet/withdrawals";

/** Un creador mexicano al que no le falta nada. Cada test rompe UNA cosa. */
function creadorListo(): EntradaPuertas {
  return {
    perfil: {
      payoutAccountDeclared: true,
      declaredAccountMatchesStripe: true,
      stripeAccountStatus: "verified",
      residency: "MX",
      payoutAccountCountry: "MX",
      csdStatus: "valid",
      // Dentro de un año. El sello caduca a los cuatro, así que esto es holgado.
      csdExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    },
    kyc: { status: "approved", documentCountry: "MX" },
    resumen: { lifetimeEarnedNet: 400, withdrawnNet: 0 },
    condiciones: { route: "stripe", minWithdrawalUsd: 300 },
    neto: 328.89,
  };
}

/** Aplica un cambio sobre el creador listo, sin mutar el original. */
function con(cambio: (e: EntradaPuertas) => void): EntradaPuertas {
  const e = creadorListo();
  cambio(e);
  return e;
}

describe("motivoDeBloqueo", () => {
  it("🟢 un creador con todo en regla pasa", () => {
    expect(motivoDeBloqueo(creadorListo())).toBeNull();
  });

  // ── 1 · Identidad ──────────────────────────────────────────────────────
  it("🔴 sin KYC aprobado no retira", () => {
    expect(motivoDeBloqueo(con((e) => (e.kyc.status = "pending")))).toBe("sin_kyc");
    expect(motivoDeBloqueo(con((e) => (e.kyc.status = "declined")))).toBe("sin_kyc");
    expect(motivoDeBloqueo(con((e) => (e.kyc = {})))).toBe("sin_kyc");
  });

  // ── 2 · Cuenta de cobro ────────────────────────────────────────────────
  it("🔴 sin declarar su cuenta no retira", () => {
    expect(motivoDeBloqueo(con((e) => (e.perfil.payoutAccountDeclared = false)))).toBe(
      "cuenta_no_lista"
    );
  });

  it("🚨 si la cuenta declarada NO coincide con la de Stripe, no retira", () => {
    // Es la comprobación antifraude: alguien podría declarar su cuenta y dar de alta otra.
    expect(motivoDeBloqueo(con((e) => (e.perfil.declaredAccountMatchesStripe = false)))).toBe(
      "cuenta_no_lista"
    );
  });

  it("🔴 con el alta de Stripe a medias no retira", () => {
    expect(motivoDeBloqueo(con((e) => (e.perfil.stripeAccountStatus = "pending")))).toBe(
      "cuenta_no_lista"
    );
    expect(motivoDeBloqueo(con((e) => (e.perfil.stripeAccountStatus = undefined)))).toBe(
      "cuenta_no_lista"
    );
  });

  it("🟢 en Wallbit no se exige alta de Stripe, porque no la hay", () => {
    const e = con((x) => {
      x.condiciones.route = "wallbit";
      x.perfil.stripeAccountStatus = undefined;
    });
    expect(motivoDeBloqueo(e)).toBeNull();
  });

  // ── 3 · Sello fiscal ───────────────────────────────────────────────────
  it("🚨 el mexicano SIN sello no retira", () => {
    expect(motivoDeBloqueo(con((e) => (e.perfil.csdStatus = undefined)))).toBe("sin_sello");
    expect(motivoDeBloqueo(con((e) => (e.perfil.csdStatus = "invalid")))).toBe("sin_sello");
  });

  it("🚨 el mexicano con el sello CADUCADO tampoco", () => {
    const e = con((x) => {
      x.perfil.csdStatus = "valid";
      x.perfil.csdExpiresAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    });
    expect(motivoDeBloqueo(e)).toBe("sin_sello");
  });

  it("🚨 un mexicano que cobra FUERA de México sigue necesitando sello", () => {
    // Este es el fallo que la regla existe para evitar: mirando solo el país de la cuenta,
    // salía «extranjero» y se saltaba el sello. Basta con que el DOCUMENTO diga México.
    const e = con((x) => {
      x.perfil.residency = undefined;
      x.perfil.payoutAccountCountry = "US";
      x.kyc.documentCountry = "MX";
      x.perfil.csdStatus = undefined;
    });
    expect(motivoDeBloqueo(e)).toBe("sin_sello");
  });

  it("🚨 y un extranjero con CUENTA mexicana también", () => {
    // El espejo del anterior: documento de fuera, pero cobra en México.
    const e = con((x) => {
      x.perfil.residency = undefined;
      x.kyc.documentCountry = "ES";
      x.perfil.payoutAccountCountry = "MX";
      x.perfil.csdStatus = undefined;
    });
    expect(motivoDeBloqueo(e)).toBe("sin_sello");
  });

  it("🟢 el creador extranjero no necesita sello, no emite CFDI", () => {
    const e = con((x) => {
      x.perfil.residency = "FOREIGN";
      x.perfil.payoutAccountCountry = "ES";
      x.kyc.documentCountry = "ES";
      x.perfil.csdStatus = undefined;
      x.perfil.csdExpiresAt = undefined;
    });
    expect(motivoDeBloqueo(e)).toBeNull();
  });

  it("🟢 `residency: FOREIGN` manda aunque el documento diga México", () => {
    // Un mexicano que declaró residencia fiscal fuera. La declaración explícita gana.
    const e = con((x) => {
      x.perfil.residency = "FOREIGN";
      x.kyc.documentCountry = "MX";
      x.perfil.payoutAccountCountry = "ES";
      x.perfil.csdStatus = undefined;
    });
    expect(motivoDeBloqueo(e)).toBeNull();
  });

  // ── 4 · Mínimo ─────────────────────────────────────────────────────────
  it("🔴 por debajo del mínimo de su país no retira", () => {
    expect(motivoDeBloqueo(con((e) => (e.resumen.lifetimeEarnedNet = 299.99)))).toBe(
      "bajo_minimo"
    );
  });

  it("🟢 justo en el mínimo sí retira", () => {
    expect(motivoDeBloqueo(con((e) => (e.resumen.lifetimeEarnedNet = 300)))).toBeNull();
  });

  it("🚨 el mínimo es el de SU país, no 300 para todos", () => {
    // Los 27 países de solo wire tienen mínimo 500 porque cada envío cuesta 25 USD fijos.
    const e = con((x) => {
      x.condiciones.minWithdrawalUsd = 500;
      x.resumen.lifetimeEarnedNet = 400;
    });
    expect(motivoDeBloqueo(e)).toBe("bajo_minimo");
  });

  it("🚨 lo ya retirado descuenta del saldo", () => {
    // Sin esto podría retirar el mismo dinero dos veces mientras el primer retiro va en curso.
    const e = con((x) => {
      x.resumen.lifetimeEarnedNet = 700;
      x.resumen.withdrawnNet = 450;
    });
    expect(motivoDeBloqueo(e)).toBe("bajo_minimo");
  });

  it("🔴 con neto en cero no hay nada que retirar", () => {
    expect(motivoDeBloqueo(con((e) => (e.neto = 0)))).toBe("nada_que_retirar");
    expect(motivoDeBloqueo(con((e) => (e.neto = -1)))).toBe("nada_que_retirar");
  });

  // ── El orden importa ───────────────────────────────────────────────────
  it("🚨 con varias puertas cerradas gana la PRIMERA, no la última", () => {
    // Enseñarle «te falta saldo» a quien lo que le falta es verificar su identidad lo manda
    // a buscar donde no es. El orden es identidad → cuenta → sello → mínimo.
    const e = con((x) => {
      x.kyc.status = "pending";
      x.perfil.payoutAccountDeclared = false;
      x.perfil.csdStatus = undefined;
      x.resumen.lifetimeEarnedNet = 1;
    });
    expect(motivoDeBloqueo(e)).toBe("sin_kyc");
  });
});

describe("estadoDeStripe", () => {
  it("🚨 `processing` NO es pagado", () => {
    // El fallo que esto evita: hasta el 2026-08-31 se marcaba `paid` en cuanto Stripe aceptaba
    // la orden, así que un pago devuelto por el banco quedaba como cobrado para siempre.
    expect(estadoDeStripe("processing")).toBe("sent");
  });

  it("🟢 `posted` sí es pagado", () => {
    expect(estadoDeStripe("posted")).toBe("paid");
  });

  it("🔴 los tres finales malos devuelven el saldo", () => {
    expect(estadoDeStripe("failed")).toBe("failed");
    expect(estadoDeStripe("returned")).toBe("failed");
    expect(estadoDeStripe("canceled")).toBe("failed");
    // Stripe escribe «canceled»; se acepta la grafía británica por si acaso.
    expect(estadoDeStripe("cancelled")).toBe("failed");
  });

  it("🚨 un estado DESCONOCIDO se queda en camino, ni pagado ni fallido", () => {
    // Ante la duda no se le da por bueno un dinero que no llegó, ni se le devuelve uno que sí.
    // `scheduled` es real: son los pagos programados desde el Dashboard.
    expect(estadoDeStripe("scheduled")).toBe("sent");
    expect(estadoDeStripe("algo_que_stripe_invente")).toBe("sent");
    expect(estadoDeStripe(null)).toBe("sent");
    expect(estadoDeStripe(undefined)).toBe("sent");
  });

  it("no le importan las mayúsculas", () => {
    expect(estadoDeStripe("POSTED")).toBe("paid");
    expect(estadoDeStripe("Returned")).toBe("failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El identificador de la transferencia de Wallbit.
//
// 🚨 Esa ruta NO tiene API. Alguien mueve el dinero a mano entre dos cuentas de Wallbit y
//    luego cierra la solicitud, así que no hay nada que consultar después: este dato es lo
//    ÚNICO que respalda el pago. Sin él, ante un «no me llegó» solo queda la palabra del
//    operador contra la del creador.
//
//    Se pidió el identificador y no un comprobante en PDF porque un PDF no lo verifica nadie
//    —se puede adjuntar el archivo equivocado y el sistema lo daría por bueno— y porque el
//    extracto de Wallbit contiene las transferencias de TODOS los creadores.
// ─────────────────────────────────────────────────────────────────────────────

/** La misma validación que hace `markWithdrawalPaid` antes de cerrar. */
function referenciaValida(referencia: unknown): boolean {
  const limpia = typeof referencia === "string" ? referencia.trim().slice(0, 200) : "";
  return limpia.length >= 6;
}

describe("identificador de la transferencia de Wallbit", () => {
  it("🔴 no se cierra un retiro sin identificador", () => {
    expect(referenciaValida(undefined)).toBe(false);
    expect(referenciaValida(null)).toBe(false);
    expect(referenciaValida("")).toBe(false);
  });

  it("🚨 ni con espacios, guiones o un relleno cualquiera", () => {
    // Es lo que se escribe cuando el campo es opcional y hay prisa.
    expect(referenciaValida("   ")).toBe(false);
    expect(referenciaValida("-")).toBe(false);
    expect(referenciaValida("ok")).toBe(false);
    expect(referenciaValida("12345")).toBe(false);
  });

  it("🟢 un identificador de verdad pasa", () => {
    expect(referenciaValida("WB-2026-0901-4471")).toBe(true);
    expect(referenciaValida("  TRX88213  ")).toBe(true);
  });

  it("se recorta a 200 caracteres, no se rechaza", () => {
    // Alguien pega media pantalla. Se guarda lo que cabe en vez de bloquear el cierre de un
    // pago que ya salió: el dinero no se puede devolver por un campo demasiado largo.
    expect(referenciaValida("X".repeat(500))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La sesión anónima.
//
// 🚨 `request.auth.uid` EXISTE para los invitados: las compras sin login usan Anonymous Auth,
//    así que comprobar solo que haya sesión deja el callable abierto a cualquiera.
//
//    Hoy no consiguen nada —fallarían en el KYC— pero es la misma clase de agujero que tuvo el
//    gate del sello: un control que existe más arriba y no en el servidor. Ese ya se coló una
//    vez y por eso este test existe.
// ─────────────────────────────────────────────────────────────────────────────

/** La misma comprobación que hace `requestWithdrawal` justo después de exigir sesión. */
function puedeInvocar(auth: { uid?: string; token?: Record<string, unknown> } | null): boolean {
  if (!auth?.uid) return false;
  const firebase = auth.token?.firebase as { sign_in_provider?: string } | undefined;
  return firebase?.sign_in_provider !== "anonymous";
}

describe("quién puede pedir un retiro", () => {
  it("🔴 sin sesión, no", () => {
    expect(puedeInvocar(null)).toBe(false);
    expect(puedeInvocar({})).toBe(false);
  });

  it("🚨 una sesión ANÓNIMA tiene uid y aun así no puede", () => {
    expect(
      puedeInvocar({ uid: "invitado_123", token: { firebase: { sign_in_provider: "anonymous" } } })
    ).toBe(false);
  });

  it("🟢 una cuenta de verdad sí", () => {
    expect(
      puedeInvocar({ uid: "creador_1", token: { firebase: { sign_in_provider: "password" } } })
    ).toBe(true);
    expect(
      puedeInvocar({ uid: "creador_2", token: { firebase: { sign_in_provider: "google.com" } } })
    ).toBe(true);
  });

  it("🟢 un token sin `firebase` pasa: no es anónimo, es que no lo dice", () => {
    // No se puede tratar la ausencia como sospecha o se bloquearía a quien no debe.
    expect(puedeInvocar({ uid: "creador_3", token: {} })).toBe(true);
    expect(puedeInvocar({ uid: "creador_4" })).toBe(true);
  });
});
