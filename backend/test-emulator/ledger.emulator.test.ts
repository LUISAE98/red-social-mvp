import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import {
  recordEarning,
  settleEarning,
  reverseEarning,
  netFromGross,
} from "../src/wallet/ledger";
import { calcularRetiro } from "../src/tax/fiscalEngine";

// ─────────────────────────────────────────────────────────────────────────────
// Contabilidad del ledger contra el emulador de Firestore.
//
// Requiere FIRESTORE_EMULATOR_HOST (lo define `firebase emulators:exec`). Cada
// test usa un creatorId único, así que no hay contaminación entre casos y no hace
// falta limpiar el emulador entre pruebas.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function newCreator(): string {
  return `creator_${crypto.randomUUID()}`;
}
function entryId(sourceType: string, sourceId: string): string {
  return `${sourceType}__${sourceId}`;
}
async function readSummary(creatorId: string) {
  const snap = await db.doc(`users/${creatorId}/walletSummary/current`).get();
  return snap.data() as Record<string, number> | undefined;
}
async function readEntry(creatorId: string, sourceType: string, sourceId: string) {
  const snap = await db
    .doc(`users/${creatorId}/walletLedger/${entryId(sourceType, sourceId)}`)
    .get();
  return snap.data() as Record<string, unknown> | undefined;
}

beforeAll(() => {
  // Falla temprano y claro si alguien corre esto sin el emulador (evita que
  // pegue a Firestore real).
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST no está definido. Corre: npm run test:emulator"
    );
  }
});

describe("recordEarning", () => {
  it("una venta 'earned' crea la entrada y suma al lifetime del summary", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "supercomment",
      grossAmount: 100,
      sourceType: "superComment",
      sourceId: "p1_sc1",
      buyerId: "buyer1",
      earnedImmediately: true,
    });

    const entry = await readEntry(creatorId, "superComment", "p1_sc1");
    expect(entry?.status).toBe("earned");
    expect(entry?.grossAmount).toBe(100);
    expect(entry?.netAmount).toBe(netFromGross(100)); // 75

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(100);
    // En duro a propósito: si alguien cambia WALLET_NET_RATE, este test debe
    // fallar y obligar a una decisión, no adaptarse en silencio. 75 = neto tras
    // la comisión unificada del 25% (antes 23%, de ahí el 77 que quedó viejo).
    expect(s?.lifetimeEarnedNet).toBe(75);
    expect(s?.pendingGross).toBe(0);
  });

  it("una venta 'pending' (grupo B) suma a pending, no al lifetime", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 200,
      sourceType: "greetingRequest",
      sourceId: "g1",
      earnedImmediately: false,
    });

    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(200);
    expect(s?.pendingNet).toBe(netFromGross(200)); // 154
    expect(s?.lifetimeEarnedGross).toBe(0);
  });

  it("IDEMPOTENCIA: registrar dos veces la misma venta no dobla nada (anti doble cobro)", async () => {
    const creatorId = newCreator();
    const params = {
      type: "premium_post" as const,
      grossAmount: 50,
      sourceType: "postAccess",
      sourceId: "acc1",
      earnedImmediately: true,
    };
    await recordEarning(creatorId, params);
    await recordEarning(creatorId, params); // reintento / webhook duplicado

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(50); // NO 100
    expect(s?.lifetimeEarnedNet).toBe(netFromGross(50)); // NO el doble

    const entries = await db
      .collection(`users/${creatorId}/walletLedger`)
      .get();
    expect(entries.size).toBe(1); // una sola entrada
  });
});

