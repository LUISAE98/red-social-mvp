# Integración Stripe — Vibra On, LLC

> Registro vivo del corte de Stripe México a **Stripe USA** y de todo lo que se decide sobre pagos.
> Arrancado el 2026-08-18. Se va actualizando conforme avanza.
>
> **Éste es el documento autoritativo de pagos.** Registra lo que hicimos y por qué.
>
> `docs/stripe-referencia-plataforma.md` es otra cosa: una compilación de la documentación de
> Stripe hecha en julio de 2026, con partes ya superadas. Se conserva como referencia técnica,
> no como fuente de verdad.

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
| `roundCharm` | El **precio** que paga el comprador | Termina en **9**, siempre hacia arriba, subiendo como mucho un escalón (ver 8-ter) |
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

⚠️ Desde el 2026-08-21 **los 11 mínimos se validan en el SERVIDOR**, no solo en el panel del
creador, y cada uno tiene espejo en el backend con test de paridad. Ver 8-quater.3.

**Niveles de supercomentario** (actualizados el 2026-08-21). Son SEIS: el sexto se añadió
como nivel tope y se pinta con el degradado de la marca —el mismo del botón `gradient` de
la guía de estilo— para que se lea como lo más especial que un fan puede mandar.

| Nivel | USD | Caracteres | Segundos en pantalla |
|---|---|---|---|
| Chispa | 2 | 60 | 10 |
| Llama | 6 | 140 | 15 |
| Fuego | 11 | 220 | 20 |
| Explosión | 16 | 300 | 25 |
| Volcán | 22 | 380 | 30 |
| **Supernova** | **33** | **500** | 35 |

⚠️ Estos precios son el CATÁLOGO, no lo que cada creador tenga guardado. El catálogo manda:
de la configuración del creador solo se rescata el precio. Ver 8-quater.4.

**Montos sugeridos de donación:** $3 / 7 / 15 / 30. Los usa la donación de LIVE; la de
PERFIL usa los que el creador configure.

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

`roundCharm`: el total sube al siguiente escalón de la moneda y termina en **9**. ⚠️ El
tamaño de ese escalón se bajó el 2026-08-20; ver **8-ter**.

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
| 5. Redondeo comercial | El total sube al siguiente escalón y termina en **9** (ver 8-ter) | El comprador |

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
| Cobros | **CERRADOS**: los 11 servicios auditados de punta a punta (ver 8-quater) |
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

**Conclusión** (actualizada el 2026-08-21: la auditoría se extendió a los ONCE servicios,
ver 8-quater). El cobro está listo: las experiencias cobran bien, en la moneda
correcta, con el impuesto correcto y enseñando lo que van a cobrar. Lo que **no** está listo
es el otro lado del circuito: **el dinero entra y todavía no hay por dónde salga hacia el
creador.** Hasta que existan los retiros, esto no puede operar en real.


## 8-ter. El escalón del redondeo comercial (decisión 2026-08-20)

### Qué se cambió

El redondeo comercial subía el total al siguiente **1 unidad** de la moneda del comprador.
Ahora sube al siguiente **`NICE_STEP` / 5**, que en dólares son 10 céntimos.

### Por qué

El escalón de 1 unidad **no vale lo mismo en todas las monedas**. Un peso mexicano son 6
céntimos de dólar y nadie lo notaba; un dólar o un euro son la unidad entera. Medido:

| Base del creador | Total con escalón 1.00 | Encarecía |
|---|---|---|
| 2.00 USD | 2.99 USD | **49.5%** |
| 3.00 USD | 3.99 USD | 33.0% |
| 5.00 USD | 5.99 USD | 19.8% |
| 20.00 USD | 20.99 USD | 4.9% |

El daño era **regresivo**: cuanto más barata la experiencia, más se encarecía. Y caía
justo sobre la compra por impulso —súper comentario, ticket de live, post premium—, que es
la que vive de ser barata.

### Por qué NO se tocaron los mínimos

Se midió el neto de Vibra después de la comisión real de Stripe (2.9% + 1.5% de tarjeta
extranjera + 0.30 fijos + 0.05 de Radar). **Ningún mínimo actual pierde dinero**: un post
premium de 1.50 USD deja 0.39 USD limpios. Así que el problema no eran los mínimos sino el
escalón, y se corrigió el escalón.

### Por qué NO se pierde estabilidad de precio

El colchón frente al movimiento del tipo de cambio **no lo daba el redondeo**: lo da el
vigilante de deriva, que refresca la tasa congelada en cuanto se desvía un **0.5%**
(bandas propias para ARS, TRY, NGN, EGP y VND). Bajar el escalón no quita colchón, quita
sobrecobro.

### A quién beneficia

**38 de las 78 monedas.** Las de unidad valiosa, que son las que tenían el escalón
desproporcionado:

| Escalón nuevo | Monedas |
|---|---|
| 0.01 – 0.05 | KWD · JOD · KYD |
| **0.10** | **USD · EUR · GBP** · CAD · AUD · NZD · SGD · MYR · QAR · AED-área · BAM · PGK · FJD · TOP · WST · BZD · BMD · XCD · GIP · AZN · BND |
| 0.20 | BRL · PLN · DKK · RON · PEN · BOB · GTQ · HKD · AED · SAR · TTD |
| 0.40 | MAD · SBD · MVR · BWP |

**Las otras 40 no cambian** —peso mexicano, argentino, colombiano, chileno, yen, won,
real...— porque su escalón ya era fino. Esto importa para el contrato: **el precio en pesos
mexicanos no se movió ni un céntimo con este cambio.**

⚠️ La calibración no se decidió moneda por moneda: sale de dividir entre 5 la tabla
`NICE_STEP`, que ya estaba pensada para que el escalón valga lo mismo en poder adquisitivo
en las 78. Por eso el reparto entre "mejora" y "no cambia" sale solo.

### Lo que el escalón NO arregla

El **cargo fijo de 0.40 USD** no depende del redondeo. En un servicio de 1.50 USD son un
27% del precio del creador, y es el coste real de Stripe por transacción (0.30 fijos +
0.05 de Radar, con margen para que Stripe cobre su porcentaje también sobre ese cargo).

Si algún día se quieren micro-compras de verdad baratas, la vía **no** es bajar mínimos:
es que el comprador recargue saldo una vez y gaste desde ahí, con un solo cargo de Stripe
para muchas compras. El sistema de saldo a favor ya está construido.

### Verificación

Los dos espejos del redondeo —`backend/src/tax/presentmentFormat.ts` y
`lib/currency/format.ts`— se comprobaron importe a importe sobre las **78 monedas**: dan el
mismo número. Si se separan, el precio mostrado y el cobrado se separan con ellos.


## 8-quater. Cierre de los flujos de cobro (auditoría 2026-08-20/21)

Repaso completo de los **11 servicios**, de la activación del servicio al cargo en Stripe.
Todos quedan cerrados. Este apartado recoge lo que se encontró, porque casi todo pertenece a
dos familias que van a volver a aparecer.

### 8-quater.1 Familia 1 — restos de la denominación en pesos

