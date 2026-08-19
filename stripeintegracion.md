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

### Reparto de 100 puntos (retiro de $5,000 MXN, todo incluido)

100 puntos = base del creador. **El creador siempre se lleva 75.**

| Compra | Creador | Ticket $100 | | Ticket $800 | |
|---|---|---|---|---|---|
| | | Stripe | Vibra | Stripe | Vibra |
| 🇺🇸 EE. UU. | 🇺🇸 EE. UU. | 3.01 | **21.99** | 3.58 | **21.42** |
| 🇺🇸 EE. UU. | 🇲🇽 México | 3.20 | **21.80** | 3.77 | **21.23** |
| 🌎 Extranjero | 🇺🇸 EE. UU. | 3.66 | **21.34** | 4.19 | **20.81** |
| 🌎 Extranjero | 🇲🇽 México | 3.85 | **21.15** | 4.38 | **20.62** |

Son DOS ejes independientes: el **payin** depende del país del COMPRADOR (el recargo de 1.5%
por tarjeta extranjera), el **payout** del país del CREADOR (+0.25% transfronterizo).

Lo que más pesa, en orden: **de dónde es el comprador** (0.65 pp) · **tamaño del ticket**
(0.53–0.57 pp) · **de dónde es el creador** (0.19 pp).

### Por qué el comprador cubre el cargo fijo y el 2%

Mismo caso (compra extranjera + creador mexicano), variando quién absorbe qué:

| Escenario | Ticket $100 | | Ticket $800 | |
|---|---|---|---|---|
| | Stripe | Vibra | Stripe | Vibra |
| El comprador no cubre nada | 12.31 | 12.69 | 7.09 | 17.91 |
| Cubre solo el 2% | 10.42 | 14.58 | 5.20 | 19.80 |
| **Cubre 2% + fijo (real)** | **3.85** | **21.15** | **4.38** | **20.62** |

🚨 **El cargo fijo vale 3.5 veces más que el 2%**: pasarlo al comprador da +6.57 puntos, el 2%
solo +1.89. Y **sin él el ticket chico no es negocio** — Stripe se llevaría 12.31 de cada 100.

⚠️ **Con el modelo real el ticket chico pasa a ser el MEJOR caso** (21.15 contra 20.62), porque
los $6.81 del cargo fijo pesan más en una venta pequeña. Sin cobrarlo era al revés. Ése es el
argumento para no bajar el cargo fijo aunque en pesos se vea que se duplicó respecto a los $3.

### El sobrante del cargo fijo

$6.81 cubre $5.96 del fijo de Stripe **más** el 2.9% que Stripe cobra sobre el propio cargo
($0.20). Sobrante neto **$0.65** (comprador de EE. UU.) o **$0.48** (extranjero, porque ahí la
mordida es del 5.4%). El equilibrio exacto sería $0.3605 / $0.3700 USD; se redondeó a $0.40 para
cubrir las dos rutas con un número limpio.

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

### Punto 1 — La UI del creador decía pesos y guardaba dólares (✅ sin desplegar)

La Fase 1 dejó un bug abierto: el input de precio tenía al lado la moneda **del que mira**
(`displayCurrency`) mientras el número se guardaba en la de liquidación. Un creador mexicano
tecleaba 200, leía "MXN" y publicaba un servicio de **200 dólares**.

- `currency: "MXN"` al guardar → `SETTLEMENT_CURRENCY` (15 archivos)
- `"+ 3 MXN"` y la nota de Stripe, escritos a mano en 6 paneles → `FIXED_SERVICE_FEE_LABEL` /
  `FIXED_SERVICE_FEE_NOTE`, **derivados de la constante** para que no se puedan volver a separar
- **70** fallbacks `?? "MXN"` de display en 29 archivos
- `PostPremiumCurrency` y la moneda del súper comentario: de literal `"MXN"` a `"USD" | "MXN"`
  (los registros anteriores al corte la llevan y hay que poder leerlos)

