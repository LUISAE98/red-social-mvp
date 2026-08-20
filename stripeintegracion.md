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
| Cargo de conversión | **2%** (1% Stripe + candado + colchón) — ver §5 | 2026-08-18 |
| FX Quotes API | **Disponible sin habilitar**, verificado con `/diagnostico-fx`. Candado de 1 hora | 2026-08-18 |

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

## 5. Modelo de cambio de divisa — 📄 **BASE PARA CONTRATO Y DOCUMENTOS LEGALES**

> Esta sección describe exactamente qué se le cobra al comprador por conversión y por qué.
> Es la referencia para el contrato del creador y los términos de compra.

### Qué se le cobra al comprador

**Un 2% de cargo por conversión**, y solo cuando la moneda de su país **no es** la de
liquidación. Un comprador estadounidense no paga nada de esto.

Se aplica sobre `precio del creador + cargo fijo`, **antes** del impuesto, porque es
contraprestación de Vibra y por tanto forma parte de la base gravable (ver `impuestos.md §2`).

### Cómo se compone ese 2%

| Concepto | Cuánto | Qué es |
|---|---|---|
| Conversión de Stripe | **1%** | Lo que Stripe cobra por convertir a la moneda de liquidación |
| Congelamiento de la tasa | **0.15%** | Candado de 1 hora de la FX Quotes API: garantiza que el precio mostrado es el que se cobra |
| Colchón | el resto | Absorbe la deriva del tipo de cambio |

✅ **VERIFICADO CONTRA STRIPE (2026-08-18)** con `/diagnostico-fx`. El 1% que se venía
asumiendo es **exacto**, y su tasa coincide con la de mercado (Stripe dio 17.0612 MXN/USD
el mismo día que Google marcaba 17.06). El candado sale más barato en euros porque el euro
está en el Grupo 1 de Stripe y el peso y el real en el Grupo 2.

| Moneda | 1 USD = | Conversión | Candado 1 h | Referencia |
|---|---|---|---|---|
| MXN | 17.0612 | **1.00%** | 0.150% | `ecb` |
| EUR | 0.8634 | **1.00%** | **0.100%** | `ecb` |
| BRL | 5.2127 | **1.00%** | 0.150% | `ecb` |

⚠️ **El colchón NO es 0.85%.** Se cobra el 2% sobre el importe **antes de impuesto**, pero
Stripe cobra su 1% + candado sobre el **total con impuesto**. Las bases no son la misma, así
que el colchón real depende del impuesto del país:

| País | Impuesto | Candado | **Colchón real** |
|---|---|---|---|
| 🇲🇽 México | 16% | 0.150% | **0.64%** |
| 🇪🇺 UE típica | 21% | 0.100% | **0.65%** |
| 🇧🇷 Brasil (hoy, 1%) | 1% | 0.150% | **0.82%** |
| 🇺🇸 EE. UU. | 0% | — | no aplica: no hay conversión |

Sigue siendo positivo en todos los casos. Es estructural, no un error: mover el 2% fuera de
la base gravable sería cobrar dinero sin declarar.

⚠️ **Brasil llegará a 26.5% en 2033.** Cuando eso pase su colchón cae de 0.82% a ~0.52%, sin
que nadie toque nada. Es el país donde primero conviene revisar el 2%.

### De dónde sale el tipo de cambio

De la **FX Quotes API de Stripe**, no de un proveedor externo. Stripe usa el mid-market de
proveedores de datos financieros (su respuesta expone `reference_rate_provider`, p. ej. `ecb`)
y devuelve por separado:

- `base_rate` — la tasa sin su comisión
- `exchange_rate` — la tasa con su comisión incluida
- `fx_fee_rate` — el porcentaje exacto que está cobrando

⚠️ **Antes se usaba `open.er-api.com`**, una fuente distinta de la que cobra. Ese desajuste
—que no se medía— era lo que el colchón cubría a ciegas.

Consultar la tasa es gratis (`lock_duration: none`). Congelarla cuesta, según la duración y
la moneda; para pesos: 5 min 0.12% · **1 hora 0.15%** · 24 h 0.30%. Se eligió **1 hora**.

