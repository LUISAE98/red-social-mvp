// Auditoría de MEZCLAS. SOLO CALCULA, no lee ni escribe nada.
//
// La auditoría de flujos prueba una venta a la vez. Pero un creador real no tiene una venta:
// tiene un saldo formado por muchas, de compradores de países distintos, algunas devueltas, y
// a veces cobrando desde una cuenta que cambió a mitad del camino. El retiro no recorre esas
// ventas: lee CONTADORES AGREGADOS del resumen. Si sumar y luego repartir no diera lo mismo
// que repartir venta por venta, el creador cobraría mal y nadie lo notaría.
//
// Esto simula el ledger tal cual —las mismas sumas, las mismas reversas con su `Math.max(0)`—
// sobre cientos de mezclas generadas al azar, y comprueba tres cosas:
//
//   · AGREGADO   el retiro completo == la suma de las liquidaciones de las ventas vivas
//   · PARCIALES  retirar en trozos == retirar de una vez (hasta el redondeo)
//   · REVERSAS   una venta devuelta desaparece del retiro, sin dejar residuo
//
// El azar es determinista: misma semilla, misma corrida. Sin eso un fallo no se puede repetir.

import {
  resolveSaleTax,
  resolveSettlement,
  calcularRetiro,
  type PerfilFiscalCreador,
} from "../backend/src/tax/fiscalEngine";

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Generador determinista (mulberry32). El azar de una auditoría tiene que ser repetible. */
function rng(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAISES = ["MX", "DE", "US", "MX", "BR", "MX"]; // MX pesa más, es el caso con IVA

type Venta = {
  base: number;
  comprador: string;
  /** Perfil con el que se liquidó. Congelado, como en el asiento. */
  perfil: PerfilFiscalCreador;
  devuelta: boolean;
  liq: ReturnType<typeof resolveSettlement>;
  mxVat: number;
};

/** Los contadores del resumen, sumados EXACTAMENTE como lo hace `backend/src/wallet/ledger.ts`. */
type Contadores = {
  saldo: number;
  mxVat: number;
  isr: number;
  iva: number;
  ivaComision: number;
};

function acumular(ventas: Venta[]): Contadores {
  const c: Contadores = { saldo: 0, mxVat: 0, isr: 0, iva: 0, ivaComision: 0 };
  for (const v of ventas) {
    // Al ganar, suma.
    c.saldo = round2(c.saldo + v.liq.participacion);
    c.mxVat = round2(c.mxVat + v.mxVat);
    c.isr = round2(c.isr + v.liq.isrRetenido);
    c.iva = round2(c.iva + v.liq.ivaRetenido);
    c.ivaComision = round2(c.ivaComision + v.liq.ivaComision);
    // Al devolver, resta lo de ESA venta, nunca por debajo de cero.
    if (v.devuelta) {
      c.saldo = round2(c.saldo - v.liq.participacion);
      c.mxVat = round2(Math.max(0, c.mxVat - v.mxVat));
      c.isr = round2(Math.max(0, c.isr - v.liq.isrRetenido));
      c.iva = round2(Math.max(0, c.iva - v.liq.ivaRetenido));
      c.ivaComision = round2(Math.max(0, c.ivaComision - v.liq.ivaComision));
    }
  }
  return c;
}

function retiroDe(c: Contadores, solicitado?: number) {
  return calcularRetiro({
    saldo: c.saldo,
    solicitado,
    ivaCobradoPendiente: c.mxVat,
    isrPendiente: c.isr,
    ivaPendiente: c.iva,
    ivaComisionPendiente: c.ivaComision,
  });
}

type Resultado = { agregado: number; parciales: number; reversas: number; casos: number };

function auditar(
  nombre: string,
  perfilDe: (r: () => number) => PerfilFiscalCreador,
  vueltas: number,
  semilla: number
): Resultado {
  const r = rng(semilla);
  const res: Resultado = { agregado: 0, parciales: 0, reversas: 0, casos: 0 };
  let peorParcial = 0;

  for (let i = 0; i < vueltas; i++) {
    const cuantas = 1 + Math.floor(r() * 12);
    const ventas: Venta[] = [];
    for (let k = 0; k < cuantas; k++) {
      const base = round2(3 + r() * 500);
      const comprador = PAISES[Math.floor(r() * PAISES.length)];
      const perfil = perfilDe(r);
      const venta = resolveSaleTax({ base, buyerCountry: comprador });
      ventas.push({
        base,
        comprador,
        perfil,
        devuelta: r() < 0.15,
        mxVat: venta.mxVatAmount,
        liq: resolveSettlement({ base, mxVatAmount: venta.mxVatAmount, creador: perfil }),
      });
    }

    const vivas = ventas.filter((v) => !v.devuelta);
    const c = acumular(ventas);
    res.casos++;

    // ── AGREGADO ───────────────────────────────────────────────────────────
    // Lo que el retiro paga contra la suma de lo que el motor liquidó por cada venta viva.
    const esperado = round2(vivas.reduce((a, v) => a + v.liq.neto, 0));
    const pagado = retiroDe(c).neto;
    // Un centavo por venta: cada asiento redondea el suyo y el agregado redondea otra vez.
    const toleranciaAgregado = Math.max(0.02, vivas.length * 0.01);
    if (Math.abs(pagado - esperado) > toleranciaAgregado) {
      res.agregado++;
      console.log(
        `  🔴 AGREGADO  mezcla #${i}  ${vivas.length} ventas  pagado ${pagado.toFixed(2)} vs esperado ${esperado.toFixed(2)}`
      );
    }

    // ── PARCIALES ──────────────────────────────────────────────────────────
    // Sacarlo en tres trozos tiene que dar lo mismo que sacarlo de una vez.
    if (c.saldo > 1) {
      const t1 = round2(c.saldo * 0.37);
      const t2 = round2(c.saldo * 0.4);
      const t3 = round2(c.saldo - t1 - t2);
      const suma = round2(
        retiroDe(c, t1).neto + retiroDe(c, t2).neto + retiroDe(c, t3).neto
      );
      const entero = retiroDe(c).neto;
      const delta = Math.abs(suma - entero);
      peorParcial = Math.max(peorParcial, delta);
      // Tres trozos, cinco cifras redondeadas cada uno: 0.05 es el techo del redondeo.
      if (delta > 0.05) {
        res.parciales++;
        console.log(
          `  🔴 PARCIALES mezcla #${i}  en trozos ${suma.toFixed(2)} vs entero ${entero.toFixed(2)}`
        );
      }
    }

    // ── REVERSAS ───────────────────────────────────────────────────────────
    // Una venta devuelta no puede dejar residuo: los contadores de un saldo sin ventas vivas
    // tienen que quedar todos en cero.
    if (vivas.length === 0) {
      const limpio =
        c.saldo === 0 && c.mxVat === 0 && c.isr === 0 && c.iva === 0 && c.ivaComision === 0;
      if (!limpio) {
        res.reversas++;
        console.log(`  🔴 REVERSAS  mezcla #${i}  residuo ${JSON.stringify(c)}`);
      }
    }
  }

  console.log(
    `\n${nombre}\n  ${res.casos} mezclas · agregado ${res.agregado ? `🔴 ${res.agregado}` : "✅"}` +
      ` · parciales ${res.parciales ? `🔴 ${res.parciales}` : "✅"}` +
      ` · reversas ${res.reversas ? `🔴 ${res.reversas}` : "✅"}` +
      `\n  peor desvío por retiro en trozos: ${peorParcial.toFixed(4)} USD`
  );
  return res;
}

console.log("\nMezclas aleatorias de ventas en un mismo saldo. Semilla fija, repetible.\n");

const total = [
  auditar(
    "CREADOR MEXICANO cobrando en México (mezcla compradores MX y extranjeros)",
    () => ({ residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" }),
    400,
    1
  ),
  auditar(
    "CREADOR MEXICANO que CAMBIA de cuenta a mitad (unas ventas al 50% de IVA, otras al 100%)",
    (r) => ({
      residency: "MX",
      hasTaxId: true,
      payoutAccountCountry: r() < 0.5 ? "MX" : "US",
    }),
    400,
    2
  ),
  auditar(
    "CREADOR EXTRANJERO (mezcla compradores MX y extranjeros)",
    () => ({ residency: "FOREIGN", hasTaxId: true, payoutAccountCountry: "DE" }),
    400,
    3
  ),
].reduce((a, b) => ({
  agregado: a.agregado + b.agregado,
  parciales: a.parciales + b.parciales,
  reversas: a.reversas + b.reversas,
  casos: a.casos + b.casos,
}));

const fallos = total.agregado + total.parciales + total.reversas;
console.log(`\n${"═".repeat(78)}`);
console.log(
  fallos === 0
    ? `MEZCLAS LIMPIAS · ${total.casos} mezclas · 0 fallos`
    : `🔴 ${fallos} FALLOS en ${total.casos} mezclas`
);
console.log("═".repeat(78));
process.exit(fallos > 0 ? 1 : 0);