⚠️ **Aquí "pesos" es literal, no un ejemplo de moneda local.** Son dos cosas distintas que
se confunden con facilidad:

* **Denominación** — la moneda en la que se FIJA y se liquida un precio. Antes del corte era
  el peso mexicano, porque la plataforma era solo México. Hoy es el dólar, para todos.
* **Moneda local** — la moneda en la que se le MUESTRA y se le cobra a cada comprador.
  Depende de su país y son 78 distintas.

Lo de esta familia es lo primero: importes que se fijaron en pesos y se quedaron guardados
así, y que con la denominación ya en dólares el servidor pasó a leer como dólares. Un 297
que eran ~17 USD se cobraba como 297 USD.

El corte a USD dejó esos importes en sitios que el barrido original no alcanzó, porque
**no llevaban la palabra "MXN" al lado**. Buscar el texto no bastaba.

| Dónde | Qué pasaba |
|---|---|
| `createPost` | `PRECIO_MIN = 10` eran diez PESOS; con la denominación en dólares el servidor rechazaba toda publicación de pago por debajo de 10 USD |
| Niveles de supercomentario en 5 lives | Precios 15/35/75/150/297 en pesos, cobrados como dólares: **17 veces de más** |
| `users/{uid}/settings/superCommentConfig` | La configuración del creador, también en pesos; es la que carga el panel |
| **Regla de Firestore** | Exigía `currency == "MXN"`; el panel ya guardaba "USD" y la regla **rechazaba en silencio** todo guardado de niveles |
| `LiveComposerModal` | Escritura del CLIENTE que guardaba `currency: "MXN"` junto a un importe en dólares |
| Precios precargados al reabrir paneles | VOD, ticket de live y niveles de supercomentario **convertían** el precio guardado, así que el creador veía un número distinto del que puso |

⚠️ **El reseteo original a USD limpió `liveData.ticketPrice` pero NO
`liveData.superCommentConfig.tiers`.** De ahí salieron los precios de 17×. Quedan dos scripts
en `scripts/` para el mismo patrón: `reset-supercomment-tiers.ts` (por live) y
`reset-supercomment-user-config.ts` (por creador).

**Lección para el siguiente barrido:** buscar números pelados y campos de precio, no la
cadena "MXN". Y revisar los tres sitios donde vive un precio: el post, la configuración del
creador y las reglas.

### 8-quater.2 Familia 2 — la ganancia del creador calculada con la fórmula del comprador

`usePriceFormat().format` calcula el **precio del COMPRADOR**: convierte a la moneda de quien
mira, suma el 2% de conversión y redondea al escalón. Usarlo para mostrar lo que gana el
creador da una cifra **convertida e inflada**, que no existe en ninguna parte.

Apareció **siete veces** en sitios distintos: composer premium, panel del VOD, composer de
live, tarjeta del post, panel de configuración de niveles, ganancia por donación y —dos
veces— las estadísticas de ingresos del live.

La ganancia del creador **no se convierte**: vive en la moneda de liquidación. Se muestra con
`formatCurrency(monto, SETTLEMENT_CURRENCY, locale)` y, debajo, una referencia en su moneda
con redondeo grueso y la palabra "aproximadamente" delante.

### 8-quater.3 Mínimos: ahora en el servidor, los 11

Estaban **solo en el navegador** para seis de ellos. No era un agujero de seguridad —el
precio del cobro lo lee el servidor del perfil del creador, el cliente no puede inyectarlo—
pero dejaba pasar un precio guardado por debajo del mínimo con un cliente modificado.

| Servicio | Mínimo | Dónde se valida ahora |
|---|---|---|
| Saludo · Consejo | 3 USD | `greetingStripeIntent` |
| Sesión exclusiva · Tiempo contigo | 9 USD | `serviceStripeIntent` |
| Post premium · VOD | 1.50 USD | `createPost` **y** `premiumPostStripeIntent` |
| Supercomentario | 1.50 USD | `superCommentStripeIntent` |
| Suscripción | 1.50 USD | `groupSubscriptionStripe` |
| Ticket de live | 1.50 USD | `liveAccessStripeIntent` |
| Donación (perfil y live) | 3 USD | `donationStripeIntent` · `liveDonationStripeIntent` |

⚠️ **La suscripción es la que más importa**: una cuota por debajo del mínimo no se cobra mal
una vez, se cobra mal **todos los meses** mientras dure.

Cada mínimo tiene su **espejo en `backend/src/wallet/ledger.ts` con test de paridad**: si el
del catálogo y el del backend se separan, el creador publica un precio que el servidor
rechaza.

### 8-quater.4 El catálogo manda sobre lo guardado

Los niveles de supercomentario se resolvían recorriendo **la lista guardada**. Consecuencia:
un nivel nuevo **no le llegaba jamás** a quien ya hubiera guardado su configuración — se
quedaba con los que había el día que guardó, para siempre.

Peor: el selector del fan podía enseñar un nivel que el backend rechazaba con "Nivel de
supercomentario inválido", con el fan intentando pagar.

Ahora los **tres** sitios —panel del creador, selector del fan y `resolveTier` en el
backend— recorren el catálogo y de lo guardado rescatan **solo el precio**. Nombre, color,
degradado y caracteres no son editables. De regalo, quitar un nivel del catálogo lo quita
también de las configuraciones viejas en vez de dejarlo colgando.

### 8-quater.5 Otros cierres

* **El destello de la pantalla verde.** `onPaid` se ejecutaba 300 ms ANTES de mostrar el
  éxito, así que el contenido de debajo cambiaba a su estado desbloqueado mientras el
  formulario seguía desvaneciéndose. Ahora van en el mismo tick. ⚠️ No se retrasó `onPaid`:
  si el modal se desmontara en esos 300 ms, el aviso de un pago YA COBRADO no llegaría nunca.
* **La voz del live leía mal la donación.** Decía "donó 7 pesos" a quien pagó 148.99 MXN:
  leía `amount` —la base del creador, en dólares— y encima la llamaba pesos. El documento no
  guardaba lo cobrado; ahora conserva `presentmentAmount` y `presentmentCurrency` y la voz
  lee eso, con el nombre de la moneda resuelto por `Intl.DisplayNames`.
* **Precio mostrado ≠ precio cobrado** en la pantalla del live y en la tarjeta del post: se
  enseñaba la base pelada, sin cargo fijo ni impuesto, y la pasarela pedía el total.
* **La pasarela del post premium** leía el precio de un campo distinto que el servidor
  (`premium.price` contra `oneTimePrice`).
* **El rojo del ticket pagado.** En esta interfaz el rojo significa problema; se le
  confirmaba la compra al comprador con el color de una alarma. Ahora es el morado del resto.

### 8-quater.6 Lo que quedó verificado de forma mecánica