describe("settleEarning (pending -> earned)", () => {
  it("libera una venta pendiente: resta de pending y suma al lifetime", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 300,
      sourceType: "greetingRequest",
      sourceId: "g2",
      earnedImmediately: false,
    });
    await settleEarning(creatorId, "greetingRequest", "g2");

    const entry = await readEntry(creatorId, "greetingRequest", "g2");
    expect(entry?.status).toBe("earned");

    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(0);
    expect(s?.lifetimeEarnedGross).toBe(300);
    expect(s?.lifetimeEarnedNet).toBe(netFromGross(300));
  });

  it("liberar una venta suma sus retenciones a las PENDIENTES, no solo a las de por vida", async () => {
    // 🚨 Regresión del 2026-08-30. `settleEarning` acumulaba en `lifetimeRetained*` pero se
    //    saltaba `pendingRetained*`, que son las que el retiro descuenta de verdad. O sea:
    //    todo lo del grupo B —lo que se libera al entregar— se habría podido retirar SIN
    //    retenerle un peso, y Vibra habría tenido que enterar al SAT dinero ya pagado.
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 300,
      sourceType: "greetingRequest",
      sourceId: "gRet",
      earnedImmediately: false,
    });

    // Antes de liberar no se debe nada: el dinero todavía no está en su saldo.
    const antes = await readSummary(creatorId);
    expect(antes?.pendingRetainedIsr ?? 0).toBe(0);

    await settleEarning(creatorId, "greetingRequest", "gRet");

    const entry = await readEntry(creatorId, "greetingRequest", "gRet");
    const ret = entry?.retenciones as Record<string, number> | undefined;
    // El creador de prueba no tiene perfil fiscal, así que cae en el caso base
    // (mexicano sin RFC) y SÍ se le retiene. Si esto fuera cero el test no probaría nada.
    expect(ret?.isrRetenido).toBeGreaterThan(0);

    const s = await readSummary(creatorId);
    expect(s?.pendingRetainedIsr).toBe(ret?.isrRetenido);
    expect(s?.pendingRetainedIva).toBe(ret?.ivaRetenido);
    expect(s?.pendingCommissionVat).toBe(ret?.ivaComision);
    // Y las de por vida siguen cuadrando con ellas: nadie ha retirado todavía.
    expect(s?.lifetimeRetainedIsr).toBe(s?.pendingRetainedIsr);
  });
  it("settle sobre una entrada ya 'earned' es no-op (no doble conteo)", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 300,
      sourceType: "greetingRequest",
      sourceId: "g3",
      earnedImmediately: false,
    });
    await settleEarning(creatorId, "greetingRequest", "g3");
    await settleEarning(creatorId, "greetingRequest", "g3"); // segunda vez

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(300); // NO 600
    expect(s?.pendingGross).toBe(0); // NO negativo
  });
});