⚠️ Si el mercado se mueve más de **3.5%**, Stripe invalida la cotización y avisa por el
webhook `fx_quote.expired`. La API está en **preview** (`Stripe-Version: ...preview`).

### Qué NO cubre

El candado protege desde que se muestra el precio hasta que se cobra. **No** protege el
payout al creador, que ocurre semanas después y se convierte a la tasa de ese momento.

### Cómo está implementado

`backend/src/tax/fxQuotes.ts` pide la cotización y la cachea **por moneda mientras siga
dentro de su hora** — las instancias de Cloud Functions se reciclan, así que una cotización
sirve a varias compras. Reutilizar no ahorra el premium (va dentro de la tasa) pero evita
una llamada de red por cobro. Se deja de reutilizar 5 minutos antes de que expire: adjuntar
una cotización a punto de vencer a un PaymentIntent que se confirma un minuto después la
hace fallar con `payment_intent_fx_quote_invalid`.

La cotización se adjunta al PaymentIntent (`fx_quote`) en los **8 intents** y también en el
cobro un-clic (`offSessionCharge`). ⚠️ Sin adjuntarla el candado no serviría de nada: se
mostraría un precio congelado y se liquidaría a la tasa del momento.

Cada `paymentIntent` guarda la evidencia: `fxQuoteId`, `fxQuoteBaseRate`, `fxStripeFeeRate`
y `fxLockPremium`. **Ése es el dato con el que se dimensiona el colchón**, que hasta ahora
se llevaba a ojo.

🛟 **Si la API falla se cae a `config/exchangeRates`** y el cobro sigue. Está en preview:
es preferible cobrar con una tasa aproximada que no cobrar.

---

## 6. Qué moneda ve cada quién

| Quién | Ve | Por qué |
|---|---|---|
| **Comprador** | Su moneda local, monto exacto | Mejor conversión y autorización; sabe cuánto paga antes de pagar |
| **Creador** | Su precio en **USD** + referencia en su moneda | El precio se fija en USD; el switch de moneda NO afecta dónde se fija |
| **Vibra** | Recibe **USD** | Casado con sus costos, que son en USD |

🚫 **Se evaluó y descartó cobrar solo en USD** (modelo Kick/OnlyFans). El banco del comprador
convierte al 3–5% —mucho peor que el 1% de Stripe—, el comprador no sabe cuánto pagó hasta
el estado de cuenta, bajan las tasas de autorización, y Vibra perdería el 2% sin poder
justificarlo. **El comprador paga más y Vibra gana menos.** A Kick le funciona porque su
precio es uno solo ($4.99) y es su marca; aquí cada creador pone el suyo.

### Dos redondeos distintos, y no son intercambiables

| | Para qué | Cómo |
|---|---|---|
| `roundCharm` | El **precio** que paga el comprador | `.99` / `.00`, siempre hacia arriba |
| `roundReference` | La **referencia** del creador en su moneda | Escalón grueso: 0.50 / 1 / 10 / 50 / 500 según el monto |

⚠️ La referencia NO usa terminación comercial **a propósito**. Con `.99` parecería un precio
—y el creador se fijaría en el decimal— y además cambiaría con cualquier movimiento de la
tasa. Con escalón grueso, 90.99 y 91.32 muestran **el mismo número**: el dólar tiene que
moverse de verdad para que la referencia cambie.

---

## 7. Mínimos y precios por defecto (USD)

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

## 8. Bitácora

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

### Auditoría del flujo de SALUDO y CONSEJO (2026-08-19)

📄 **Para los documentos legales**, el flujo completo es:

```
1. El creador activa el servicio y fija su precio      (en USD)
2. El comprador solicita                                createGreetingRequest
   → NO se crea el saludo todavía: se crea un paymentIntent con los datos dentro
3. Se AUTORIZA el cobro (auth-hold), no se cobra        createGreetingStripeIntent
4. El creador acepta o rechaza                          respondGreetingRequest
5. Graba y envía                                        createGreetingMuxUpload
   → al materializarse el video se CAPTURA el cobro     (muxWebhooks)
6. El comprador lo recibe
```