| | |
|---|---|
| Los 8 caminos de cobro usan `composeCharge` + redondeo comercial | ✅ |
| El 75% sale de un ÚNICO punto (`netFromGross`) | ✅ Cero cálculos sueltos en el backend |
| El cargo fijo se suma en un único punto (`composeCharge`) | ✅ |
| Los 11 comparten régimen fiscal (`export_zero`) | ✅ |
| El precio del cobro lo lee el SERVIDOR, nunca el cliente | ✅ Los 11 |
| Las donaciones aceptan importe del comprador, con mínimo y tope | ✅ Por diseño |
| Los dos espejos del redondeo coinciden en las 78 monedas | ✅ |


## 8-quinquies. Devoluciones: los dos flujos (2026-08-22)

Solo las **cuatro experiencias que el creador entrega** —saludo, consejo, sesión exclusiva y
tiempo contigo— tienen devolución. El resto se cobra al instante y no hay nada que devolver.

### 8-quinquies.1 Flujo 1 — la retención sigue viva

```
El comprador paga  →  se AUTORIZA, no se cobra
El creador rechaza →  se LIBERA la retención     ← automático, sin pedir nada
```

**Nadie pide nada y no cuesta comisión**: el dinero nunca salió de la tarjeta. Se refleja como
*"Devuelto a tu tarjeta"*.

⚠️ Y no se cobra lo que ya está muerto. El respaldo del día 6 filtraba solo por
`paymentStatus == "authorized"`, y ese campo sigue diciendo eso en una experiencia rechazada:
capturaba en firme algo que nadie iba a entregar. Ahora salta las rechazadas y **libera su
retención**. Ver `ESTADOS_SIN_ENTREGA`.

⚠️ La cancelación se ANOTA en el documento (`paymentStatus: "canceled"`). Antes se cancelaba
en Stripe y el documento se quedaba en `authorized`, así que para el resto del sistema el
cobro seguía vivo: el barrido lo recogía en cada pasada y al comprador se le seguía ofreciendo
«pedir devolución» por un dinero que ya tenía.

### 8-quinquies.2 Flujo 2 — el cobro ya se capturó

```
El cobro se capturó (entrega, o respaldo del día 6)
El creador rechaza  →  no hay retención que liberar
El comprador PIDE la devolución  →  SALDO A FAVOR
   · lo gasta en la plataforma (aparece en la pasarela como un medio de pago más)
   · o pide EFECTIVO → solicitud al panel de moderación
```

El asiento del creador se revierte **como devolución**, no como pérdida. Y el rechazo por sí
solo no revierte nada: espera a que el comprador decida entre devolución o intentar de nuevo.

### 8-quinquies.3 El saldo vive en la MONEDA DEL COMPRADOR

Decisión del 2026-08-22, y es la parte que más cambió.

Antes el saldo se guardaba en la moneda de liquidación y se mostraba convertido. Dos
problemas:

* **No coincidía con el recibo.** Se cobraron 808.99 MXN y el saldo decía 808.91. Y al día
  siguiente otra cifra distinta, porque el tipo de cambio se mueve.
* **La resta de la pasarela no cuadraba.** El saldo se descontaba en la moneda de liquidación
  y solo DESPUÉS se convertía el resto, así que lo que veía el comprador y lo que se le
  descontaba salían de dos conversiones distintas.

Ahora:

```
1. Se resuelve el TOTAL en la moneda del comprador (con su precio comercial)
2. El saldo se descuenta EN ESA MONEDA
3. La tarjeta cobra el resto, en esa moneda
```

Con lo que **saldo + tarjeta = total**, exacto.

| | |
|---|---|
| Se devuelve | El importe EXACTO del recibo, en su moneda |
| No se mueve | El saldo no cambia con el tipo de cambio |
| Contabilidad | Se guarda también el equivalente en liquidación |
| Monedas distintas | Se convierte con la tabla congelada; si no sirve, **no se aplica saldo** |

⚠️ **El riesgo de tipo de cambio pasa a Vibra**, que es donde debe estar: una devolución es
una deuda con el comprador y no puede encoger sola. Lo cubre el 2% de conversión ya cobrado
en cada compra. Se descartaron a propósito la **caducidad** del saldo —en México y la UE el
dinero de una devolución es del comprador, ponerle fecha es terreno legal delicado— y las
**coberturas financieras**, desproporcionadas a esta escala.

Para vigilarlo basta un dato: cuánto saldo vivo hay por moneda. Mientras sea pequeño frente a
los ingresos, no hay nada que decidir.

### 8-quinquies.4 Lo que se corrigió por el camino

* **El importe devuelto salía inflado.** Los espejos guardaban solo el importe en moneda de
  liquidación y la lista lo reconvertía con la fórmula del COMPRADOR —2% y redondeo al
  escalón—: 810.99 se enseñaba como 825. Ahora se guarda el cobro real (`presentmentAmount`)
  y se muestra tal cual, en las devoluciones a tarjeta **y** a crédito.
* **El respaldo del trigger sumaba `+ 3`** — el cargo fijo en PESOS de antes del corte—, así
  que devolvía de menos.
* **La herramienta de QA capturaba Y acreditaba de una vez.** Dejaba un estado imposible: la
  experiencia esperando entrega y el comprador ya reembolsado; si el creador entregaba, se
  quedaba con las dos cosas. Ahora **solo captura**; el crédito lo emite el flujo real.
* **Se podía pedir la devolución dos veces.** La segunda siempre falla —el estado ya no es
  elegible—, así que salía el panel verde de éxito Y un aviso rojo. Se corta en el cliente y
  se rechaza en el servidor.
* **El panel de moderación mostraba `$1,234.56` sin moneda.** En una pantalla donde se
  aprueban devoluciones, ese símbolo se lee como pesos.


### 8-quinquies.5 Contracargos: lo que hay y lo que falta

**Ya montado.** Al abrirse una disputa (`charge.dispute.created`) se registra en
`stripeDisputes` para que aparezca en el panel, pero **no se le quita el acceso al
comprador**: la disputa puede ganarse, y quitarle el contenido a quien tiene razón es peor
que esperar. Al cerrarse perdida (`charge.dispute.closed` con `lost`) se revierte el asiento
del creador y **se revoca el acceso**. Si se gana, no se toca nada.

Cubre también los reembolsos hechos **desde el panel de Stripe**, no solo desde la
aplicación, así que la wallet nunca queda inflada frente a lo que Stripe tiene. Deduplica
por `event.id`, de modo que un reintento de Stripe no revierte dos veces.

⏳ **PENDIENTE — responder la disputa con evidencia.** Hoy las disputas se registran pero
nadie las contesta: hay que entrar a Stripe a mano y hay plazo. Cuando se habilite, lo que
hace falta es reunir la evidencia que ya existe en el sistema —el recibo, la entrega, los
indicios de país fiscal, la conversación— y subirla por API. Se deja anotado a propósito:
mientras el volumen sea bajo se atiende a mano, pero conviene una alerta para que ninguna
se pase de plazo.


## 8-sexies. Retiros al creador: Global Payouts (investigación 2026-08-23)

### 8-sexies.1 Por qué NO se usa Connect

Es la conclusión que más ahorra tiempo, y va primero.

Las **transferencias transfronterizas de Connect** solo funcionan entre plataformas y cuentas
conectadas en **EE. UU., Reino Unido, EEE, Canadá y Suiza**. La documentación es explícita:

