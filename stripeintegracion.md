# Integración Stripe — Vibra On, LLC

> Registro vivo del corte de Stripe México a **Stripe USA** y de todo lo que se decide sobre pagos.
> Arrancado el 2026-08-18. Se va actualizando conforme avanza.
>
> No confundir con `docs/stripe-integracion.md`, que es la **referencia de producto** compilada
> de la documentación de Stripe en julio de 2026 y tiene partes ya superadas. Éste es el registro
> de **lo que hicimos y por qué**.

---

## 1. Las dos cuentas

| | Anterior | Actual |
|---|---|---|
| Entidad | Persona física mexicana | **Vibra On, LLC** (Delaware, vía Atlas) |
| Cuenta Stripe | `acct_1TwS5nBSsPYFLsJ6` | **`acct_1U46R37tY0CtRg4D`** |
| País de la plataforma | MX | **US** |
| Liquidación | MXN | **USD** |

Falta el **EIN** (previsto 31 ago – 28 oct) y la **preaprobación** de Stripe para el vertical de
plataformas de creadores.

---

## 2. Decisiones tomadas

| Tema | Decisión | Fecha |
|---|---|---|
| Arquitectura | **Una sola cuenta (USA)**. La de dos cuentas (MX + US) se descartó | 2026-08-17 |
| Fiscal | **Establecimiento permanente en México**, verificado por contador | 2026-08-18 |
| Denominación del precio | **USD** | 2026-08-18 |
| Retiro mínimo | **$5,000 MXN** (≈ $294 USD) | 2026-08-18 |
| Radar | **Standard**, $0.05/transacción, lo absorbe el comprador | 2026-08-18 |
| Stripe Tax | **NO se activa** — duplicaría la tabla de 147 países ya construida | 2026-08-18 |
| Cargo fijo al comprador | **$0.40 USD** | 2026-08-18 |
| Cargo de conversión | **2%** (1% Stripe + 1% colchón de deriva) | 2026-08-18 |

### Por qué EP en México y no residente extranjero (18-D)

Con establecimiento permanente **sobrevive toda la capa de facturación** ya construida: CFDI,
CSD, Facturapi, `mxVat`, `MX_EXPORT_TREATMENT_BY_SERVICE` y las retenciones. Un proveedor
digital extranjero bajo 18-D no emite CFDI, y eso habría tirado ~1,100 líneas de backend más
el panel del comprador.

### Por qué NO Stripe Tax

Ya existe `backend/src/tax/config.ts` con 147 jurisdicciones auditadas, `resolveCountry` con
evidencia del Art. 24b, y decisiones que Stripe Tax **no sabe expresar**: tratamiento de
exportación por servicio, `collectionMode` (plataforma / emisor / nadie), Uruguay absorbiendo
el IRNR, Vietnam con 7% de FX. Además Stripe Tax no hace lo que de verdad falta: **retenciones
al creador ni CFDI**.

---

## 3. Comisiones de Stripe USA

| Concepto | Tarifa |
|---|---|
| Procesamiento (tarjeta nacional) | 2.9% + $0.30 |
| Recargo tarjeta no estadounidense | +1.5% |
| Conversión de divisa | +1% |
| Radar Standard | $0.05 / transacción |
| Payout a banco propio | gratis |
| Payout a cuenta conectada | 0.25% + $0.25 |
| Payout transfronterizo | +0.25% |
| Cuenta conectada activa | $2 / mes |
| Disputa | $15 |
| Liquidación multi-moneda | 1% |

### Cargo fijo al comprador: por qué $0.40 y no $0.35

Stripe cobra su **porcentaje también sobre el cargo fijo** que le sumas al cobro, así que el
mínimo real es `0.35 ÷ (1 − tasa)`:

| Ruta | Mínimo |
|---|---|
| Nacional (2.9%) | $0.3605 |
| Extranjero (5.4%) | $0.3700 |

$0.40 cubre las dos con holgura y es un número limpio.

---

## 4. Costo total de Stripe (sin impuesto)