**Nadie paga por algo que no recibió.** El dinero se retiene al solicitar y solo se cobra
cuando el saludo se entrega. Si el creador rechaza, la retención se cancela y **no hay
comisión ni cargo**.

Plazos automáticos:

| | |
|---|---|
| **6 días** | Respaldo de captura del hold, antes de que la retención de la tarjeta expire (~7 días) |
| **60 días** | Si el creador cobró y nunca entregó, se marca rechazada → el comprador puede pedir devolución |

#### 🐛 Bug encontrado y corregido — el rechazo devolvía saldo que no correspondía

Al rechazar, los tres flujos (saludo/consejo, sesión exclusiva, tiempo contigo) cancelaban
la retención y **descartaban el resultado**, aunque `cancelPaymentIntentForRef` devuelve
`{ canceled, alreadyCaptured }` justo para comprobarse.

Si entre la lectura previa y la cancelación el cobro ya se había capturado —por el respaldo
del día 6 o por el webhook de entrega, con `paymentStatus` aún diciendo "authorized"— el
código igual:

1. Devolvía el saldo a favor al comprador
2. Le mostraba **"Devuelto a tu tarjeta"** por un dinero que nunca volvió

Resultado: el comprador se quedaba con el crédito **y** con el cobro capturado, y con un
mensaje falso. Ahora la devolución del saldo va condicionada a que la cancelación funcione;
si el cobro ya estaba capturado, la vía correcta es la devolución (`refund_requested` →
crédito), que es lo que los propios comentarios del código ya describían.

#### 🐛 33 importes en pesos en el backend

El barrido de la migración a USD se hizo sobre el frontend y **el backend quedó fuera**. Los
documentos de dominio se guardaban con `currency: "MXN"` mientras el importe ya era USD:
saludos, sesiones, tiempo contigo, donaciones, tickets de live, súper comentarios,
suscripciones, invitaciones, cash-out y devoluciones.

Corregidos todos. Se dejaron a propósito: la fila de México en la tabla fiscal (es la moneda
del comprador mexicano), el catálogo de monedas, las guardas de tipo y **el CFDI, que se
emite siempre en MXN**.

⚠️ **Consecuencia para facturación (ticket aparte):** `generateBuyerInvoice` busca
`settlementCurrency === "MXN"` para tomar el importe del CFDI. Con liquidación en USD esa
condición ya nunca se cumple. Hay que convertir con el tipo de cambio del DOF.

### Pendientes

| Punto | Qué |
|---|---|
| 2 | Rastro del precio: `{input, inputCurrency, usd, rate, ratedAt}` |
| 3 | Matriz congelada: refresco mensual + banda ±3% |
| 4 | Connect y payouts — **bloqueado** |
| 5 | Ledger en USD + dimensión `entity` (área sensible) |
| 6 | Fiscal: CFDI del creador, retenciones, tipo de cambio del DOF |

---

### 2026-08-19 — Pasarela en moneda local y congelamiento de tasas

**La pasarela mostraba dólares con etiqueta de pesos.** La tarjeta del servicio convertía
bien ($815.99 MXN) pero la pasarela mostraba $46.99 con la etiqueta MXN: eran los dólares
sin convertir. El valor por omisión del modal ya era USD, pero **las 14 pantallas que lo
abren pasaban la moneda explícita y seguían diciendo `"MXN"`**, así que el modal no
convertía y solo pegaba la etiqueta. Corregidas las 14 a `SETTLEMENT_CURRENCY`.

De paso quedaron en USD el mínimo de donación ($3) y los montos sugeridos, que seguían
siendo los de pesos (50/120/250/490 → 3/7/15/30).

**El congelamiento diario de tasas nunca funcionó.** `getSpotRates` mandaba el lote de
monedas como `"from_currencies[]"` con un arreglo; el serializador ya numera los arreglos,
así que producía `from_currencies[][0]=...` y Stripe lo leía como OBJETO → 400 en todos los
lotes. Resultado: `refreshFrozenRates` terminaba con «Stripe no devolvió ninguna tasa, se
conserva la tabla» en CADA corrida, cada 15 minutos, desde que se desplegó la función.