> *"Stripe no admite transferencias transfronterizas autoservicio a países fuera de las
> regiones listadas."*

**México no está**, y no se resuelve con un formulario: hay que hablar con ventas.

⚠️ El archivo `backend/src/payments/stripe/stripeConnect.ts` describe el problema al REVÉS —
dice que la plataforma es mexicana y que por eso solo se puede pagar en México—. Es de antes
del corte a Vibra On, LLC. Hoy el problema es el inverso: desde EE. UU. se llega a Europa y
Canadá, pero **no a México**.

Así lo resuelven otros: **Kick no usa Connect**. Paga con Stripe directo, en dólares, a una
cuenta que Stripe admita — y el creador latinoamericano acaba abriendo una cuenta
estadounidense con un tercero (Wallbit, Payoneer) para poder cobrar. Es pasarle el problema
al creador.

### 8-sexies.2 La vía elegida: Global Payouts

Producto distinto de Connect. Manda a **más de 160 países**, el destinatario **no necesita
cuenta de Stripe**, y una de sus aplicaciones declaradas es pagar a creadores.

| | |
|---|---|
| Emisores | Solo **EE. UU. y Reino Unido** — la LLC lo cumple |
| México como destino | ✅ Confirmado en la tabla oficial |
| Moneda | **MXN** |
| Método | Transferencia bancaria local |
| Datos que pide | Correo y nombre (persona física) |

**El creador cobra en pesos a su banco de siempre, sin abrir nada en el extranjero.** Es una
ventaja real frente a lo que ofrece Kick.

### 8-sexies.3 Lo que cuesta

```
1.50 USD fijo  +  0.25% transfronteriza  +  1% conversión a pesos
```

México está en el tramo más barato de comisión transfronteriza (**0.25%**), el mismo que
EE. UU., Reino Unido y Canadá. Hay países al 1% y Perú al 1.25%.

| Retiro | ≈ MXN | Coste | % del retiro |
|---|---|---|---|
| 30 USD | 508 | 1.88 | **6.25%** |
| 50 USD | 846 | 2.13 | 4.25% |
| 100 USD | 1,692 | 2.75 | 2.75% |
| **295 USD** | **4,991** | **5.19** | **1.76%** |
| 500 USD | 8,460 | 7.75 | 1.55% |
| 1,000 USD | 16,920 | 14.00 | 1.40% |

Fondear la cuenta financiera por **ACH es gratis**; por transferencia bancaria, 2 USD.

⚠️ El coste es **regresivo**, igual que el cargo fijo de los cobros: cuanto más pequeño el
retiro, más pesa. El mínimo de **5,000 MXN** cae justo donde la curva se aplana (1.76%), y
ahora hay número que lo justifica.

⚠️ Stripe cobra estas comisiones **de la cuenta financiera**, no las descuenta del envío. Hace
falta saldo para el pago Y su comisión, o el envío falla.

### 8-sexies.4 DECISIÓN: la comisión la absorbe Vibra

**Al creador le llega el 75% de lo que programó, siempre.** El coste del retiro sale de la
parte de Vibra, igual que el 0.40 USD fijo y el 2% de conversión no le tocan su parte.

Es coherente con todo el modelo: el creador fija un precio y sabe exactamente qué recibe.

### 8-sexies.5 Cómo se activa y cómo se prueba

**Activar (cuenta real):** `Balances` → `Send` → agregar fondos a la cuenta financiera. Puede
pedir información extra y **la verificación tarda días hábiles**.

**Probar (sin cuenta bancaria):** hace falta un **sandbox**, no el "modo de prueba" clásico —
Global Payouts usa la API v2 y el modo de prueba de siempre no la soporta. Se crea con
`Copiar cuenta` para heredar los productos habilitados, y dentro se pulsa **Empezar** en la
página de Transferencias internacionales.

⚠️ Sin completar ese onboarding, la pantalla de Beneficiarios existe pero **crear uno falla**
con un error genérico. Es lo que costó media tarde localizar.

### 8-sexies.6 Lo que hay que construir

| Objeto (API v2) | Para qué |
|---|---|
| `FinancialAccount` | El saldo desde el que se paga; se crea al activar |
| `Account` con configuración de destinatario | El creador |
| `AccountLink` | Formulario alojado por Stripe: datos, CLABE y **KYC** |
| `PayoutMethod` | Su cuenta bancaria |
| `OutboundPayment` | El pago |

⚠️ Tres cosas que cambian cómo se programa:

* Es la **API v2**, distinta de la v1 que usan todos los cobros.
* Está en **vista previa**: SDK del canal de preview, y la API puede cambiar.
* Los webhooks son **"thin events"**, otro formato. `stripeWebhook` no los entiende.

🔴 **EL KYC NO VIENE RESUELTO.** Corregido el 2026-08-27; antes esta línea decía lo contrario y
era falso.

La documentación de Stripe lo dice sin rodeos: *«Your business is responsible for all
interactions with your recipients and for collecting all the necessary information to verify
them.»* **Global Payouts no verifica identidad.** El `AccountLink` recoge los DATOS DE COBRO
—cuenta bancaria, CLABE—, no comprueba quién es la persona. Eso lo hace Connect, no esto.

⚠️ Consecuencia: **hace falta un proveedor de identidad** (Didit u otro). El plan de sustituir
a Didit por «el KYC de Stripe» no se sostiene con Global Payouts.

Existe una vía opcional en vista previa —Financial Connections— para confirmar de quién es la
cuenta bancaria enlazada. Es titularidad de la cuenta, no identidad de la persona.

⚠️ El enlace del formulario **caduca a los 3 días**, o al abrirlo dos veces. Hay que poder
regenerarlo. Y por cumplimiento **no se pueden capturar datos de tarjeta de débito a mano**:
solo cuentas bancarias.

### 8-sexies.7 Estado (act. 2026-08-26)

✅ **Global Payouts YA ESTÁ ACTIVO en el entorno de prueba.** Cuenta `acct_1U7eCc4PM5Bep8JM`.

**Cómo se comprueba, porque no es evidente:** no hay ninguna pestaña que diga «Global Payouts».
No es un producto de panel como Connect o Billing — es API-first, y lo único que añade al
panel son dos cosas:

* **«Cuenta financiera»** en Saldos («Dinero que puedes enviar a otras personas»). Es el
  `FinancialAccount`. Una cuenta normal de Stripe **no la tiene**.
* **«Transferencias internacionales»** en los accesos directos del menú izquierdo.

Buscar una pestaña con su nombre es lo que costó media tarde la primera vez.

🔴 **Falta para operar en real:** la verificación de la empresa (pasaporte). Hasta entonces solo
prueba — pero **ya se puede programar contra ella**.

### 8-sexies.7-bis Connect frente a Global Payouts

Son productos distintos y confundirlos lleva a diseñar mal el ledger:

| | Connect | Global Payouts |
|---|---|---|
| Para qué sirve | Marketplaces | Enviar dinero |
| El creador tiene | Su propia cuenta de Stripe | Solo es un destinatario |
| El dinero | Se reparte al cobrar | Sale de una caja única cuando tú lo mandas |
| Llega a México | ❌ No | ✅ Sí |