⚠️ **Corrección del 2026-08-18.** La primera versión de esta tabla contaba el 1% de conversión
como costo de Vibra. **Es falso: lo cubre el comprador** con el 2% de FX. Los números buenos
son éstos.

Composición: `base + $0.40 → +2% FX (si aplica) = cobrado`. Vibra recupera del comprador el
cargo fijo **y** el FX; lo que absorbe es solo la diferencia contra lo que se lleva Stripe.

**Base $10 USD**

| | Cobrado | Stripe se lleva | Comprador cubre | **Vibra absorbe** |
|---|---|---|---|---|
| Nacional (EE.UU.) | 10.40 | 0.65 | 0.40 | **0.25 = 2.50%** |
| Extranjero | 10.61 | 0.92 | 0.61 | **0.31 = 3.10%** |

**Base $50 USD**

| | Cobrado | Stripe se lleva | Comprador cubre | **Vibra absorbe** |
|---|---|---|---|---|
| Nacional (EE.UU.) | 50.40 | 1.81 | 0.40 | **1.41 = 2.82%** |
| Extranjero | 51.41 | 3.13 | 1.41 | **1.72 = 3.44%** |

**Payout** (mínimo $300 USD; el creador recibe el 75% de la base)

| | Costo | % de la base |
|---|---|---|
| Nacional | $1.00 | 0.25% |
| Transfronterizo | $1.75 | 0.44% |
| Cuenta activa | $2 / mes | 0.50% |

### Totales

| Base | Nacional | Extranjero |
|---|---|---|
| $10 | **3.25%** | **4.04%** |
| $50 | **3.57%** | **4.38%** |

**Neto contra la comisión del 25%:** 21.4–21.8% nacional · 20.6–21.0% extranjero.

> La versión anterior daba 3.83% / 6.66% y un neto de 18.34% para extranjero. La diferencia
> son ~2.3 puntos, que a 100M MXN/mes son **~2.3M MXN al mes**.

---

## 5. El cargo de conversión del 2%

🚨 **No bajarlo a 1%.** Con Stripe México el 2% era exactamente el spread que cobraba Stripe.
Stripe USA cobra 1%, así que hoy el 2% son dos cosas:

- **1%** — spread de conversión de Stripe
- **1%** — **colchón** de deriva entre nuestra tasa cacheada (`open.er-api.com`, refrescada a
  diario) y la que Stripe aplica al liquidar

Cuando la matriz de precios quede congelada (refresco mensual + banda ±3%), esa deriva crece y
el colchón es lo único que la absorbe. Está escrito en el código en los dos espejos.

⚠️ **Dependencia:** `FX_CONVERSION_FEE_BY_CURRENCY` tiene VND en 7% = 2% base + 5% del CIT
vietnamita. Si algún día se baja la base, Vietnam baja a 6%: el 5% es impuesto y no se mueve.

---

## 6. Mínimos y precios por defecto (USD)

| Concepto | USD | ≈ MXN | Antes (MXN) |
|---|---|---|---|
| Cargo fijo al comprador | $0.40 | 6.81 | 3.00 |
| Saludo / consejo | $3 | 51.08 | 50 |
| Sesión exclusiva / tiempo contigo | $9 | 153.23 | 150 |
| Post premium · ticket · súper com. · suscripción | $1.50 | 25.54 | 25 |
| Mínimo por monto de donación | $3 | 51.08 | 50 |

**Tiers de súper comentario:** $1.50 / 2.50 / 5 / 12.50 / 25 → 25.54 / 42.56 / 85.13 / 212.82 / 425.65

**Presets de donación:** $3 / 7 / 15 / 30 → 51 / 119 / 255 / 511

Los números limpios en dólares caen a ±2% de los precios viejos en pesos: para un comprador
mexicano no cambia nada perceptible. **Lo único que sube de verdad es el cargo fijo**, de $3 a
$6.81, y es inevitable — el de $3 estaba calibrado contra el fijo mexicano.

---

## 7. Bitácora

### Fase 0 — Corte de cuenta (✅ 2026-08-18)