El cobro individual no se vio afectado porque ahí se manda UNA sola moneda (string), y con
un string el formato `[]` sí es válido para Stripe. Por eso el fallo pasó desapercibido: los
cobros funcionaban y solo el congelamiento estaba muerto, en silencio.

⚠️ **Implicación para el contrato**: entre el despliegue de la función y el 2026-08-19 las
conversiones NO usaron una tasa congelada del día — usaron la cotización al vuelo de Stripe
como respaldo. El colchón documentado en §5 sigue siendo válido, pero la estabilidad diaria
que describe ese apartado no estuvo vigente en ese periodo.

Verificado en vivo: la corrida de las 22:23 UTC ya refresca monedas sin un solo 400.

**Índices de Firestore faltantes.** `expireScheduledServiceNoShows` fallaba en cada corrida
por falta de `(status, noShowRejectAt)` y `(status, scheduledAt)` en `meetGreetRequests` y
`exclusiveSessionRequests`. Los cuatro índices desplegados. Mientras faltaron, **las
sesiones y meet & greet a las que nadie se presentó no se expiraban solas**.

### 2026-08-19 — El parámetro `fx_quote` tumbaba TODOS los cobros no-USD

Al crear el PaymentIntent se manda `fx_quote` para fijar la tasa cotizada, pero ese
parámetro **solo existe en la versión preview de la API** y la cabecera `Stripe-Version`
únicamente se estaba mandando en la llamada a `/fx_quotes`. Stripe respondía 400
`parameter_unknown: fx_quote` y el callable moría con 500.

Alcance: los NUEVE caminos de cobro. Todo comprador que no pagara directamente en la moneda
de liquidación no podía pagar nada. Un comprador en USD sí, porque ahí no hay cotización que
fijar y no se manda el parámetro — por eso la prueba de la Fase 0 pasó.

La cabecera ahora se fija en `stripeFetch`, en el único punto por el que pasan todas las
llamadas, con solo detectar `fx_quote` en el cuerpo. Se centralizó a propósito: eran nueve
sitios y bastaba olvidarlo en uno para dejar un servicio sin cobrar.

### 2026-08-19 — ⚠️ La tasa fijada NO aplica a las retenciones

Stripe: «FX Quotes can only be used with PaymentIntents with automatic captures».

La cotización con tasa fijada es **incompatible con `capture_method: "manual"`**, que es el
modelo de saludo, consejo, sesión exclusiva y tiempo contigo: se autoriza al solicitar y se
cobra al entregar. **El modelo manda**, así que se deja de fijar la tasa en esos cobros. La
alternativa habría sido cobrar por adelantado, y eso es justo lo que el producto no hace.

**Qué NO cambia para el comprador.** Nada. El importe y la moneda del cargo se fijan igual
al autorizar y es exactamente lo que ve. La diferencia es interna, entre Stripe y Vibra.

**Qué cambia para Vibra.** En esos cuatro servicios la conversión a USD la hace Stripe a su
tasa al liquidar, no a la tasa fijada. Entre autorizar y capturar pueden pasar hasta 6 días
(`HOLD_CAPTURE_DAYS`), así que el riesgo de tipo de cambio de esa ventana lo absorbe el
colchón del 2%. A cambio no se paga el 0.15% del congelamiento en esos cobros.

Los cobros inmediatos (donación, ticket de live, súper comentario, post premium,
suscripción) **sí** conservan la tasa fijada, porque son de captura automática.

⚠️ **Pendiente de precisión para legales**: en los cobros con retención el `paymentIntent`
sigue guardando `fxQuoteId` como evidencia, pero esa cotización YA NO se usó para liquidar.
Hay que dejar de estamparla ahí o marcarla como no aplicada antes de citar ese campo en
ningún documento.

### 2026-08-19 — El precio mostrado no era el cobrado (2 céntimos)

Detectado al verificar por qué una compra «exitosa» no aparecía en el panel de Stripe.
No aparecía porque **era una autorización, no un cobro** (`pi_3U6JH17tY0CtRg4D0y1MvNXw`,
`status: authorized`): las retenciones viven en «No capturados» y solo pasan a «Pagos» al
capturarse. Eso funcionaba bien. Pero al revisar los importes salió otra cosa:

| | Mostrado | Cobrado |
|---|---|---|
| Saludo de $20 USD | 411.99 MXN | **412.01 MXN** |
| Saludo de $40 USD | 815.99 MXN | **816.01 MXN** |

El total se redondea a precio comercial (…,99) en la moneda del comprador, pero el importe
canónico se guarda en la de liquidación. Reconvertirlo para cobrar hacía un viaje de ida y
vuelta que devolvía céntimos de más. Sistemático y siempre hacia arriba.

`applyCharmRounding` ahora devuelve el importe comercial y se cobra ese, tal cual. ⚠️ Solo
cuando NO hubo saldo a favor: con crédito de por medio lo que se cobra es un residuo, no un
precio, y forzarle el …,99 haría que crédito + tarjeta sumaran más de lo aceptado.

Fijado con pruebas en `backend/test/presentmentCharm.pure.test.ts`.

### 2026-08-19 — Por qué en local el desglose siempre enseña IVA mexicano

Reportado como «pago 46.99 con IVA mexicano desde una IP de EE. UU. y a Stripe caen 40.99».
Son dos cosas y solo una es un fallo:

**El cobro fue CORRECTO.** El backend resuelve el país fiscal con la IP del request y el
país emisor de la tarjeta, vio Estados Unidos, y cobró 40 + 0.40 → 40.99 sin impuesto ni
cargo de conversión. Exacto.

**Lo que se MOSTRABA no.** El desglose del navegador sale de la cookie `vibra_country`, que
escribe el middleware desde `x-vercel-ip-country`. Esa cabecera **la pone Vercel y en local
no existe**, así que no hay cookie y `useBuyerCountry` cae a su fallback, que es México.
Resultado: en localhost SIEMPRE se ve IVA del 16%, con cualquier IP.

En producción no ocurre —la cabecera siempre está— pero hacía imposible probar en local los
otros 146 países. Se añadió `?pais=XX`, **solo fuera de producción**, que simula el país y
refresca también la moneda. No afecta al cobro: el país fiscal sigue resolviéndose en el
servidor, así que nadie puede elegirse un país sin impuesto para pagar menos.

⚠️ **Hallazgo aparte, sin resolver**: `repriceStripeIntentForCard` está desplegada y **no la
llama NADIE en el frontend**. Es la pieza que, al leer la tarjeta, le pide al servidor el
total autoritativo y corrige lo mostrado antes de pagar. Sin ella, lo que ve el comprador y
lo que se le cobra se calculan por caminos distintos y nada los reconcilia. Hoy coinciden
porque el modal espeja la regla de país del backend, pero es un espejo que hay que mantener
a mano. Decidir: cablearla o borrarla.

## 8-bis. Las siete experiencias, de extremo a extremo (auditoría 2026-08-20)

Estado tras probar las siete en modo prueba. **Este apartado repite a propósito** lo que ya
está en apartados anteriores: es la referencia autónoma para el contrato con el creador y
para los documentos legales, y tiene que poder leerse sin saltar a otras secciones.

### 8-bis.1 Lo que comparten las siete

Todas pasan por el MISMO cálculo. No hay una sola excepción, y eso se comprueba de forma
mecánica: `composeCharge` + `applyCharmRounding` + el importe exacto en la moneda del
comprador.

El precio se construye siempre en este orden:

| Paso | Qué añade | Quién lo paga |
|---|---|---|
| 1. Precio del creador | La base que él fija, **en USD** | — |
| 2. Cargo fijo | **+ 0.40 USD** | El comprador |
| 3. Conversión de divisa | **+ 2%** sobre lo anterior, solo si el comprador NO paga en USD | El comprador |
| 4. Impuesto del país del comprador | Según la tabla de 147 jurisdicciones | El comprador |
| 5. Redondeo comercial | El total sube al `,99` de su moneda | El comprador |

**El creador cobra el 75% de su base** (paso 1), siempre, exacto. Ni el cargo fijo, ni la
conversión, ni el impuesto, ni el redondeo le tocan un céntimo — ni a favor ni en contra.
El 25% restante de la base, más el cargo fijo y el sobrante del redondeo, es de Vibra; el
2% cubre lo que Stripe cobra por convertir; el impuesto se entera íntegro al fisco.