En **Connect** cada creador tiene su propia caja dentro de la tienda y Stripe reparte solo. Sus
transferencias transfronterizas solo alcanzan US·UK·EEE·CA·CH: **México queda fuera**, y por eso
se descartó.

En **Global Payouts** hay **una sola caja** —la cuenta financiera—, todo entra ahí y desde ahí
salen transferencias a más de 160 países. El creador no tiene cuenta de Stripe.

⚠️ **Consecuencia de arquitectura:** Stripe no sabe cuánto le toca a cada creador. El saldo por
creador vive en el ledger de Vibra y en ningún otro sitio. Eso convierte al ledger en la única
fuente de verdad del dinero de cada quien, no en una copia de lo que Stripe ya sabe.

### 8-sexies.7-ter Coste real a México (verificado 2026-08-27)

| Concepto | Coste |
|---|---|
| Fijo por pago (remitente US) | **1.50 USD** |
| Transfronteriza a México | **0.25%** |
| Conversión USD → MXN | **1%** (remitente US; sería 2% si no lo fuera) |
| Fondear la cuenta financiera por ACH | Gratis |
| Fondear por wire | 2 USD |

**Sobre el mínimo de 300 USD: `1.50 + 0.75 + 3.00 = 5.25 USD`, o sea 1.75%.**

🚨 **Es MUCHO más caro que Connect** (0.25% + 0.25 USD). La diferencia es el **1% de
conversión**: Connect movía dólares a dólares; aquí se convierte a pesos en cada pago.

⚠️ `docs/modelo-financiero.md` tiene apuntado **0.72% de payout**, que era el número de Connect.
Con Global Payouts y el mínimo actual son **1.75%**, y como Vibra absorbe el coste para que al
creador le llegue su 75% íntegro, ese punto de más sale de la comisión del 25%.

**Moneda:** al creador mexicano se le paga en **MXN**, a cuenta bancaria local. Stripe solo
exige de él **correo y nombre** más la cuenta. El descalce sigue en pie: se cobra en USD, el
ledger vive en USD y el pago sale en pesos.

### 8-sexies.8 Enlaces

