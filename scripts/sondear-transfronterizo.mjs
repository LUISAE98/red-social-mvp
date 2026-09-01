/**
 * ¿Podemos ya hacer pagos TRANSFRONTERIZOS con Global Payouts?
 *
 * La documentación de Stripe dice que los pagos transfronterizos **a cuentas bancarias
 * externas** hay que pedirlos escribiendo a `treasury-support@stripe.com`, y que los que van
 * entre cuentas financieras están activos por defecto. Lo que NO dice es si el permiso se
 * aplica también al sandbox, ni hay ningún campo de capacidad que se pueda leer para saberlo.
 *
 * Así que no se adivina: se pregunta. Este sondeo crea una **cotización**, que es la llamada
 * que Stripe rechaza primero si el permiso falta.
 *
 * 🟢 **No mueve dinero.** Una `OutboundPaymentQuote` solo cotiza: dice qué comisiones cobraría
 *    y a qué tipo de cambio convertiría. Caduca sola a los cinco minutos si no se usa.
 *
 * ── CÓMO SE CORRE ───────────────────────────────────────────────────────────────────────
 *
 *     STRIPE_PAYOUTS_SECRET_KEY=sk_test_... node scripts/sondear-transfronterizo.mjs
 *
 * La llave sale del panel de Stripe, del sandbox que quieras sondear. Ojo con cuál eliges:
 * hay más de un sandbox en la cuenta y cada uno tiene sus propios destinatarios.
 *
 * ── QUÉ MIRA, EN ORDEN ──────────────────────────────────────────────────────────────────
 *
 *   1. Desde qué cuenta financiera pagaría Vibra, y con cuánto saldo.
 *   2. Qué destinatarios hay dados de alta y de qué país.
 *   3. Con el primero que NO sea estadounidense, pide una cotización. Ahí está la respuesta.
 */

const LLAVE = (process.env.STRIPE_PAYOUTS_SECRET_KEY ?? "").trim();
const VERSION = "2026-08-26.preview";

if (!LLAVE) {
  console.error(
    "\nFalta la llave.\n\n" +
      "  STRIPE_PAYOUTS_SECRET_KEY=sk_test_... node scripts/sondear-transfronterizo.mjs\n"
  );
  process.exit(1);
}
if (!LLAVE.startsWith("sk_test_") && !LLAVE.startsWith("rk_test_")) {
  console.error("\n🚨 Esa llave NO es de prueba. Este sondeo solo se corre contra un sandbox.\n");
  process.exit(1);
}