Ese reparto sale de un único punto del código (`netFromGross`), así que no puede
divergir entre servicios.

**Moneda.** El creador fija su precio en USD. Al comprador se le cobra **en la suya**, la que
decide su país fiscal. Vibra liquida en **USD**. El interruptor de moneda de la interfaz
solo cambia lo que se ve: la moneda del cobro la impone el servidor con la IP del request y
el país emisor de la tarjeta, para que nadie pueda elegirse una jurisdicción sin impuesto.

**Lo mostrado es lo cobrado.** La tarjeta del servicio y la pasarela enseñan el mismo total,
y es el que llega a Stripe. En las cuatro experiencias con retención, además, al teclear la
tarjeta se le PREGUNTA al servidor el precio autoritativo y se corrige en pantalla antes de
pagar — porque el país de la tarjeta puede cambiar la moneda, y eso el navegador no lo sabe.


### 8-bis.2 Las que RETIENEN el dinero (saludo · consejo · sesión exclusiva · tiempo contigo)

Son las cuatro experiencias que un creador **entrega**, y por eso el dinero no se cobra hasta
que entrega. Es la decisión de producto más importante de todo el cobro.

```
1. El creador activa y fija su precio         → en USD
2. El comprador solicita                      → todavía NO existe la experiencia
3. Se AUTORIZA el cargo (retención)           → el banco reserva, no cobra
4. El creador acepta o rechaza
5. Graba / atiende y entrega                  → AQUÍ se cobra de verdad
6. El comprador la recibe
```

**Nadie paga por algo que no recibió.** Si el creador rechaza, la retención se cancela: no hay
cargo, no hay comisión, no hay nada que devolver.

Dos relojes de seguridad:

| Reloj | Qué hace |
|---|---|
| **Día 6** (`HOLD_CAPTURE_DAYS`) | Captura de respaldo antes de que la retención caduque en el banco |
| **Día 60** (`DELIVERY_WINDOW_DAYS`) | Si cobró y nunca entregó, se rechaza sola |

⚠️ **La tasa de cambio NO se fija en estas cuatro.** Stripe no admite fijar cotización con
captura manual —es restricción suya, no decisión nuestra— así que convierte a su cambio al
liquidar. Entre autorizar y capturar pueden pasar hasta 6 días y ese riesgo lo absorbe el
colchón del 2%. El comprador no se ve afectado: su importe y su moneda quedan fijados al
autorizar y es exactamente lo que ve.

Mínimos: **3 USD** saludo y consejo · **9 USD** sesión exclusiva y tiempo contigo.

### 8-bis.3 Las de cobro INMEDIATO (donación en perfil y en comunidad)

No hay nada que entregar, así que se cobra al instante y la tasa **sí** se fija.

El comprador teclea el importe **en su moneda** y lo que teclea es el total que paga: de ahí
se despeja hacia atrás el impuesto, la conversión y el cargo fijo hasta la base en USD, que
es lo único que el servidor entiende. También hay cuatro montos sugeridos que el creador
configura.

Perfil y comunidad son **el mismo componente** con las mismas reglas; no son dos
implementaciones que puedan separarse.

Mínimo: **3 USD** por aportación, el mismo que valida el servidor al cobrar.

### 8-bis.4 La RECURRENTE (suscripción mensual a una comunidad)

La única que se repite sola, y la única que usa Stripe Billing.

```
1. El creador activa la suscripción y fija la cuota mensual   → en USD
2. Vibra crea UN producto genérico en Stripe (una sola vez)
3. Al suscribirse se crea la suscripción con su precio ya fijado
4. Stripe cobra solo cada mes; un webhook renueva el acceso
```

**El precio se fija al crear la suscripción y rige todas las renovaciones.** No se
re-cotiza cada mes.

⚠️ Por eso el 2% de conversión es aquí **más** necesario que en ningún otro sitio: no se puede
fijar la tasa en un cobro recurrente, así que Stripe convierte a su cambio **en cada
renovación**, mes tras mes, durante toda la vida de la suscripción.