describe("IVA de la venta (lo que el comprador paga ENCIMA del precio)", () => {
  it("una venta a comprador MEXICANO congela su IVA y lo acumula al resumen", async () => {
    // 🚨 Regresión del 2026-08-30. El IVA que el comprador paga encima del precio no entra
    //    al saldo —que guarda solo el 75%— pero SÍ es de donde sale la retención. Sin este
    //    contador, el retiro restaba lo retenido de un saldo que nunca lo contuvo y salía
    //    corto por el importe entero del IVA: 15.25 USD por cada 71.49 de saldo.
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "live_ticket",
      grossAmount: 100,
      taxCountry: "MX",
      sourceType: "liveAccess",
      sourceId: "ivaMx",
      earnedImmediately: true,
    });

    const entry = await readEntry(creatorId, "liveAccess", "ivaMx");
    const ret = entry?.retenciones as Record<string, number> | undefined;
    expect(ret?.mxVatVenta).toBe(16); // 16% de 100

    const s = await readSummary(creatorId);
    expect(s?.pendingMxVatCollected).toBe(16);
    expect(s?.lifetimeMxVatCollected).toBe(16);

    // Y el desglose del retiro tiene que dar EXACTAMENTE lo que el motor liquidó para
    // esa venta. Es la invariante que faltaba: agregados del resumen contra asiento.
    const r = calcularRetiro({
      saldo: s!.lifetimeEarnedNet,
      ivaCobradoPendiente: s!.pendingMxVatCollected,
      isrPendiente: s!.pendingRetainedIsr,
      ivaPendiente: s!.pendingRetainedIva,
      ivaComisionPendiente: s!.pendingCommissionVat,
    });
    expect(r.neto).toBe(ret?.neto);
  });

  it("una venta a comprador EXTRANJERO no acumula IVA mexicano", async () => {
    // Exportación a 0%: no hay IVA que cobrar ni que retener, y el desglose se queda en
    // saldo menos retenciones, sin la línea de la suma.
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "live_ticket",
      grossAmount: 100,
      taxCountry: "DE",
      sourceType: "liveAccess",
      sourceId: "ivaDe",
      earnedImmediately: true,
    });

    const entry = await readEntry(creatorId, "liveAccess", "ivaDe");
    const ret = entry?.retenciones as Record<string, number> | undefined;
    expect(ret?.mxVatVenta).toBe(0);
    expect(ret?.ivaRetenido).toBe(0);

    const s = await readSummary(creatorId);
    expect(s?.pendingMxVatCollected).toBe(0);
  });

  it("al reembolsar, el IVA de esa venta deja de contarse", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "live_ticket",
      grossAmount: 100,
      taxCountry: "MX",
      sourceType: "liveAccess",
      sourceId: "ivaRev",
      earnedImmediately: true,
    });
    await reverseEarning(creatorId, "liveAccess", "ivaRev");

    const s = await readSummary(creatorId);
    expect(s?.pendingMxVatCollected).toBe(0);
    expect(s?.lifetimeMxVatCollected).toBe(0);
  });
});
describe("creador EXTRANJERO (la residencia sale de su perfil fiscal)", () => {
  /**
   * Da de alta un perfil fiscal antes de vender. Sin él, `perfilFiscalDe` asume mexicano y
   * la mitad de los flujos de la plataforma quedaría sin probar de extremo a extremo — que
   * es justo lo que pasaba hasta el 2026-08-30.
   */
  async function creadorExtranjero(pais = "DE"): Promise<string> {
    const creatorId = newCreator();
    await db.doc(`creatorTaxProfiles/${creatorId}`).set({
      creatorId,
      residency: "FOREIGN",
      payoutAccountCountry: pais,
    });
    return creatorId;
  }

  it("vendiendo a un MEXICANO recibe su 75% ÍNTEGRO", async () => {
    // 🚨 El caso que más feo se veía: el IVA mexicano lo pagó el comprador por encima del
    //    precio y se retiene al 100%, así que entra y sale por el mismo importe. Al creador
    //    alemán no le toca nada de él — ni a favor ni en contra.
    const creatorId = await creadorExtranjero();
    await recordEarning(creatorId, {
      type: "live_ticket",
      grossAmount: 100,
      taxCountry: "MX",
      sourceType: "liveAccess",
      sourceId: "extMx",
      earnedImmediately: true,
    });

    const entry = await readEntry(creatorId, "liveAccess", "extMx");
    const ret = entry?.retenciones as Record<string, number | string> | undefined;
    expect(ret?.residency).toBe("FOREIGN");
    expect(ret?.isrRetenido).toBe(0); // servicio prestado fuera, sin fuente en México
    expect(ret?.ivaComision).toBe(0); // exportación de mediación al 0%
    expect(ret?.mxVatVenta).toBe(16);
    expect(ret?.ivaRetenido).toBe(16); // se le retiene el 100%
    expect(ret?.neto).toBe(75);

    const s = await readSummary(creatorId);
    const r = calcularRetiro({
      saldo: s!.lifetimeEarnedNet,
      ivaCobradoPendiente: s!.pendingMxVatCollected,
      isrPendiente: s!.pendingRetainedIsr,
      ivaPendiente: s!.pendingRetainedIva,
      ivaComisionPendiente: s!.pendingCommissionVat,
    });
    expect(r.neto).toBe(75);
    expect(r.ivaPorDeclarar).toBe(0); // nada que declare él: se retuvo todo
  });

  it("vendiendo a otro EXTRANJERO no se le toca nada", async () => {
    const creatorId = await creadorExtranjero();
    await recordEarning(creatorId, {
      type: "live_ticket",
      grossAmount: 100,
      taxCountry: "DE",
      sourceType: "liveAccess",
      sourceId: "extDe",
      earnedImmediately: true,
    });

    const entry = await readEntry(creatorId, "liveAccess", "extDe");
    const ret = entry?.retenciones as Record<string, number> | undefined;
    expect(ret?.isrRetenido).toBe(0);
    expect(ret?.ivaRetenido).toBe(0);
    expect(ret?.ivaComision).toBe(0);
    expect(ret?.mxVatVenta).toBe(0);
    expect(ret?.neto).toBe(75);
  });
});
describe("reverseEarning (reembolsos / rechazos)", () => {
  it("earned -> refunded: resta del lifetime y suma a refunded", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "premium_post",
      grossAmount: 100,
      sourceType: "postAccess",
      sourceId: "acc2",
      earnedImmediately: true,
    });
    await reverseEarning(creatorId, "postAccess", "acc2");

    const entry = await readEntry(creatorId, "postAccess", "acc2");
    expect(entry?.status).toBe("refunded");

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(0);
    expect(s?.refundedGross).toBe(100);
    expect(s?.refundedNet).toBe(netFromGross(100));
  });

  it("pending -> rejected: resta de pending y suma a rejected", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 80,
      sourceType: "greetingRequest",
      sourceId: "g4",
      earnedImmediately: false,
    });
    await reverseEarning(creatorId, "greetingRequest", "g4");

    const entry = await readEntry(creatorId, "greetingRequest", "g4");
    expect(entry?.status).toBe("rejected");

    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(0);
    expect(s?.rejectedGross).toBe(80);
  });

  it("DOBLE REVERSA es no-op: no deja el summary negativo", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "premium_post",
      grossAmount: 100,
      sourceType: "postAccess",
      sourceId: "acc3",
      earnedImmediately: true,
    });
    await reverseEarning(creatorId, "postAccess", "acc3");
    await reverseEarning(creatorId, "postAccess", "acc3"); // segunda vez

    const s = await readSummary(creatorId);
    expect(s?.refundedGross).toBe(100); // NO 200
    expect(s?.lifetimeEarnedGross).toBe(0); // NO -100
  });
});