async function stripe(ruta, opciones = {}) {
  const res = await fetch(`https://api.stripe.com${ruta}`, {
    method: opciones.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${LLAVE}`,
      "Stripe-Version": VERSION,
      ...(opciones.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opciones.body ? { body: JSON.stringify(opciones.body) } : {}),
  });
  const texto = await res.text();
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = { raw: texto.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, cuerpo };
}

const dinero = (a) =>
  a ? `${(Number(a.value ?? 0) / 100).toFixed(2)} ${String(a.currency ?? "").toUpperCase()}` : "—";

console.log("\n══ 1. La cuenta desde la que paga Vibra ══\n");

const fa = await stripe("/v2/money_management/financial_accounts");
if (!fa.ok) {
  console.error("No se pudo leer la cuenta financiera:", JSON.stringify(fa.cuerpo, null, 2));
  process.exit(1);
}
const cuentas = fa.cuerpo?.data ?? [];
if (cuentas.length === 0) {
  console.log("⚠️  Esta llave no ve NINGUNA cuenta financiera. Probablemente es de otro sandbox.");
  process.exit(0);
}
for (const c of cuentas) {
  const saldo = Object.entries(c.balance?.available ?? {})
    .map(([m, v]) => `${(Number(v?.value ?? 0) / 100).toFixed(2)} ${m.toUpperCase()}`)
    .join(" · ");
  console.log(`  ${c.id}   disponible: ${saldo || "0"}`);
}
if (cuentas.length > 1) {
  console.log(
    "\n⚠️  Hay más de una. `cuentaDeOrigen()` toma la PRIMERA, que es la de arriba.\n" +
      "    Si no es la que esperabas, el saldo nunca va a cuadrar."
  );
}
const origen = cuentas[0];

console.log("\n══ 2. Destinatarios dados de alta ══\n");

/* Sin `include`: ese parámetro no existe en este endpoint y la llamada entera falla.
   Con el listado plano basta, porque `defaults.currency` ya dice en qué moneda cobra. */
const rec = await stripe("/v2/core/accounts?limit=20");
const destinatarios = rec.ok ? (rec.cuerpo?.data ?? []) : [];
if (!rec.ok) {
  console.log("  No se pudieron listar:", JSON.stringify(rec.cuerpo).slice(0, 300));
} else if (destinatarios.length === 0) {
  console.log("  Ninguno. Da de alta un creador de prueba y vuelve a correr esto.");
} else {
  for (const d of destinatarios) {
    console.log(
      `  ${d.id}   cobra en ${String(d.defaults?.currency ?? "?").toUpperCase()}   ${d.contact_email ?? ""}`
    );
  }
}

/**
 * El primero que NO cobra en dólares: es el único que obliga a cruzar frontera y convertir.
 *
 * Se mira `defaults.currency` y no el país porque el listado plano no trae `identity`, y
 * pedirla con `include` hace fallar la llamada entera. La moneda basta: quien cobra en pesos
 * no está en Estados Unidos.
 */
const extranjero = destinatarios.find(
  (d) => String(d.defaults?.currency ?? "").toLowerCase() !== "usd" && d.closed !== true
);

if (!extranjero) {
  console.log(
    "\n⚠️  No hay ningún destinatario FUERA de Estados Unidos, así que no hay nada que cruce\n" +
      "    frontera y este sondeo no puede responder. Da de alta uno mexicano de prueba."
  );
  process.exit(0);
}

console.log(`\n══ 3. Cotización transfronteriza a ${extranjero.id} ══\n`);

const pm = await stripe("/v2/money_management/payout_methods", {});
// Los métodos de cobro viven bajo el destinatario, con su contexto.
const pmRes = await fetch("https://api.stripe.com/v2/money_management/payout_methods", {
  headers: {
    Authorization: `Bearer ${LLAVE}`,
    "Stripe-Version": VERSION,
    "Stripe-Context": extranjero.id,
  },
});
const pmBody = await pmRes.json().catch(() => ({}));
const metodo = pmBody?.data?.[0];

if (!metodo?.id) {
  console.log(
    "  Ese destinatario no tiene método de cobro dado de alta, así que no se puede cotizar.\n" +
      "  Complétale el formulario de cobro y vuelve a correr esto."
  );
  process.exit(0);
}
console.log(`  método de cobro: ${metodo.id}`);

const cot = await stripe("/v2/money_management/outbound_payment_quotes", {
  body: {
    from: { financial_account: origen.id, currency: "usd" },
    to: { recipient: extranjero.id, payout_method: metodo.id },
    amount: { value: 30000, currency: "usd" }, // 300.00 USD, el mínimo del tramo estándar
  },
});

console.log("");

if (cot.ok && cot.cuerpo?.id) {
  const q = cot.cuerpo;
  console.log("✅  SÍ SE PUEDE. El transfronterizo está activo en este sandbox.\n");
  console.log(`    cotización     ${q.id}`);
  console.log(`    se debita      ${dinero(q.from?.debited)}`);
  console.log(`    le llega       ${dinero(q.to?.credited)}`);
  console.log(`    tipo de cambio ${JSON.stringify(q.fx_quote?.rates ?? {})}`);
  console.log(`    caduca         ${q.fx_quote?.lock_expires_at ?? "—"}`);
  console.log("\n    comisiones:");
  for (const f of q.estimated_fees ?? []) {
    console.log(`      ${String(f.type ?? "?").padEnd(26)} ${dinero(f.amount)}`);
  }
  console.log("\n    👉 Compáralas contra `lib/wallet/payoutFees.ts`. Si no cuadran, manda la");
  console.log("       tabla del código, no Stripe.");
} else {
  const err = cot.cuerpo?.error ?? cot.cuerpo;
  const codigo = err?.code ?? err?.type ?? "sin código";
  console.log(`❌  NO. Stripe respondió ${cot.status} · ${codigo}\n`);
  console.log(`    ${err?.message ?? JSON.stringify(err).slice(0, 400)}\n`);
  if (String(codigo).includes("unsupported_country") || String(codigo).includes("not_allowed")) {
    console.log("    Eso es el permiso que falta. Escribe a treasury-support@stripe.com");
    console.log("    pidiendo cross-border Outbound Payments a cuentas bancarias externas.");
  }
}
console.log("");