* [Global Payouts](https://docs.stripe.com/global-payouts)
* [Empezar](https://docs.stripe.com/global-payouts/get-started)
* [Tarifas](https://docs.stripe.com/global-payouts/pricing)
* [Crear destinatarios y países admitidos](https://docs.stripe.com/global-payouts/recipient-creation-options)
* [Transferencias transfronterizas de Connect](https://docs.stripe.com/connect/cross-border-payouts) — por qué NO
* [Sandboxes](https://docs.stripe.com/sandboxes)

## 8-septies. Modelo fiscal definitivo: INTERMEDIACIÓN (2026-08-26)

Confirmado con fiscalista. Sustituye al modelo de vendedor directo que rigió entre el 28 de julio y el
25 de agosto. **El creador vende y presta al comprador; Vibra intermedia y cobra por su cuenta.**

El detalle vive en `docs/legal/fiscal-iva-isr-plataforma.md` §0. Aquí queda lo que toca a pagos.

### Lo que cambia para el cobro

- **El comprador contrata con el creador**, no con Vibra. Vibra cobra al amparo de un **mandato de
  cobro** que el creador acepta por separado.
- **El 25% vuelve a ser comisión**, no margen. Con creador mexicano lleva **16% de IVA por encima**,
  nunca dentro: si fuera dentro, la comisión efectiva caería a 21.55% y Vibra absorbería un impuesto que
  no puede acreditar.
- **Ingreso contable de Vibra = su comisión**, no el 100% del precio.

### La matriz, con base 100 y comisión 25

| | Comprador MX | Comprador extranjero |
|---|---|---|
| **Creador MX** | Paga 116 · ret. IVA 8 · ret. ISR 2.50 · comisión 25+4 → **deposita 76.50** | Paga 100 + impuesto de su país · **0% mexicano** · ret. ISR 2.50 · comisión 25+4 → **deposita 68.50** |
| **Creador extranjero** | Paga 116 · ret. IVA **100%** = 16 · sin ISR · comisión 25 → **deposita 75.00** | Sin impuesto mexicano · comisión 25 → **deposita 75.00** |

Una sola fórmula cubre los cuatro casos:

```
neto = (base + ivaVenta) − (comisión + ivaComisión) − retIVA − retISR

  retIVA = tasaRetIVA × ivaVenta      ← se anula solo cuando la venta va a 0%
  retISR = tasaRetISR × base          ← NO depende del comprador
```

### ✅ Exportación a 0% confirmada

**Los 11 servicios se tratan como exportación de servicios cuando el comprador está fuera de México.**
Cierra el riesgo de doble imposición que quedaba abierto. Falta conservar la evidencia por operación.

### 🚨 El país de la cuenta de destino es un dato fiscal

Que el creador cobre en una cuenta **fuera de México** dispara la retención del **100%** del IVA. Depende
de dónde cobra el creador, no de dónde estén las cuentas de Vibra: pagar desde Stripe US a un creador
mexicano con cuenta mexicana **no** lo activa. Hay que reevaluarlo cada vez que cambie su cuenta.

### Los tres comprobantes

1. **Venta al comprador** — la emite Vibra **por cuenta del creador**, con el sello digital de éste, que
   se solicita al completar el alta de cobro antes del primer retiro.
2. **Comisión** — Vibra al creador mexicano, 25% + IVA.
3. **Constancia de retenciones** — Vibra al creador mexicano, periódica.

**Creador no mexicano:** comprobante de pago **y, si se le retiene IVA mexicano, también su constancia
de retenciones** — que sí puede emitirse a un receptor extranjero. Solo el caso extranjero-extranjero,
sin retención alguna, se queda en comprobante de liquidación.

> ⬜ **Pendiente con el contador:** que la **comisión de Vibra al creador extranjero** califique
> **por separado** como exportación al 0%. Es otra operación distinta de la venta; que los 11 servicios
> sean exportación no la arrastra. Si no califica, lleva 16% que absorbe Vibra.

> 🚨 **La tasa de ISR es de vigencia anual.** El 2.5% viene de la Ley de Ingresos, no del artículo 113-A
> (que sigue diciendo 1%). Debe ser configurable por ejercicio y revisarse cada diciembre.

---

## 8-octies. Alta de cobro del creador — plan acordado (2026-08-27)

Lo que hay que construir para que un creador pueda retirar. Anotado **antes** de programar, para
no perder las decisiones ya tomadas.

### 8-octies.1 El flujo del panel

> ⚠️ **SUPERADA por §8-octies.9.** Describe el flujo tal como se planeó el 2026-08-27, con dos
> pasos y el tercero condicional. El flujo real tiene CUATRO y añadió la ruta de Wallbit.

Se pulsa el aviso morado de Finanzas y se abre el panel con **dos opciones**:

| | Opción | Quién la resuelve |
|---|---|---|
| 1 | **Verificación de identidad** | Didit |
| 2 | **Registro de cuenta de cobro** | Stripe Global Payouts |

Y **si cualquiera de las dos detecta que el creador es de México**, aparece una **tercera**:

| | Opción | Contiene |
|---|---|---|
| 3 | **Datos fiscales y sello** | RFC, régimen y CP · después el CSD |

🚫 **Se elimina la pregunta de residencia fiscal.** Hoy el panel arranca preguntando «¿dónde
declaras impuestos?». Sobra: el país sale del **documento del KYC** y del **país de la cuenta
bancaria**, que son datos duros y no una respuesta que el creador puede equivocar.

⚠️ Consecuencia: `setCreatorResidency` deja de ser una pregunta y pasa a **derivarse**. El
callable puede quedarse para corregir manualmente un caso raro, pero no como primer paso del alta.

### 8-octies.2 Qué gana cuando los dos detectan cosas distintas

Un mexicano con cuenta en Estados Unidos, o un español con cuenta mexicana. Son casos raros pero
existen, y **cada dato decide una cosa distinta**:

| Dato | Decide |
|---|---|
| **País del documento del KYC** | Si se le pide **CSD y datos fiscales** |
| **País de la cuenta de cobro** | Su **comisión** y su **mínimo de retiro** |

El motivo: quien debe facturar en México es quien **tributa** ahí, y eso lo dice su documento.
Lo que encarece la transferencia es **a dónde viaja el dinero**, y eso lo dice la cuenta.

### 8-octies.3 La tercera opción son dos pasos por dentro

> ⚠️ **Renumerada.** Lo que aquí se llama «tercera opción» es el paso **4** del flujo real.
> Lo que sigue siendo cierto es que el sello no se puede subir sin el RFC antes.

El CSD **no se puede subir sin el RFC antes**: Facturapi valida el sello contra el RFC declarado
y lo rechaza si no coincide. En pantalla puede ser una sola tarjeta, pero adentro van datos
fiscales primero y sello después. El backend ya lo exige:

> `"Primero completa tus datos fiscales (RFC, régimen, CP)."`

### 8-octies.4 Comisión y mínimo de retiro

Decidido el 2026-08-27. Fuente de verdad: **`docs/payout-tiers.md`**.

| Grupo | Comisión | Mínimo | Países | Le queda a Vibra |
|---|---|---|---|---|
| **Estándar** | **25%** | **300 USD** | 45 | 18.14% – 20.10% |
| **Transferencia cara** | **30%** | **500 USD** | 29 | 18.60% – 19.60% |
| Sin ruta de pago | — | — | 73 | — |

**Estándar (45)** — transferencia bancaria local:

```
US · AT BE BG CY CZ DE EE ES FI FR GB GR HR IE IS IT LT LU LV MT NL PT SI SK
CA HU MX NO SE · DK ID JM MA NZ PL SG TT · MC SM · RO · AU CR DO · PE
```

**Transferencia cara (29)** — wire, 25 USD fijos:

```
EC PA SV · HK TH ZA · TR
AE AG AL BA BN BT BW EG GT JO JP KW LC LK MD MN MY PH QA RS TW VN
```

**Sin ruta de pago (73)** — venden pero no se les puede pagar. Incluye Brasil, Argentina,
Colombia, Chile, Uruguay, Paraguay, Bolivia, Corea del Sur, Arabia Saudita, Nigeria.

```
AD AI AR AS AZ BM BO BQ BR BZ CC CI CL CO CX DM EA FJ FM FO GD GF GG GI GL GP GU HN HT IC
JE KH KI KN KR KY ME MH MP MQ MS MV NC NF NG NI NP NR NU PF PG PM PN PR PY RE SA SB SJ SR
TC TK TO TV UY VA VC VG VI VU WF WS YT
```

⚠️ **La lista vive en DOS sitios y tienen que coincidir**, igual que la tabla de impuestos y el
motor fiscal: el **backend** decide (es quien calcula la comisión que se congela en el asiento) y
el **frontend** solo muestra (el «ganarás X», el mínimo en la barra de progreso). Un test de
paridad los compara, porque si se desalinean el creador ve una cifra y cobra otra.

### 8-octies.5 Los bloques, en orden

| | Bloque | Depende de |
|---|---|---|
| **A** | **Tabla de niveles por país.** Módulo puro: país de la cuenta → comisión y mínimo. Espejo front/back con test de paridad. Un país sin fila **no es 25% por defecto, es no pagable**: los 73 tienen que fallar ruidosamente. | — |
| **B** | **País de la cuenta en el perfil.** `setCreatorPayoutAccountCountry` ya existe pero **nada lo escribe**. Sale del alta de Stripe. | Alta de Stripe |
| **C** | **Congelar la comisión en el asiento.** Hoy el ledger escribe la constante; debe escribir la del creador en ese momento, como ya hace con las retenciones. Es lo que hace cumplible la regla de no recalcular hacia atrás. | A, B |
| **D** | **Los doce archivos que muestran el 75%.** `serviceDraft`, panel del live, resumen de fin de live, config de súper comentarios, compositor, bandeja de solicitudes, overlays de saludos, calendario. A un creador de 30% le prometen de más. | A |
| **E** | **Gate del retiro.** `canWithdrawNow`, la barra y el «te faltan X» usan 300 fijos. Pasan a leer el mínimo del creador. **Y falta añadir la cuenta bancaria al gate**: hoy se podría retirar sin destino. | A, B |
| **F** | **Contarlo bien.** Su comisión y su mínimo antes de activar monetización y antes del primer retiro, con el motivo — la transferencia a su país cuesta más, no es castigo. 47 idiomas. | A |
| **G** | **Backfill.** Los asientos existentes traen `commissionRate: 0.25`. Se respetan, por la misma regla de no recalcular hacia atrás. | C |

**Orden:** A y B en paralelo → C → D, E, F → G.

### 8-octies.6 Lo que hay que construir del lado de Stripe

| Pieza | Para qué |
|---|---|
| `Account` con configuración de destinatario | El creador |
| `AccountLink` | Formulario alojado: datos bancarios y CLABE |
| Retorno del enlace | Leer el estado y guardar país, identificador y estado |
| Regeneración del enlace | **Caduca a los 3 días** o al abrirlo dos veces |

⚠️ Es **API v2**, distinta de la v1 de los cobros, y está en **vista previa**. No hace falta el
SDK de preview: `stripeClient` ya acepta una versión de API por petición (lo usa `fxQuotes`).

⚠️ Los webhooks son **thin events** y `stripeWebhook` no los entiende. Se puede empezar
consultando el estado al volver del enlace y dejar el webhook para después.

### 8-octies.7 Lo construido (2026-08-27)

**Backend**

| Pieza | Dónde |
|---|---|
| `createPayoutAccountLink` — crea la cuenta de destinatario y devuelve el enlace | `backend/src/payments/stripe/globalPayoutsRecipient.ts` |
| `refreshPayoutAccountStatus` — relee la cuenta al volver y guarda país y estado | mismo módulo |
| Cuerpo JSON en `stripeFetch` | `stripeClient.ts` — la v2 rechaza el form-encoding |
| País del documento del KYC | `backend/src/kyc.ts` — el webhook guarda `documentCountry` al aprobar |

**Frontend**

| Pieza | Dónde |
|---|---|
| Las dos llamadas | `lib/wallet/payoutAccount.ts` |
| `esMexicano` derivado, sin preguntar | `lib/facturacion/creatorFiscal.ts` |
| Panel de tres pasos | `CreatorPayoutSetupPanel.tsx` |
| Retorno `?alta=ok` / `?alta=reintentar` | `wallet/finanzas/page.tsx` |

**Lo que cambia de comportamiento**

🔴 **El gate del retiro ahora exige la cuenta de cobro.** `payoutReady` pasó de
«identidad (+ sello si mexicano)» a **«identidad + cuenta de cobro (+ sello si mexicano)»**.
Faltaba: un creador con solo el KYC aprobado pasaba el gate, pedía su retiro y no había
cuenta a la que mandárselo. Consecuencia inmediata: **mientras nadie tenga cuenta dada de
alta, nadie puede retirar** — que es la verdad, no una regresión.

🚫 **Fuera la pregunta de residencia fiscal.** El país sale de dos señales duras y basta con
que una diga México. `setCreatorResidency` sobrevive como **anulación manual** para el caso
raro (un mexicano que tributa fuera, o al revés), no como primer paso del alta. Sus seis
claves de idioma se borraron de los 47 archivos.

**Estado**

| | |
|---|---|
| Conector de Stripe en Claude Code | ✅ Activo (2026-08-27) |
| Sandbox de Global Payouts | ✅ `acct_1U7eCc4PM5Bep8JM` |
| `createPayoutAccountLink` · `refreshPayoutAccountStatus` | ✅ Desplegadas y verificadas por nombre |
| Flujo del panel completo | ✅ Construido, ⬜ sin probar contra Stripe |
| Verificación de empresa (pasaporte) | 🔴 Falta para operar en real |
| Webhook de la cuenta de destinatario | ⬜ Son *thin events*, `stripeWebhook` no los entiende; se refresca al volver |
| Traducción a los 45 idiomas restantes | ⬜ Caen al inglés por el respaldo de `i18n/request.ts` |
| Bloques A–G (tabla de niveles) | ⬜ Sin empezar |


---
### 8-octies.8 Rutas de pago y cobertura — CERRADO (2026-08-27)

#### Qué se le pide a cada creador

| | Todos | Stripe | Wallbit | Mexicano |
|---|---|---|---|---|
| 1. Identidad (Didit) | ✅ | ✅ | ✅ | ✅ |
| 2a. Alta de cuenta Stripe | | ✅ | ❌ | ✅ |
| 2b. Datos de Wallbit | | ❌ | ✅ | |
| 3. Datos fiscales + CSD | | | | ✅ |

El KYC es de los **89 países pagables**, sin excepción. El tercer paso aparece cuando el país
del **documento del KYC** o el de la **cuenta de cobro** dicen México; basta con que una de las
dos lo diga.

#### El reparto de los 147

| Ruta | Comisión | Mínimo | Países |
|---|---|---|---|
| Stripe, transferencia local | 25% | 300 USD | 46 |
| Stripe, solo wire | 30% | 500 USD | 27 |
| **Wallbit** | **25%** | **300 USD** | **12** |
| Territorios por cuenta ajena | 25% | 300 USD | 4 |
| Sin ruta de pago | — | — | 58 |

#### ⚠️ Cómo se verifica la cobertura de Stripe, y cómo NO

Se cometieron **dos errores opuestos** el mismo día antes de dar con la forma correcta:

| Fuente | Qué pasó |
|---|---|
| `bank_account_spec` | Se pasa de largo. Devuelve el FORMATO de cuenta de países a los que Stripe no paga. Dio 90 pagables, 15 de más |
| Tabla de la documentación | Se queda corta. No lista Argentina, Colombia, Nigeria ni Camboya, que sí cobran. Dio 75, 4 de menos |
| **Crear un destinatario y leer sus capacidades** | ✅ La única fiable |

La prueba real está en `scripts/sondearPayouts.sh`. Crea un destinatario de prueba por país en
el sandbox y lee el estado de sus capacidades:

```
unsupported -> no existe la ruta.       NO se puede pagar.
restricted  -> existe, faltan datos.    SI se puede pagar.
active      -> lista.
```

⚠️ La trampa está en `restricted`: **México sale `restricted` y a México sí se le paga.** Leerlo
como «no se puede» fue lo que dejó fuera a Argentina y Colombia.

#### La ruta de Wallbit

12 países donde Stripe no llega o solo llega por wire. Cobertura según
`paiseswallbit.md`.

```
AR BR BO CO GT PA EC SV CL UY PY HN
```

⚠️ **En CL, UY, PY y HN Wallbit no tiene retiro a banco local**: el creador cobra en dólares y
su única salida documentada es cripto. Entran por decisión de producto —la alternativa era no
pagarles nada— y llevan la marca `soloDolares`, que dispara un aviso en el alta.

🚧 **El cuestionario de Didit donde darán sus datos de Wallbit todavía no existe.** Hasta
entonces el gate queda cerrado para ellos a propósito: abrirlo sin saber a dónde mandar el
dinero sería el mismo fallo que ya se arregló con Stripe.

#### 🚨 Los sin ruta NO pierden el impuesto

Siguen en los 147 de la tabla fiscal, siguen pagando el IVA de su país y siguen generando su
factura. `tax/config.ts` mantiene sus 147 filas. Lo único que no pueden es **cobrar**.

---

### 8-octies.9 El alta del creador, paso a paso (2026-08-28)

#### Qué ve cada creador

| Paso | Wallbit (12) | Stripe (77) | Mexicano |
|---|---|---|---|
| **1. Identidad** (Didit) | ✅ | ✅ | ✅ |
| **2. Declarar la cuenta** (Didit) | ✅ Datos de Wallbit | ✅ Cuenta que registrará | ✅ |
| **3. Registrar en Stripe** | ❌ | ✅ | ✅ |
| **4. Datos fiscales y sello** | ❌ | ❌ | ✅ |

El KYC es de los **89 países pagables**, sin excepción. El paso 4 aparece cuando el país del
**documento** o el de la **cuenta** dicen México; basta con que uno de los dos lo diga.

#### ⚠️ El orden del 2 y el 3 no es casual

El creador **declara su cuenta ANTES de registrarla** en Stripe, y el paso 3 está bloqueado
hasta que lo haga.

Al revés no serviría: si declarase después, se limitaría a copiar lo que acaba de escribir y
la declaración siempre coincidiría. Declarando antes se compromete sin saber todavía si va a
cuadrar, y ahí la comparación empieza a significar algo.

#### Los cuestionarios de Didit

| | Cuestionario | Workflow |
|---|---|---|
| Ruta Stripe | `a6f2475a` | `e44a6d40` |
| Ruta Wallbit | `c58dc907` | `46336699` |

Van en **sesión aparte**, no dentro del KYC. El motivo: un creador de Wallbit todavía no tiene
cuenta de Wallbit cuando hace su KYC. Pedírsela ahí sería pedirle algo que no tiene —se
saldría a abrirla y la sesión ya habría pasado—. Con sesión propia la abre cuando quiere, y si
cambia de cuenta repite solo ese paso en vez de rehacer su verificación entera.

Los workflows llevan **solo el cuestionario**, sin OCR ni biometría: el creador ya está
identificado y repetirlo costaría dinero por nada.

⚠️ **El webhook de Didit tiene que distinguirlos.** Los tres workflows llegan por el mismo
endpoint. Sin el desvío de `esSesionDeCuentaDeCobro`, terminar un cuestionario marcaría la
identidad del creador como aprobada o rechazada según una sesión que no verificó a nadie.

#### 🚨 Qué se guarda de la cuenta bancaria

**La cuenta completa NO se guarda en Firestore.** Vive en Didit, igual que el sello del SAT
vive en Facturapi. En el perfil solo quedan:

| Campo | Qué es |
|---|---|
| `declaredAccountLast4` | Los últimos 4 dígitos que declaró |
| `declaredHolderName` | El titular que declaró |
| `stripeAccountLast4` | Los últimos 4 que reporta Stripe |
| `declaredAccountMatchesStripe` | Si coinciden. `undefined` mientras falte una mitad |

#### Lo que la comparación SÍ y NO prueba

Stripe **no comprueba que la cuenta sea del creador en ningún país salvo el Reino Unido**,
donde el *Confirmation of Payee* es obligatorio. En México y el resto acepta cualquier cuenta
válida, y tampoco devuelve el nombre del titular — solo los últimos 4 dígitos.

| | |
|---|---|
| ✅ Detecta | Que registró una cuenta distinta a la que declaró, o un error de tecleo |
| ❌ No detecta | Que la cuenta sea de otra persona. Quien declare la misma cuenta ajena en los dos sitios pasa |

Lo que sí queda es una **declaración formal de titularidad** hecha por alguien con identidad
verificada. No previene el fraude, lo hace atribuible — que en el modelo de intermediación,
donde se paga «por cuenta del creador», es justo lo que hace falta poder demostrar.

🔁 **La verificación de verdad es Financial Connections**: el creador entra a su banca en línea
y Stripe lee la cuenta, así que la titularidad queda probada por construcción. Está en vista
previa (`financial_connections_payouts_preview`) y se pide por correo.

#### 🌎 Qué país decide qué

Documento de un país y cuenta de otro **es un caso normal**, no un problema. Lo que cambia es
quién decide cada cosa:

| Decisión | La toma | Por qué |
|---|---|---|
| Comisión, mínimo y ruta | **La cuenta**, con el documento de respaldo | Es a donde viaja el dinero, y es lo único que explica el coste |
| Si se le piden datos fiscales y sello | **Cualquiera de los dos** | Quien debe facturar en México es quien tributa ahí |
| Retención de IVA del creador mexicano | **La cuenta, a secas** | Depende de dónde cobra de verdad, no de dónde es |

La primera regla vive en **una sola función**, `paisDeCobroDe` en `wallet/payoutTiers.ts`, que
usan el ledger —que congela la comisión— y la interfaz —que la muestra—. Tenerla escrita dos
veces es exactamente cómo se llega a que el creador vea una cifra y cobre otra; hay un test de
paridad que compara las dos implementaciones.

⚠️ El documento hace de respaldo porque un creador de ruta **Wallbit nunca da de alta cuenta
en Stripe**, así que `payoutAccountCountry` se queda vacío para siempre. Sin respaldo caía al
caso provisional y su país real no decidía nada. Hoy coincidiría por accidente —Wallbit
también es 25%— pero el día que tuviera otro tramo, fallaría en silencio.

#### 💰 La retención de IVA del 50% al 100% — YA PROGRAMADA

En `tax/fiscalEngine.ts`:

```ts
const cobraFuera = !!c.payoutAccountCountry && c.payoutAccountCountry.toUpperCase() !== "MX";
ivaRate = !c.hasTaxId || cobraFuera ? t.ivaMxSinRfc : t.ivaMxConRfc;
```

Con `ivaMxConRfc: 0.5` y `ivaMxSinRfc: 1`. A un creador mexicano que cobra fuera de México se
le retiene el **100%** del IVA en vez del 50%. Ver `fiscal-iva-isr-plataforma.md` §0.6.

⚠️ Aquí se usa `payoutAccountCountry` **a secas, sin el respaldo del documento**, y es a
propósito: para lo fiscal importa dónde cobra de verdad. Sin cuenta dada de alta el campo va
vacío y se retiene el 50%, que es la suposición benigna —retiene de menos, no de más—.

#### Cuatro fallos encontrados al probar el flujo, y arreglados

| | Qué pasaba |
|---|---|
| **URL de la v2** | `stripeClient` tenía la base fija en `/v1` y las rutas v2 quedaban en `/v1/v2/core/accounts`. Stripe devolvía «Unrecognized request URL» |
| **Falta el país** | Stripe exige `identity.country` antes de configurar nada. Ahora sale del documento del KYC |
| **País del KYC nunca guardado** | El extractor buscaba `id_verification` en singular y la API devuelve `id_verifications`, plural y como array. El KYC quedaba aprobado **sin país**, en silencio, y el alta pedía «verifica tu identidad» a quien ya la tenía verificada |
| **Cabecera de la v2** | Se mandaba `Stripe-Account`, que la v2 ignora sin quejarse: la lista de métodos de pago volvía con los datos de la plataforma, no los del creador. La v2 usa `Stripe-Context` |

La tabla de conversión de códigos ISO-3 a ISO-2 cubría **14 países**; ahora cubre los 147. Un
creador japonés o filipino habría tenido el mismo problema aunque el extractor funcionara.

`resolverPaisDocumento` **se cura sola**: si el país falta pero el KYC está aprobado, se lo
pregunta a Didit y lo guarda. Así los creadores verificados antes del arreglo —y los aprobados
por revisión manual, donde el evento puede llegar sin los datos del documento— se reparan solos
sin backfill.

#### Lo que queda abierto

| | |
|---|---|
| Verificación de empresa en Stripe | 🔴 Bloquea el paso a producción |
| `financial_connections_payouts_preview` | ⬜ Es lo que probaría la titularidad de verdad |
| Confirmar con Wallbit que se puede pagar a terceros | 🔴 Puede tumbar la ruta entera |
| Comisión y spread reales de Wallbit | ⬜ Sin eso, el 25% de sus 12 países es una apuesta |
| Tarjeta de débito de Wallbit | ⬜ Decide si CL, UY, PY y HN pueden usar su dinero |
| Moneda de referencia del «ganarás X» | ⬜ Debería salir del país de la cuenta, sin verificar |

---


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

✅ ~~La donación en un LIVE no tiene mínimo.~~ **CERRADO el 2026-08-21.** El mínimo se valida
ahora en el servidor y el modal recibe `minBaseAmount`. Se cerró junto con los de los otros
diez servicios: ver 8-quater.3.

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