Solo comunidades **privadas u ocultas** pueden cobrar suscripción: una comunidad pública no,
y la regla de base de datos lo impide, no solo la interfaz. En las ocultas hace falta además
una invitación válida, y su cupo se **reserva antes de cobrar** — si no, dos personas con el
último cupo pagaban las dos y entraban las dos.

Mínimo: **1.50 USD** al mes.


### 8-bis.5 Tabla de las siete

| Experiencia | Cobro | Tasa fijada | Mínimo | Tipo en el ledger |
|---|---|---|---|---|
| Saludo | Retención → al entregar | ❌ | 3 USD | `greeting` |
| Consejo | Retención → al entregar | ❌ | 3 USD | `advice` |
| Sesión exclusiva | Retención → al entregar | ❌ | 9 USD | `exclusive_session` |
| Tiempo contigo | Retención → al entregar | ❌ | 9 USD | `live_session` |
| Donación en perfil | Inmediato | ✅ | 3 USD | `profile_donation` |
| Donación en comunidad | Inmediato | ✅ | 3 USD | `profile_donation` |
| Suscripción mensual | Recurrente | ❌ (recurrente) | 1.50 USD | `subscription` |

### 8-bis.6 Estado de la integración con Stripe, hoy

| Pieza | Estado |
|---|---|
| Cuenta | Vibra On, LLC (EE. UU.) — `acct_1U46R37tY0CtRg4D` |
| Modo | **Prueba.** El corte a real sigue pendiente |
| Cobros | 10 caminos, todos por el mismo cálculo (verificado de forma mecánica) |
| Retenciones | Autorizar y capturar, con respaldo a 6 días |
| Billing | Suscripciones por API; **no hubo que habilitar nada** |
| Tasas de cambio | Stripe FX Quotes · las 78 monedas con tasa · refresco cada 15 min |
| Impuestos | 147 jurisdicciones, 50 cobran · las 21 altas hechas |
| Webhooks | Llegan y materializan compras, retenciones y renovaciones |
| Devoluciones | Crédito y efectivo — **sin auditar todavía** |
| **Retiros al creador** | 🔴 **NO EXISTEN.** Y Stripe tiene las transferencias suspendidas |

**Lo que falta para producción**, en orden:

1. 🔴 **Retiros.** No hay forma de que el creador cobre. Es el hueco grande.
2. 🔴 **Tarea vencida en Stripe** que mantiene las transferencias suspendidas.
3. 🔴 **Confirmación por escrito** de que una plataforma estadounidense puede pagar a
   creadores en México. El soporte dijo que sí; la documentación dice otra cosa.
4. 🟡 **Devoluciones**, sin auditar de extremo a extremo.
5. 🟡 **Corte a modo real**: claves `sk_live`/`pk_live`, destino de webhook nuevo y
   redespliegue.
6. 🟡 En la suscripción, el país fiscal **no se recalcula con la tarjeta** (`TODO fase 2`);
   en las otras seis sí.
7. 🟡 En las cuatro con retención, el `paymentIntent` guarda un `fxQuoteId` que **ya no se
   usó** para liquidar. Como evidencia es engañosa: hay que dejar de estamparlo o marcarlo
   antes de citar ese campo en ningún documento.

**Conclusión.** El cobro está listo: las siete experiencias cobran bien, en la moneda
correcta, con el impuesto correcto y enseñando lo que van a cobrar. Lo que **no** está listo
es el otro lado del circuito: **el dinero entra y todavía no hay por dónde salga hacia el
creador.** Hasta que existan los retiros, esto no puede operar en real.

## 9. Dependencias para operar en vivo

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

## 10. Frentes abiertos

🟡 **La donación en un LIVE no tiene mínimo.** El banner del feed pasa `minBaseAmount` y el
modal lo valida; el de live no lo pasa, y `createLiveDonationStripeIntent` tampoco lo
comprueba en el servidor. Hoy se puede intentar donar un céntimo: por debajo del mínimo de
Stripe, así que el cobro falla con un error crudo en vez de avisar antes. Anotado el
2026-08-19 para cuando se revise el flujo de live; **no se toca ahora a propósito**, el live
es un frente aparte.

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