- `pk_test_` de la LLC en `lib/stripe/config.ts`, ahora con respaldo por
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` para que el cutover a live no toque el archivo.
- `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en versión 2. **26 funciones redesplegadas.**
- Destino de eventos nuevo: ámbito "Tu cuenta", payload **Resumen (snapshot)**, API
  `2026-07-29.dahlia`, **14 eventos**.
- **Purga de 140 documentos** con ids de la cuenta vieja (`scripts/purge-stripe-account-objects.ts`).
- ✅ Validado con compra real: `200 + 3 = 203 × 1.16 = 235.48 MXN`, hold y captura.

**Dos bugs preexistentes encontrados de paso:**

1. `cleanupAbandonedCreditReservations` no declaraba `secrets`, así que el fix del C01 del
   Bloque 6 estaba **inerte**: el saldo de todo checkout abandonado quedaba reservado para
   siempre. Mismo fallo que tuvo `softDeleteGroup`.
2. `StripePaymentModal`: el efecto que lee el BIN **se cancelaba a sí mismo** (`readingCard`
   estaba en sus propias dependencias) → precio en skeleton para siempre y botón Pagar
   deshabilitado. Fallaba igual en producción desde el commit `ae3037d`.

### Fase 1 — Denominación en USD (✅ código listo, sin desplegar)

- **Reseteo de precios**, no conversión: 48 documentos, 157 importes en pesos eliminados
  (`scripts/reset-prices-for-usd.ts`). Un precio no es un dato que se convierta, es una
  decisión comercial: "$11.36" no es un precio que nadie elegiría.
- `SETTLEMENT_CURRENCY` → `"USD"` en los 4 espejos. `FIXED_SERVICE_FEE_MXN` →
  `FIXED_SERVICE_FEE_USD = 0.40`. 7 constantes renombradas de `_MXN` a `_USD` en 25 archivos.
- 37 `baseCurrency: "MXN"` de display → `SETTLEMENT_CURRENCY` en 19 archivos.
- **La regla del 2% se invirtió sola**: `shouldAddFxFee` compara la moneda del país contra la
  de liquidación, así que México pasó a pagarlo y Estados Unidos dejó de pagarlo — sin tocar
  ninguna de las 147 filas.
- Tests: 305/305. De 10 fallos, 9 codificaban el supuesto viejo; el décimo era **coma flotante**
  (`118.80000000000001` vs `118.8`), no un invariante roto. Se pasó a `toBeCloseTo`.

### Pendientes

| Fase | Qué |
|---|---|
| 2 | Precio con rastro: `{input, inputCurrency, usd, rate, ratedAt}` |
| 3 | Redondeo comercial (.99/.00) resolviendo el impuesto hacia atrás |
| 4 | Matriz de precios congelada: mensual + banda ±3% |
| 5 | Ledger en USD + dimensión `entity` (área sensible) |
| 6 | Connect y payouts — **bloqueado** |

---

## 8. Frentes abiertos

🔴 **¿Puede una plataforma US pagar a creadores en México?** El soporte dijo que sí, self-serve,
pero **contradice la documentación**, que limita los payouts transfronterizos a US·UK·EEE·CA·CH.
La respuesta parecía del asistente automático. **Confirmar con un humano por escrito.**

🔴 **Preaprobación.** Las plataformas de creadores la requieren antes de activarse. Ahí se define
también si aplica **reserva rodante**, que a 100M MXN/mes podría congelar capital de trabajo.
⚠️ La aprobación de julio fue a la **entidad mexicana** y no se hereda.

🟡 **El CFDI se emite obligatoriamente en MXN** y el SAT exige el tipo de cambio del **DOF** de la
fecha de operación. `config/exchangeRates` viene de `open.er-api.com`, que no es el DOF. Fuente
de tipo de cambio nueva por integrar.

🟡 **¿Radar cobra por intento o por cargo exitoso?** Si es por intento, un rechazo también cuesta
$0.05 y ahí no hay comprador a quien cobrárselo.

🟡 **MXN como moneda de liquidación multi-moneda** para una cuenta US: el soporte dijo que sí,
sin verificar de forma independiente.