describe("invariantes del summary", () => {
  it("ningún agregado queda negativo tras una secuencia record/settle/reverse", async () => {
    const creatorId = newCreator();
    // Dos ventas pendientes; una se libera, la otra se rechaza; una tercera
    // earned que luego se reembolsa.
    await recordEarning(creatorId, { type: "greeting", grossAmount: 100, sourceType: "greetingRequest", sourceId: "a", earnedImmediately: false });
    await recordEarning(creatorId, { type: "advice", grossAmount: 50, sourceType: "greetingRequest", sourceId: "b", earnedImmediately: false });
    await recordEarning(creatorId, { type: "premium_post", grossAmount: 200, sourceType: "postAccess", sourceId: "c", earnedImmediately: true });
    await settleEarning(creatorId, "greetingRequest", "a");
    await reverseEarning(creatorId, "greetingRequest", "b");
    await reverseEarning(creatorId, "postAccess", "c");

    const s = (await readSummary(creatorId))!;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "number") {
        expect(v, `${k} no debe ser negativo`).toBeGreaterThanOrEqual(0);
      }
    }
    // a liberado (100 earned) y c reembolsado (200) -> lifetime neto = 100.
    expect(s.lifetimeEarnedGross).toBe(100);
    expect(s.rejectedGross).toBe(50);
    expect(s.refundedGross).toBe(200);
    expect(s.pendingGross).toBe(0);
  });
});