⚠️ Dos sustos: el barrido casi cambia la fila de **México** en la tabla fiscal (ahí `currency`
es la moneda del COMPRADOR, no la de liquidación — habría separado el precio mostrado del
cobrado), y `buildOffering` tenía `currency: draft.enabled ? "MXN" : null`, un ternario que la
búsqueda literal no vio. **Lo cazó el test** que guarda contra el bug de `resolveStoredPrice`.

### Punto 2 — El creador ve su moneda (✅ núcleo, sin desplegar)

La etiqueta del input ahora dice la moneda **real** y debajo aparece el equivalente local
mientras teclea (`LocalPriceHint`, oculto si el creador ya mira en dólares).

⏳ Falta el rastro del precio (`input`, `inputCurrency`, `rate`, `ratedAt`) para poder
explicarle después por qué su precio local cambió.

### Punto 3 — Precio comercial (✅ cobro, sin desplegar)

`roundCharm`: el total queda en `.99` o `.00`, el que quede más cerca **por arriba**.

```
composeCharge        base + fijo → +2% FX → +impuesto  = 118.80 USD
applyCharmRounding   → moneda del comprador → 2,023.30 → roundCharm → 2,023.99 → 118.84 USD
recomposeWithCharged gravable = 118.84 ÷ 1.16 · impuesto = el resto · sobrante → base gravable
resolvePresentment   convierte EXACTO, ya no redondea
```

El sobrante del redondeo es de Vibra y va **dentro** de la base gravable: es contraprestación
como el cargo fijo, así que paga impuesto. `baseAmount` NO se toca — lo que gana el creador no
puede depender de cómo cayó un decimal.

⚠️ **Dos conflictos que aparecieron al cablearlo:**
1. `roundNice` en `resolvePresentment` **destruía** el precio comercial (108.99 MXN, paso 5 → 110).
2. Redondear ahí **sobrecobraba** al aplicar saldo a favor: lo que llega es el RESTANTE
   (total − crédito), no un precio. Con total 108.99 y crédito 50.34 el comprador acababa
   pagando 109.33.

Los dos se cierran igual: **la presentación ya no redondea**, solo convierte con la precisión
de la moneda.

⚠️ El frontend calculaba el total distinto (aplicaba `roundNice` a la base ANTES del impuesto):
con base 10 USD el backend cobraba **209.99 MXN** y la UI mostraba **208.80**. `formatWithTax`
ahora reproduce el backend paso a paso, con `roundCharm` espejado en `lib/currency/format.ts` y
**test de paridad** sobre las 78 monedas.

⏳ Falta la **matriz de precios congelada**: hoy la conversión sigue siendo en vivo.

### Pendientes

| Punto | Qué |
|---|---|
| 2 | Rastro del precio: `{input, inputCurrency, usd, rate, ratedAt}` |
| 3 | Matriz congelada: refresco mensual + banda ±3% |
| 4 | Connect y payouts — **bloqueado** |
| 5 | Ledger en USD + dimensión `entity` (área sensible) |
| 6 | Fiscal: CFDI del creador, retenciones, tipo de cambio del DOF |

---

## 8. Dependencias para operar en vivo

| Qué | Estado | Bloquea |
|---|---|---|
| **EIN** (IRS, vía Atlas) | ⏳ previsto 31 ago – 28 oct | Verificación de empresa |
| **Mercury** (cuenta bancaria de la LLC) | 🔄 en alta (2026-08-18) | **Activación de Stripe live** |
| **Verificación de empresa** en Stripe | ⬜ | `sk_live` / `pk_live` |
| **Preaprobación** del vertical de creadores | ⬜ | Procesar dinero real + define la reserva |

⚠️ **Stripe live está suspendido hasta que la cuenta bancaria esté dada de alta.** El modo de
prueba funciona sin nada de esto, así que **toda la integración se puede terminar en test** y
dejar el cutover a live como último paso.

---

## 9. Frentes abiertos

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
