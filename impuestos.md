# Impuestos — base de programación por país

> Registro único de **cómo queda programado y justificado** el cobro de impuestos en cada país
> que Vibra habilita. Una ficha por país. Nada se programa sin su ficha aquí.
>
> Marco legal completo: `docs/legal/fiscal-iva-isr-plataforma.md`.
> Tabla de cobro (código): `backend/src/tax/config.ts` (autoritativa) + `lib/tax/config.ts` (espejo display).
>
> Última actualización: **2026-08-07**

---

## 1. Los cuatro conceptos de toda transacción

Todo cobro de Vibra, en cualquier país, se compone de exactamente cuatro piezas:

| # | Concepto | Naturaleza | ¿Se le muestra desglosado al comprador? |
|---|---|---|---|
| 1 | **Precio base** del creador | Ingreso (base del reparto 75/25) | No |
| 2 | **$3 MXN fijos** por transacción | Cargo de servicio de Vibra | No |
| 3 | **2% por conversión de moneda** | Costo/comisión, **NO es impuesto** | No |
| 4a | **Impuesto del país del comprador** | Impuesto | No |
| 4b | **IVA mexicano de la venta de Vibra** | Impuesto | No |

**Decisión de producto:** la pasarela muestra **un solo precio total, sin desglose**. El $3 y el 2%
van incluidos y convertidos a la moneda del comprador, sin explicación en la UI.

> ⚠️ **El desglose no se muestra, pero SIEMPRE se guarda.** Cada `paymentIntent` registra las
> cinco piezas por separado. Sin eso no se puede timbrar un CFDI, ni responder una auditoría, ni
> recalcular cuando el fiscalista cambie un criterio.
>
> **Excepción legal obligatoria:** si un comprador **mexicano** pide factura, el CFDI **debe**
> desglosar el IVA por separado. Eso es requisito de forma del CFDI, no de la UI, y no contradice
> el precio todo-incluido de la pasarela.

---

## 2. Orden de operaciones (invariable)

```
base                       # precio del creador, en MXN
+ 3 MXN                    # FIXED_SERVICE_FEE_MXN
= published                # sobre esto corre el reparto y el impuesto
+ 2% FX                    # solo si la moneda de cobro ≠ MXN
= taxableAmount            # base gravable
+ impuesto del país        # solo si collectionMode = "platform"
+ IVA mexicano             # 16% si el comprador está en MX; 0% export si está fuera
= chargedAmount            # total, en MXN canónico
→ × tipo de cambio         # solo para MOSTRAR en la moneda del comprador
```

**Por qué el 2% va ANTES del impuesto:** el cargo por conversión es parte de la contraprestación
que cobra Vibra, así que forma parte de la base gravable. No es un impuesto y nunca se declara
como tal.

**MXN es la moneda canónica.** El ledger, la wallet y el `paymentIntent` viven en MXN
(`SETTLEMENT_CURRENCY`). La moneda local es solo capa de presentación y de cobro.

---

## 3. Cómo se determina el país del comprador

### 3.1 🚨 El agujero que hay que cerrar ANTES de agregar el segundo país

Hoy el `taxCountry` **lo manda el cliente** y el backend solo lo valida con `isChargeableCountry`.
Eso funciona por accidente: como **solo México está configurado**, cualquier otro país es
rechazado y no hay evasión posible.

**El día que exista un segundo país en la tabla, ese accidente se acaba:** un comprador mexicano
manda otro ISO, pasa la validación y **paga menos IVA del que debe** —o ninguno, si ese país tiene
el impuesto a cargo de la emisora—. Vibra es quien responde ante el SAT por ese IVA no cobrado.

> **Regla dura: la determinación del país pasa a ser 100% server-authoritative antes de habilitar
> el segundo país. No es opcional ni se puede dejar para después.**

### 3.2 Base legal — Art. 18-C LIVA (los 4 indicios)

El receptor de un servicio digital se considera **en territorio nacional** cuando:

| # | Indicio | De dónde se obtiene |
|---|---|---|
| 1 | Domicilio manifestado en territorio nacional | Dirección de facturación (Stripe) |
| 2 | Pago mediante intermediario en territorio nacional | **País emisor de la tarjeta (BIN)**, vía Stripe |
| 3 | IP en el rango asignado a México | IP del request, **leída en el servidor** |
| 4 | Teléfono con código de país de México | Teléfono del perfil |

### 3.3 Regla de decisión

La norma está redactada de forma **conservadora hacia México**, y la implementación la respeta:

1. **Si CUALQUIER indicio apunta a México → el comprador es mexicano.** Se cobra 16%. Sin
   excepciones. Es la lectura segura del 18-C y elimina el incentivo a falsear la ubicación.
2. **Solo si NINGÚN indicio apunta a México** se evalúa el país extranjero.
3. Entre indicios extranjeros en conflicto, **gana el país emisor de la tarjeta** — es el más
   difícil de falsificar y es el que la propia autoridad puede corroborar.
4. Si el país resultante **no tiene ficha en este documento** → se rechaza el cobro.
5. **Los 4 indicios se guardan siempre** en el `paymentIntent`, aunque coincidan. Son la evidencia
   ante una auditoría.

### 3.4 El problema de los dos momentos

El país de la tarjeta **solo se conoce al pagar**, pero el precio se muestra **antes**. Por eso hay
dos fases y no una:

| Fase | Qué se usa | Naturaleza |
|---|---|---|
| **Fase 1 — display** (catálogo, botón, apertura de pasarela) | IP del request en servidor | **Estimado.** Nunca autoritativo |
| **Fase 2 — cobro** (al capturar la tarjeta, antes de confirmar) | IP + **país emisor de la tarjeta** | **Autoritativo.** Es el que manda |

**Implementación:** `repriceStripeIntentForCard` (`backend/src/payments/stripe/repriceForCard.ts`).
Lee el BIN de la tarjeta vía Stripe, vuelve a resolver el país, recompone el cobro y —si el total
cambió— **actualiza el monto del PaymentIntent en Stripe antes de confirmar**. Stripe permite
cambiar `amount` mientras el intent siga en `requires_payment_method` / `requires_confirmation`.

**El monto en pantalla simplemente se actualiza.** No hay modal ni aviso de "tu total cambió": el
comprador ve el total vigente antes de pulsar pagar. Decisión de producto (2026-08-07).

**Ejemplo — IP extranjera + tarjeta mexicana**, sobre una base de 100:

| | Fase 1 (por IP → extranjero) | Fase 2 (por tarjeta → MX) |
|---|---|---|
| base + $3 | 103 | 103 |
| 2% conversión | +2.06 | **0** — ya no hay conversión |
| Impuesto cobrado por Vibra | según el país | **+16.48** — IVA mexicano |
| **Total** | estimado | **119.48** |

Queda rastro en el intent: `repricedFromAmount`, `repricedAt`, `taxCountrySource` y los 4 indicios.

---

## 4. Modelo de datos

### 4.1 Configuración por país

```ts
/** Quién recauda materialmente el impuesto del país del comprador. */
type TaxCollectionMode =
  | "platform"   // Vibra lo cobra en el checkout y lo entera (MX)
  | "issuer"     // lo percibe la emisora/banco del comprador (Vibra NO lo cobra)
  | "none";      // sin régimen aplicable → país NO cobrable

/** Régimen del IVA MEXICANO sobre la venta de Vibra (Vibra es residente en MX). */
type MxVatTreatment =
  | "domestic_16"     // comprador en México
  | "export_zero"     // comprador fuera → 0% por exportación (Art. 29-IV)
  | "export_taxable"; // comprador fuera pero el servicio NO encuadra → 16% al margen

type CountryTaxConfig = {
  taxName: string;            // "IVA", "IGV", "ITBIS", "ITBMS", "ISV"…
  taxRate: number;            // se guarda SIEMPRE, aunque no se cobre
  currency: string;           // moneda local de cobro
  collectionMode: TaxCollectionMode;
  mxVatTreatment: MxVatTreatment;
};
```

**Por qué `taxRate` se guarda aunque no se cobre:** en los países donde el impuesto lo percibe la
emisora, sirve para poder advertirle al comprador qué le va a sumar su banco, y para reconstruir
la operación si el criterio cambia.

**Por qué `mxVatTreatment` es un campo y no una constante:** hoy es `export_zero` en todos los
países extranjeros. Si el fiscalista dictamina que algún servicio o país no encuadra en el
Art. 29-IV, se cambia **una línea** y los 8 intents lo heredan. Ver **D-08**.

### 4.2 Registro por transacción (`paymentIntents`)

```ts
{
  // Determinación del país — evidencia Art. 18-C
  buyerCountry: "XX",              // ISO del país resuelto por el servidor
  buyerCountrySource: "card_bin",           // card_bin | ip | billing_address | phone
  buyerCountryIndicios: {
    billingAddress: "XX" | null,
    cardCountry:    "XX" | null,
    ipCountry:      "XX" | null,
    phoneCountry:   "XX" | null,
  },

  // Composición del precio (todo en MXN canónico)
  baseAmount:        100.00,
  fixedFee:            3.00,
  publishedAmount:   103.00,
  fxFeeRate:          0.02,
  fxFeeAmount:         2.06,
  taxableAmount:     105.06,

  // Impuesto del país del comprador
  buyerTax: {
    name: "IVA", rate: 0.21, amount: 0,
    collectionMode: "issuer",
    note: "Lo percibe la emisora del comprador. Vibra no lo cobra ni lo entera.",
  },

  // IVA mexicano de la venta de Vibra
  mxVat: { treatment: "export_zero", rate: 0, amount: 0, article: "29-IV" },

  chargedAmount:     105.06,   // MXN
  settlementCurrency: "MXN",
  displayCurrency:   "XXX",           // moneda local del comprador
  fxRate:            <tipo de cambio del día>,
}
```

**Importes inmutables:** el `paymentIntent` congela tasa de impuesto y tipo de cambio. Nunca se
reconstruye un histórico con la config vigente.

---

## 5. Reglas invariables

1. **Nunca cobrar un impuesto que ya recauda un tercero.** Si `collectionMode = "issuer"`, el
   checkout suma **cero**. Cobrarlo sería doble imposición al comprador.
2. **Nunca confiar en el cliente** para el país fiscal. Server-authoritative siempre.
3. **Cualquier indicio hacia México gana.** Ante la duda, 16%.
4. **Nunca colapsar los dos impuestos en un solo campo**, aunque los dos den cero. Son
   independientes y se mueven por separado.
5. **País sin ficha en este documento → no cobrable.**
6. **El 2% de FX no es impuesto.** No se declara, no se entera, no se llama impuesto en ningún lado.
7. **Advertencia obligatoria** en países `issuer`: el checkout debe avisar qué sumará el banco.
   Sin eso, el sobresalto llega en el resumen de tarjeta y se convierte en contracargo.

---

## 6. Fichas por país

### 🇲🇽 México — `MX` · ✅ EN PRODUCCIÓN

| Campo | Valor |
|---|---|
| Impuesto | IVA **16%** |
| Moneda de cobro | MXN |
| `collectionMode` | `platform` — Vibra cobra y entera |
| `mxVatTreatment` | `domestic_16` |

#### 📋 Qué se necesita para vender aquí

| Requisito | ¿Aplica? |
|---|---|
| **Alta fiscal en el país** | ✅ Ya — Vibra es contribuyente mexicano (es su residencia) |
| **Representante legal local** | No aplica |
| **Declarar y enterar el impuesto** | **Sí — Vibra.** A más tardar el día 17 del mes siguiente |
| **Facturación electrónica local** | **Sí.** CFDI con IVA desglosado si el comprador la pide; si no, factura global mensual |
| **Umbral mínimo de ventas** | Ninguno |

**Cobro:** `(base + 3) × 1.16`. Sin 2% de FX (moneda = moneda de liquidación).

**Justificación:** operación doméstica. Vibra es residente en México (Art. 16 LIVA) y vende a un
comprador en territorio nacional. Causa IVA al 16%, que Vibra traslada, cobra y entera.

**Facturación:** si el comprador pide factura, CFDI con IVA desglosado. Si no, comprobante de pago
no fiscal + factura global mensual.

---

### 🇪🇺 Unión Europea — los 27 · ✅ ACTIVOS (2026-08-08)

| Campo | Valor |
|---|---|
| Impuesto | IVA del país del comprador (17% LU → 27% HU) |
| Moneda de cobro | La local: EUR, y CZK · DKK · HUF · PLN · RON · SEK |
| `collectionMode` | `platform` — Vibra cobra y entera |
| `mxVatTreatment` | `export_zero` |

**Un solo registro cubre los 27: el Non-Union OSS.** Alta en línea en un país a elegir,
declaración trimestral, sin representante fiscal. El número tiene formato `EUxxxyyyyyz`.

**Cobro:** `(base + 3) × 1.02 × (1 + tasa del país)`.

**Umbral:** ninguno para un proveedor de fuera de la UE. Se cobra desde el primer euro. (El
umbral de €10.000 es para vendedores *dentro* de la UE; no aplica.)

**Interruptor:** `EU_OSS_REGISTERED` en los dos espejos de `config.ts`. En `false` los 27 pasan
a `cannot_sell` de golpe.

> ⚠️ **Pendiente antes de llaves `sk_live`:** el número de OSS. Hoy los 27 están encendidos para
> **probar con Stripe en modo prueba**, que es donde no hay dinero real ni obligación fiscal.

---

### 💳 Recauda la EMISORA — 🇦🇷 AR · 🇨🇷 CR · 🇪🇨 EC · 🇵🇾 PY · 🇩🇴 DO · ✅ ACTIVOS

| País | Impuesto | Moneda |
|---|---|---|
| 🇦🇷 Argentina | IVA 21% | ARS |
| 🇨🇷 Costa Rica | IVA 13% | CRC |
| 🇪🇨 Ecuador | IVA 15% | USD |
| 🇵🇾 Paraguay | IVA 10% | PYG |
| 🇩🇴 Rep. Dominicana | ITBIS 18% | DOP |

`collectionMode: "issuer"` · `registrationStatus: "not_registered"` · `mxVatTreatment: "export_zero"`

**Cobro:** `(base + 3) × 1.02`. **Cero impuesto en el checkout.**

**Justificación:** en los cinco, el emisor de la tarjeta (o el intermediario de pago) percibe el
impuesto por cuenta del fisco cuando el proveedor extranjero no está registrado. El comprador lo
ve en su resumen de tarjeta, no en la pasarela. Si Vibra también lo sumara, **lo pagaría dos veces**.

En CR y EC el registro voluntario existe y desactivaría la percepción bancaria; Vibra no lo hace,
así que la retención sigue vigente y el checkout suma cero.

---

### ⬜ Sin régimen digital — 🇧🇴 BO · 🇸🇻 SV · 🇬🇹 GT · 🇭🇳 HN · 🇳🇮 NI · 🇵🇦 PA · ✅ ACTIVOS (2026-08-08)

| País | Impuesto (referencia) | Moneda |
|---|---|---|
| 🇧🇴 Bolivia | IVA 13% | BOB |
| 🇸🇻 El Salvador | IVA 13% | USD |
| 🇬🇹 Guatemala | IVA 12% | GTQ |
| 🇭🇳 Honduras | ISV 15% | HNL |
| 🇳🇮 Nicaragua | IVA 15% | NIO |
| 🇵🇦 Panamá | ITBMS 7% | USD |

`collectionMode: "none"` · `registrationStatus: "not_registered"` · `mxVatTreatment: "export_zero"`

**Cobro:** `(base + 3) × 1.02`. **Cero impuesto en el checkout.**

#### 📋 Qué se necesita para vender aquí

| Requisito | ¿Aplica? |
|---|---|
| **Alta fiscal en el país** | ❌ No existe régimen para proveedores extranjeros — no hay dónde |
| **Representante legal local** | No aplica |
| **Declarar y enterar el impuesto** | ❌ No. Vibra no es contribuyente ahí |
| **Facturación electrónica local** | ❌ No |
| **Umbral mínimo de ventas** | No aplica (no hay régimen que tenga umbral) |

**Justificación:** ninguno de los cinco ha legislado un régimen que obligue a un proveedor
extranjero de servicios digitales a registrarse y cobrar. No hay dónde darse de alta ni qué
enterar, así que el checkout suma cero y se vende con normalidad.

**Diferencia con el bloque de arriba:** allá el impuesto **sí se recauda** (lo hace el banco del
comprador); aquí **no lo recauda nadie** por esta venta. Por eso el modo es `"none"` y no
`"issuer"`. El resultado del cobro es el mismo; la razón no.

**¿Y el impuesto del comprador?** Puede existir como *importación de servicios* a cargo del propio
comprador (autodeterminación / reverse charge), igual que Vibra se autodetermina el IVA de
importación al pagarle a un creador extranjero. Pero ahí el contribuyente es él, no Vibra: para el
cobro es indiferente.

> ⚠️ **VIGILAR A MANO.** Son los rezagados de LatAm: Colombia (2018), Chile (2020), Ecuador (2020),
> Paraguay (2021) y Perú (2024) ya adoptaron su régimen; Bolivia tuvo un proyecto en 2024 que no
> prosperó. **Stripe Tax no cubre ninguno de los cinco**, así que su monitoreo no avisará si
> cambian. Fuentes: despachos regionales, no autoridades fiscales.

---

#### 🇵🇦 Panamá — investigación profunda (2026-08-08)

Panamá entra en este bloque, pero llegó por un camino distinto a los otros cinco y conviene
dejarlo escrito, porque el mecanismo que sí existe ahí se parece mucho al de Argentina y es
fácil confundirlos.

**1. El régimen para plataformas extranjeras nunca se aprobó.** El *Anteproyecto de Ley 229 de
2019* — "Ley de Regulación Fiscal y Laboral para las Empresas que Operan a través de Plataformas
Digitales" — habría obligado a Google, Netflix, Spotify, Airbnb, Uber "y cualquier comercio que
facture mediante tarjeta de crédito en Panamá" a tributar ITBMS. **No pasó del pleno.** El
director de la DGI declaró en agosto de 2023 que el proyecto estaba "nuevamente en evaluación",
y ahí sigue. No hay registro que hacer ni número que obtener.

**2. La retención que SÍ existe la practica el comprador, no el banco.** El Decreto Ejecutivo 84
de 2005 (modificado por el 128 de 2017) designa agente de retención a *quien pague servicios
gravados a personas o entidades no domiciliadas en Panamá sin sucursal ni establecimiento
permanente*, y la retención es del **100% del ITBMS**.

> 🚨 **Esto NO es el modelo argentino.** En Argentina el agente de percepción es el **emisor de
> la tarjeta**: le suma el 21% al consumidor automáticamente, sin que él haga nada. En Panamá el
> agente es **quien paga la factura** — es decir, una empresa panameña comprándole a Vibra, que
> retiene y entera por su cuenta. Un consumidor final con tarjeta no retiene nada: no es agente
> designado y no tiene declaración de ITBMS que presentar.
>
> Vibra vende B2C. **Nadie recauda.** Por eso `collectionMode: "none"` y no `"issuer"`.

**3. Stripe Tax no cubre Panamá.** No aparece en `docs.stripe.com/tax/supported-countries`, ni
como *business location* ni como *customer location*. De LatAm solo cubre 7: MX · CL · CO · CR ·
EC · PE · UY. Confirma que no hay obligación que automatizar, y confirma también que **el
monitoreo de Stripe no va a avisar** si Panamá cambia.

**4. Territorialidad.** El ITBMS del Art. 1057-V del Código Fiscal grava las operaciones "que se
realicen en la República de Panamá" — es un impuesto de territorialidad estricta, la misma
doctrina que rige todo el sistema tributario panameño. La regla de retención existe justamente
porque la DGI considera gravables ciertos servicios transfronterizos aprovechados en Panamá; pero
la obligación recae en el pagador local, nunca en el proveedor extranjero.

**Conclusión:** `(base + 3) × 1.02`, cero impuesto, se vende hoy. La moneda de curso legal es el
dólar (el balboa está a la par y casi no circula), así que se cobra en **USD** — no hace falta
conversión de catálogo.

> ⚠️ **Es el más probable de moverse de los seis que faltaban.** Lleva siete años de anteproyecto
> vivo y la DGI lo reabrió. Vigilancia manual: `D-10`.

---

### ⬜ Los que faltan — se abrirán con Stripe Tax

**Decisión (2026-08-07): la habilitación por país NO se hace con investigación manual improvisada.**

Se intentó con Argentina y se revirtió el mismo día. El problema no fue el resultado sino el
método: las tasas y los mecanismos de LatAm cambian rápido, las fuentes secundarias se
contradicen, y algunos datos se colaron sin respaldo oficial (por ejemplo, un "el banco le suma
~51%" que salía de sumar 21% + 30% sin verificar que el 30% aplica solo a consumos en moneda
extranjera — y Stripe cobra en la moneda local del comprador).

**Stripe Tax informa por país, al pasar a dinero real, qué registro, umbral y obligaciones
aplican.** Ese es el dato bueno. Cada país nuevo se abre así:

1. Stripe Tax indica el requisito del país.
2. Se llena la ficha de este documento con **la plantilla de §8**.
3. Se agrega la fila a `COUNTRY_TAX_CONFIG` (los dos espejos).
4. Se escriben los tests de ese país.

Hasta entonces, un país sin fila **no es cobrable** y el checkout lo rechaza.

**Quedan 5 de LatAm**, todos con el mismo bloqueo — **exigen alta previa a la primera venta**:

| País | Impuesto | Qué falta |
|---|---|---|
| 🇨🇱 Chile | IVA 19% | Registro simplificado ante el SII |
| 🇨🇴 Colombia | IVA 19% | RUT + declaración bimestral ante la DIAN |
| 🇵🇪 Perú | IGV 18% | Registro ante SUNAT (régimen de 2024) |
| 🇺🇾 Uruguay | IVA 22% | Registro ante la DGI |
| 🇧🇷 Brasil | ISS/IBS variable | Municipal + reforma tributaria en curso |

---

## 6.2 Los 5 que faltan — quién recauda y quién declara (2026-08-08)

Tabla de decisión para el orden de integración. La columna que importa no es la tasa: es **quién
declara**, porque eso es lo que se convierte en trabajo recurrente para siempre.

| País | Tasa | Alta previa | Quién recauda | Quién declara | Periodicidad |
|---|---|---|---|---|---|
| 🇨🇴 Colombia | IVA 19% | **RUT** + firma electrónica | **A elección:** Vibra, o los emisores de tarjeta | **A elección:** Vibra, o **nadie** | Bimestral — o ninguna |
| 🇨🇱 Chile | IVA 19% | Régimen simplificado (SII) | Vibra | **Vibra** (F129, en USD/EUR) | Mensual o trimestral |
| 🇵🇪 Perú | IGV 18% | **RUC** (sin domicilio ni EP) | Vibra, como agente de percepción | **Vibra** | Mensual |
| 🇺🇾 Uruguay | IVA 22% **+ IRNR 12%** | Registro DGI (régimen de no residentes) | Por confirmar | Por confirmar | Por confirmar |
| 🇧🇷 Brasil | ISS 2–5% → IBS/CBS | Municipal | Por confirmar | Por confirmar | Por confirmar |

### 🇨🇴 Colombia — el más barato de operar, y por mucho

**Resolución DIAN 000049 del 1 de agosto de 2019.** Un prestador del exterior elige entre dos
caminos, y la elección es permanente hasta que la cambie:

* **(a) Declaración bimestral.** Vibra cobra el IVA, lo declara y lo paga cada dos meses.
* **(b) Sistema alternativo de retención en la fuente.** Los emisores de tarjetas de crédito y
  débito, los vendedores de tarjetas prepago y los recaudadores de efectivo practican la
  retención. **Quien se acoge NO está obligado a presentar declaración de IVA.**

**El alta en el RUT + firma electrónica se necesita en los dos casos.** Lo que cambia es que la
opción (b) elimina la obligación periódica: un trámite una vez y nunca más una declaración.

> 🚨 **PREGUNTA ABIERTA — vale 19% de cada venta colombiana.** En la opción (b) la retención es
> *en la fuente*, no una percepción al consumidor como en Argentina. Hay que confirmar si el 19%
> **se le suma al comprador** (y Vibra recibe su base íntegra) o si **se descuenta de lo que Vibra
> cobra** (y entonces hay que subir el precio 19% para quedar igual). Los dos mecanismos se
> escriben parecido en la norma y significan cosas opuestas para el ingreso del creador.
>
> No integrar Colombia hasta resolver esto. Se resuelve con el fiscalista o con una prueba real.

**Nota de modelo de datos:** la opción (b) sería `collectionMode: "issuer"` + `registrationStatus:
"registered"` — una combinación que hoy no existe en la tabla pero que `applyConsumptionTax` ya
maneja bien (solo cobra con `platform` **y** `registered`, así que sumaría cero). No hace falta
tocar el motor.

### 🇨🇱 Chile — Vibra declara, pero paga en dólares

**Ley 21.210**, régimen simplificado vigente desde el **1 de junio de 2020**. Inscripción
obligatoria en la lista pública de contribuyentes extranjeros del SII. Vibra declara y paga con el
**Formulario 129**, mensual o trimestral, **en USD o EUR** — no hay que convertir a pesos chilenos
para enterar. Sin umbral mínimo.

**Ley 21.713**, vigente desde el **24 de octubre de 2025**, agregó una presunción de
territorialidad: se considera chileno al comprador que cumpla **dos de cuatro** criterios (IP,
medio de pago chileno, domicilio, SIM chilena). Es la misma lógica de dos pruebas del Art. 24b de
la UE, así que `resolveCountry.ts` ya la satisface sin cambios.

> ⚠️ Fuentes secundarias mencionan que Transbank retendría el 19% automáticamente a proveedores no
> inscritos. **El portal del SII no lo confirma.** No contar con eso como vía para vender sin alta.

### 🇵🇪 Perú — hay respaldo bancario, pero es la lista de morosos

**D. Leg. 1623**, publicado el **4 de agosto de 2024**; retención y percepción efectivas desde el
**1 de diciembre de 2024** (postergadas por el D. Leg. 1644). Reglamento: **D.S. 157-2024-EF**.

Vibra debe inscribirse en el **RUC** — y explícitamente *no* se requiere domicilio en el país ni
representante legal domiciliado, ni la inscripción constituye establecimiento permanente. Vibra
queda como **agente de percepción**: cobra el 18% y lo entera mensualmente.

> 🚨 **El respaldo bancario existe pero NO es una vía limpia.** Si Vibra no se inscribe, la SUNAT
> la publica por Decreto Supremo en un **listado de sujetos no domiciliados incumplidos**, le
> quita la condición de agente, y la responsabilidad pasa a los facilitadores de pago (los
> emisores de tarjeta). Es decir: sí, el comprador termina pagando su IGV igual — pero Vibra
> aparece en una lista pública de morosos fiscales y arrastra intereses y multas para salir.
>
> **No es el modelo argentino.** En Argentina no estás incumpliendo nada; aquí sí.

### 🇺🇾 Uruguay — el único con DOS impuestos

**Ley 19.535 (2018)** + Decreto 220/998 art. 26 bis. Régimen especial exclusivo para no
residentes, confirmado por la DGI.

> 🚨 **IVA 22% NO es el costo total.** Para servicios de suscripción B2C tipo Netflix/Spotify, la
> normativa los considera **100% de fuente uruguaya**, lo que agrega **IRNR del 12%** encima del
> IVA. Es el único de los cinco con una segunda capa de impuesto, y cambia por completo su
> atractivo comercial.

Pendiente de confirmar: quién practica la retención y con qué periodicidad se declara. Las fuentes
que encontré no lo resuelven y no vale la pena adivinarlo.

### 🇧🇷 Brasil — dejarlo para el final

ISS municipal (2–5% según la ciudad) migrando a IBS/CBS por la reforma tributaria. La CBS arranca
en 2027 y el IBS se escalona entre 2029 y 2032, con 2026 como año de prueba. Stripe Tax **no cubre
Brasil**. Requiere asesoría local, no investigación remota.

### Orden de integración sugerido

1. **Colombia** — resolver primero la pregunta abierta del 19%. Si se le suma al comprador, es el
   más barato de todos: un trámite y cero declaraciones para siempre.
2. **Chile** — el más predecible. Alta clara, formulario claro, pago en dólares.
3. **Perú** — igual de claro que Chile pero con declaración mensual.
4. **Uruguay** — solo si el 22% + 12% deja margen. Confirmar antes de invertir en el alta.
5. **Brasil** — con asesor local, no antes.

---

## 6.1 Mapa de expansión — datos de la doc pública de Stripe (2026-08-07)

> Recogido de `docs.stripe.com/tax/supported-countries`. Es **documentación abierta**: no hace
> falta cuenta ni activar Stripe Tax para consultarla.
>
> ⚠️ **Stripe NO publica la TASA en su documentación.** Publica el umbral, la autoridad y las
> reglas de alta. El porcentaje vive dentro del producto — es justamente lo que cobra por
> calcular. Para programar el cálculo por cuenta propia, la tasa hay que conseguirla aparte.

### 🌎 Latinoamérica — la región MÁS difícil

**Ninguno tiene umbral: el alta es obligatoria desde la primera venta.** No existe el "vendo
hasta cruzar el umbral y luego me registro". Y hay que registrarse **país por país**.

| País | Umbral | Alta | Producto | ¿Negocio ahí? | Autoridad |
|---|---|---|---|---|---|
| 🇲🇽 **México** | 1 transacción | **Obligatoria** (30 días desde la 1ª venta) | Todos | ✅ Sí | [SAT](https://www.sat.gob.mx/portal/public/home) |
| 🇨🇱 Chile | 1 transacción | **Obligatoria** | Solo digital | ❌ | [SII](https://www.sii.cl/vat/) |
| 🇨🇴 Colombia | 1 transacción | **Obligatoria** | Solo digital | ❌ | [DIAN](https://www.dian.gov.co/) |
| 🇵🇪 Perú | 1 transacción | **Obligatoria** | Solo digital | ❌ | [SUNAT](https://orientacion.sunat.gob.pe/igv-servicios-digitales) |
| 🇺🇾 Uruguay | 1 transacción | **Obligatoria** | Solo digital | ❌ | [DGI](https://www.gub.uy/direccion-general-impositiva/) |
| 🇨🇷 Costa Rica | — | **Voluntaria** | Solo digital | ❌ | [Hacienda](https://www.hacienda.go.cr/) |
| 🇪🇨 Ecuador | — | **Voluntaria** | Solo digital | ❌ | [SRI](https://www.sri.gob.ec/) |
| 🇦🇼 Aruba · 🇧🇸 Bahamas · 🇧🇧 Barbados · 🇸🇷 Surinam | — | sin detalle | Solo digital | ❌ | — |

**Notas clave:**
- Solo en **México** Vibra puede tener el negocio basado ahí y vender **todos** los tipos de producto. En el resto solo aplica como *remote seller* y solo productos digitales.
- En Chile, Colombia, Perú y Uruguay las ventas **B2B no generan obligación** de registro.
- Costa Rica y Ecuador son las únicas dos donde registrarse es **opcional**.

### 🚫 De la lista original de 17, Stripe Tax NO cubre 10

**Argentina · Brasil · Bolivia · Paraguay · Guatemala · Honduras · Nicaragua · El Salvador ·
Panamá · República Dominicana.**

Para estos países Stripe no da nada: ni monitoreo, ni tasa, ni ayuda con el alta. Abrirlos exige
fiscalista, o no abrirlos.

### 🇪🇺 Unión Europea — la región MÁS fácil

Aquí está el hallazgo que cambia la prioridad de expansión:

| Concepto | Regla |
|---|---|
| Umbral para negocio **fuera** de la UE | Registro **desde la primera venta** |
| **Non-Union OSS** | **UN SOLO registro cubre los 27 países** |
| Representante fiscal | **No hace falta** con el esquema Non-Union OSS |
| Declaración | **Una sola** al país donde te registraste |
| Umbral de €10,000 ("small seller") | Solo para negocios **basados en la UE** — a Vibra no le aplica |

> *"This scheme is for businesses based outside the EU selling services to individuals in the EU.
> You can choose which EU country you register in… **You don't need to appoint a tax
> representative** to use the OSS non-Union scheme."*

**Un trámite abre 27 países.** En LatAm, siete trámites abren siete.

### 🇺🇸 Estados Unidos

| Concepto | Regla |
|---|---|
| Nivel | **Por estado** — cada uno define su propio nexo económico |
| Umbral | Varía por estado; hay que consultar la ficha de cada uno |
| Registro | Individual en cada estado. **Stripe puede registrarte** |
| SSUTA | 24 estados con registro unificado en [streamlinedsalestax.org](https://www.streamlinedsalestax.org/) |
| Marketplace facilitator | Vigente en **todos** los estados con impuesto + DC |
| Venta desde el extranjero | Si no tienes registro en ese estado, Stripe trata la venta transfronteriza de bienes como exportación a tasa cero |

⚠️ **Las leyes de marketplace facilitator aplican a Vibra.** Como plataforma que fija términos,
procesa pagos y entrega el producto, en USA la obligación de cobrar y enterar recaería sobre
Vibra, no sobre el creador. Es un análisis aparte y pesado.

### 🇨🇦 Canadá

Sistema federal (GST/HST) + provincial (QST, PST, RST), con reglas distintas por provincia.
Negocio basado en Canadá: soportado. Todos los tipos de producto.
Los umbrales por provincia están en la ficha de cada una — **pendiente de recoger**.

### 🌍 Resto del mundo — nivel índice

Stripe Tax cubre además **Asia-Pacífico, África y Europa fuera de la UE**. De estas regiones solo
se recogió el índice (país + tipo de impuesto + si soporta negocio/cliente), no el detalle de
umbral y alta. Se recogerá cuando alguna entre en el plan.

### 🌏 Países CON umbral real — se puede vender antes de darse de alta

Datos de la doc de Stripe (2026-08-07). Aquí sí funciona la estrategia de abrir el país,
vender, y registrarse cuando el volumen lo justifique.

| País | Umbral | Impuesto | Requisito extra |
|---|---|---|---|
| 🇦🇺 **Australia** | **75,000 AUD** en 12 meses (pasados o próximos) | GST | — |
| 🇳🇿 **Nueva Zelanda** | **60,000 NZD** en 12 meses | GST | — |
| 🇨🇦 **Canadá** | **30,000 CAD** en 12 meses móviles | GST/HST | Quebec va aparte, mismo monto |
| 🇸🇬 Singapur | **100,000 SGD** B2C **Y** 1M SGD global | GST | Deben cumplirse **las dos** |
| 🇯🇵 Japón | **10M JPY** en el periodo base | Consumption Tax | ⚠️ **Representante fiscal en Japón** |
| 🇳🇴 Noruega | **50,000 NOK** en 12 meses | IVA | Representante, salvo esquema simplificado **VOEC** |
| 🇿🇦 Sudáfrica | **200,000 ZAR** en 12 meses | IVA | ⚠️ **Representante fiscal** |
| 🇨🇭 Suiza / Liechtenstein | **100,000 CHF** ⚠️ **de facturación MUNDIAL** | IVA | ⚠️ Representante **+ garantía bancaria** |
| 🇺🇸 Estados Unidos | $100k (41 estados) · $250k (AL, MS) · $500k (CA, TX, NY) | Sales tax | Por estado. 18 mantienen el test de **200 transacciones** |

**Los tres limpios: Australia, Nueva Zelanda y Canadá.** Umbral real, sin representante fiscal,
mercados de alto poder adquisitivo y en inglés. Son los mejores candidatos para vender desde el
día uno sin trámite previo.

#### ⚠️ Trampas que parecen umbral y no lo son

- **Suiza:** el umbral es de **facturación mundial**, no de ventas suizas. En cuanto Vibra
  facture más de 100,000 CHF en total —en cualquier parte del mundo— hay que registrarse en Suiza
  **desde la primera venta suiza**. Se comporta como "1 transacción" para cualquier negocio real.
- **Singapur:** al revés, es genuinamente protector. Exige **las dos** condiciones, así que un
  negocio con facturación global menor a 1M SGD nunca se registra.
- **Japón:** el periodo base es el año fiscal de **hace dos años**, así que un negocio nuevo tiene
  dos años de gracia. Pero necesita representante fiscal en Japón.

### 🚫 Países SIN umbral — alta desde la primera venta

| País / región | Regla |
|---|---|
| 🇬🇧 **Reino Unido** | **1 transacción.** Registro dentro de los 30 días de la primera venta gravada |
| 🇪🇺 Unión Europea | Desde la primera venta (pero **1 solo trámite** para los 27) |
| 🇲🇽🇨🇱🇨🇴🇵🇪🇺🇾 LatAm | 1 transacción |

⚠️ **El Reino Unido no es un mercado "libre".** Es un mercado grande y en inglés, pero exige alta
antes de vender, igual que LatAm. Y **el OSS de la UE NO cubre el Reino Unido** — desde el Brexit
son dos trámites distintos.

### Conclusión de prioridad

| Prioridad | Región | Por qué |
|---|---|---|
| 1️⃣ | **Unión Europea** | Un solo registro (Non-Union OSS) abre 27 países, sin representante fiscal |
| 2️⃣ | **Costa Rica · Ecuador** | Registro voluntario: se puede vender sin darse de alta |
| 3️⃣ | **Chile · Colombia · Perú · Uruguay** | Un trámite por país, obligatorio desde la venta 1 |
| 4️⃣ | **USA · Canadá** | Umbrales reales, pero por estado/provincia + marketplace facilitator |
| ❌ | **Los 10 sin cobertura** | Requieren fiscalista; sin fuente confiable |

---

## 6.3 Europa NO comunitaria (2026-08-08)

El OSS **no cubre nada de esto**: cada país es un trámite propio. Lo que decide si se puede
encender es el umbral, no la tasa.

### ✅ ACTIVOS — con umbral, se vende sin alta

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇳🇴 Noruega | NOK | Noruego | 25% | MVA | Vibra (al cruzar) | **Trimestral** — día 20 tras el trimestre | VOEC (Skatteetaten) | NOK 50.000 / **12 meses móviles** | ✅ Activo — sin impuesto |
| 🇮🇸 Islandia | ISK | Islandés | 24% | VSK | Vibra (al cruzar) | **Bimestral** — periodos desde 1-ene, 1-mar, 1-may… | VOES (Skatturinn) | ISK 2.000.000 / año | ✅ Activo — sin impuesto |
| 🇧🇦 Bosnia y Herzegovina | BAM | Bosnio | 17% | PDV | Vibra (al cruzar) | **Mensual** — día 10 del mes siguiente | ITA / UINO (desde 2023) | BAM 50.000 / año | ✅ Activo — sin impuesto |
| 🇺🇦 Ucrania | UAH | Ucraniano | 20% | ПДВ | — | — | No residente | UAH 1.000.000 / año | 🚫 **FUERA** (D-14) |

⚠️ La columna **Declaración** es la frecuencia que aplicará **desde el día del alta**. Hoy no hay
ninguna declaración que presentar: sin registro no hay obligación. Se anota ahora porque es parte
del costo operativo real de cruzar cada umbral — Bosnia es mensual, la más pesada de las tres pese
a ser la del umbral más holgado.

Los tres integrados van con `collectionMode: "platform"` + `registrationStatus: "not_registered"`:
el régimen existe y Vibra sería quien recauda, pero sin alta el checkout suma **cero**.

> 👉 **Para encender el cobro el día que se cruce un umbral:** cambiar `registrationStatus` a
> `"registered"` en esa fila, en los **dos** espejos. Un solo campo; el motor ya hace el resto.
> Hay un test que verifica justamente eso.

**Idiomas:** noruego, islandés y bosnio **no** están en los 24 de la UE, así que esos compradores
ven la UI en inglés (fallback). No bloquea la venta. Ver [[project_eu_languages_rollout]].

### ❌ Sin umbral — alta desde la primera venta

| País | Moneda | Idioma | Tasa | Impuesto | Alta | Declaración |
|---|---|---|---|---|---|---|
| 🇬🇧 Reino Unido | GBP | Inglés | 20% | VAT | HMRC — **umbral CERO** para NETP | Trimestral |
| 🇨🇭 Suiza | CHF | Alemán/francés/italiano | 8,1% | MWST/TVA | FTA + **representante fiscal** | Trimestral |
| 🇱🇮 Liechtenstein | CHF | Alemán | 8,1% | MWST | Sistema suizo (unión aduanera) | Trimestral |
| 🇷🇸 Serbia | RSD | Serbio | 20% | PDV | Registro no residente | Por confirmar |
| 🇦🇱 Albania | ALL | Albanés | 20% | TVSH | Registro no residente | Por confirmar |
| 🇲🇪 Montenegro | EUR | Montenegrino | 21% | PDV | Registro no residente | Por confirmar |
| 🇲🇩 Moldavia | MDL | Rumano | 20% | TVA | Registro no residente | Por confirmar |
| 🇲🇰 Macedonia del Norte | MKD | Macedonio | 18% | DDV | **Representante fiscal local** solidariamente responsable | Por confirmar |
| 🇹🇷 Turquía | TRY | Turco | 20% | KDV | VAT No. 3 | Mensual |

### 🚫 No viables

🇷🇺 Rusia y 🇧🇾 Bielorrusia: sanciones. Stripe no opera.

### ⚠️ Suiza: los CHF 100.000 son de facturación MUNDIAL, no suiza

Es la confusión más cara de esta tabla. **No** es "vende hasta CHF 100k en Suiza y luego te
registras". Es: *si tu facturación global supera CHF 100.000, debes registrarte aunque vendas una
sola vez en Suiza*. Vibra está en ese rango o lo estará pronto, así que el umbral no protege nada.

Encima: exige **representante fiscal**, y basta **una sola venta B2C** para que todas las ventas
suizas — incluidas las B2B que habrían ido por reverse charge — queden gravadas. Suiza es de las
más caras de abrir de toda Europa, no de las fáciles.

### 🇬🇧 Reino Unido: el umbral de £90.000 NO aplica

Ese umbral es solo para empresas **establecidas** en UK. Para un extranjero (*Non-Established
Taxable Person*) el umbral es **cero**: alta desde la primera libra. No hay forma de probar el
mercado antes de registrarse. Es el mercado más grande de la lista y el que menos margen da.

### 🇺🇦 Ucrania — ⚠️ PAÍS EN GUERRA

Invasión rusa a gran escala desde febrero de 2022, ley marcial vigente. Tres efectos reales,
en orden de gravedad:

**1. 🚨 Territorios ocupados bajo embargo — el único riesgo serio.** Crimea, Donetsk y Lugansk
están bajo embargo integral de la OFAC, **el mismo nivel que Cuba, Irán, Corea del Norte y Siria**.
Stripe prohíbe expresamente "cualquier trato, negocio o venta de bienes/servicios vinculado
directa o indirectamente" con esas regiones.

> **El problema para Vibra:** `resolveCountry.ts` resuelve a nivel PAÍS. Devuelve `"UA"` y no
> distingue un comprador en Kiev de uno en Donetsk ocupado. Vender a Ucrania sin discriminación
> regional deja abierta una vía a territorio embargado.
>
> Mitigante: en la práctica los bancos de los territorios ocupados son rusos y sus tarjetas ya
> están bloqueadas, y Stripe hace su propio filtrado de sanciones. Pero el filtrado de Stripe no
> traslada toda la responsabilidad al procesador: el comerciante conserva la suya.

**2. Control de cambios del BNU — impacto bajo.** Bajo ley marcial, los ucranianos tienen un tope
de **UAH 100.000 al mes** (~US$2.400) para compras de bienes y servicios en el exterior. El BNU
lleva liberalizando desde 2022 (Resoluciones N.º 2 y 3 del 13-ene-2026; N.º 43 del 23-abr-2026),
y para el ticket promedio de Vibra ese tope no es una restricción práctica.

**3. La devaluación mueve el umbral.** El umbral está en hryvnias. Si la moneda se devalúa, el
mismo UAH 1.000.000 se cruza con **menos ingreso real**. La estimación de ~US$24.000 no es estable
y no sirve como referencia fija para el contador.

**La obligación fiscal es real y se cobra.** La administración tributaria ucraniana funciona y
recauda este IVA de Google, Meta y Netflix. Estar en guerra no la suspende.

**DECISIÓN (2026-08-08): Ucrania queda FUERA.** El riesgo no es que la guerra lo haga imposible —
es que la superficie de sanciones es desproporcionada frente a un ingreso marginal. Los otros tres
con umbral no tienen esta complicación.

⚠️ **No agregar `UA` a `COUNTRY_TAX_CONFIG` sin discriminación REGIONAL.** Hay un test que
verifica que siga fuera, para que nadie la agregue "por completar la lista de Europa".

### 🚨 VIGILANCIA MANUAL DEL UMBRAL — asumida a conciencia (2026-08-08)

**Un umbral no es permiso permanente: es permiso HASTA que lo cruzas.** Hoy no existe nada en el
código que cuente ventas acumuladas por país ni que avise al acercarse.

Los tres se encendieron igual, con la vigilancia **manual y explícita** a cargo de Luis. Al cruzar
un umbral nace la obligación de registrarse y de empezar a cobrar; nadie va a avisar solo.

| País | Umbral | Ventana | Riesgo |
|---|---|---|---|
| 🇳🇴 Noruega | NOK 50.000 (~US$4.500) | **12 meses MÓVILES** | 🔴 El más apretado. Un solo creador que funcione lo alcanza |
| 🇮🇸 Islandia | ISK 2.000.000 (~US$14.500) | Año | 🟡 Medio |
| 🇧🇦 Bosnia | BAM 50.000 (~US$28.000) | Año | 🟢 Holgado |

⚠️ Noruega usa ventana **móvil de 12 meses**, no año calendario: no se "reinicia" en enero.

Sigue pendiente el contador automático con alerta al 80%. El ledger ya tiene todo el dato.
Queda como **D-13** — ya no bloquea, pero cuanto antes exista, menos depende de la memoria.

---

## 7. Estado y pendientes

### Países

| Bloque | Países | Estado | Impuesto en el checkout |
|---|---|---|---|
| 🇲🇽 México | 1 | ✅ En producción | **Sí** — IVA 16% |
| 🇪🇺 Unión Europea | 27 | ✅ Activos (falta nº de OSS para `sk_live`) | **Sí** — el de cada país |
| 💳 Recauda la emisora | AR · CR · EC · PY · DO | ✅ Activos | No — lo suma el banco |
| ⬜ Sin régimen digital | BO · SV · GT · HN · NI · **PA** | ✅ Activos | No — no lo recauda nadie |
| 🏔️ Europa no-UE bajo umbral | NO · IS · BA | ✅ Activos — **vigilancia manual** | No — hasta cruzar el umbral |
| ⬜ Resto de LatAm | CL · CO · PE · UY · BR | Sin ficha — **no cobrables** | — |
| ⬜ Resto de Europa no-UE | GB · CH · LI · RS · AL · ME · MD · MK · TR | Sin ficha — exigen alta desde la 1ª venta | — |
| 🚫 Excluidos a propósito | UA (embargo regional) · RU · BY (sanciones) | No integrar | — |
| ⬜ Resto del mundo | — | Sin ficha — **no cobrables** | — |

**Total cobrable: 42 países.** Un país sin fila en `COUNTRY_TAX_CONFIG` no es cobrable y el
checkout lo rechaza.

### Backend — ✅ hecho (2026-08-07)

1. ✅ **Determinación server-authoritative del país.** `backend/src/tax/resolveCountry.ts`. Los 9
   puntos de cobro ya no leen `data.taxCountry` del cliente.
2. ✅ **2% de FX cableado.** Vivía en la config sin invocarse en ningún lado; ahora lo aplica
   `composeCharge`.
3. ✅ **`collectionMode` y `mxVatTreatment`** en el tipo, en la tabla y en `applyConsumptionTax`,
   en los dos espejos.
4. ✅ **Fase 2 por tarjeta.** `repriceStripeIntentForCard`.
5. ✅ **Cobertura:** tests de composición de precio, resolución de país y corrección por tarjeta.

### Frontend — ✅ hecho (2026-08-08)

1. ✅ **Lectura del país de la tarjeta.** Al completar los 3 campos, `StripePaymentModal` crea un
   PaymentMethod y lee `card.country`; el precio se recompone con skeletons y una leyenda
   discreta ("Tu tarjeta es de …"). Sin pasos extra en la UI.
2. ✅ **Cobro en moneda local**, no siempre en MXN.
3. ✅ **Precio estimado por IP** en catálogo y botones, gateado por `platformCollectsTax` — por eso
   en AR y en los cinco sin régimen no aparece ninguna línea de impuesto.
4. ⬜ **Aviso de lo que sumará el banco** en países `issuer`. Decidido NO ponerlo por ahora: la
   pasarela muestra un precio único, sin desgloses que el comprador no necesita.

### Decisiones abiertas

| ID | Qué | Quién |
|---|---|---|
| **D-08** | Mapear los 11 servicios a un inciso del Art. 29-IV. Provisionalmente **todos a 0%**; los dudosos son **Tiempo contigo** y **Sesión exclusiva** | Fiscalista MX |
| **D-09** | Los 5 de LatAm que faltan (CL · CO · PE · UY · BR): todos exigen alta previa. Detalle de quién recauda y quién declara en §6.2 | Luis + fiscalista internacional |
| **D-11** | 🇨🇴 ¿La retención en la fuente colombiana SE SUMA al comprador o se DESCUENTA de lo que cobra Vibra? Vale 19% de cada venta. Bloquea la integración de Colombia | Fiscalista CO |
| **D-12** | 🇺🇾 Confirmar el IRNR 12% sobre IVA 22% y quién retiene | Fiscalista UY |
| **D-13** | Contador de ventas acumuladas por país + alerta al 80% del umbral. NO · IS · BA ya están encendidos con **vigilancia manual**; el contador la reemplazaría | Luis + Claude |
| ~~D-14~~ | ~~🇺🇦 ¿Entrar a Ucrania?~~ **Resuelta 2026-08-08: NO.** Requeriría discriminación regional (Crimea/Donetsk/Lugansk bajo embargo OFAC) que no existe | ✅ |
| **D-10** | Vigilar a mano BO · SV · GT · HN · NI · PA: Stripe Tax no los cubre. **Panamá es el más urgente** (anteproyecto de 2019 reabierto) | Luis |
| ~~AR-01~~ | ~~¿Cobrar en ARS o en MXN/USD?~~ **Resuelta: en ARS**, la moneda local del comprador | ✅ |

---

## 8. Plantilla para países nuevos

```markdown
### 🏳️ País — `XX` · ⬜ ESTADO

| Campo | Valor |
|---|---|
| Impuesto | NOMBRE **X%** |
| Moneda de cobro | XXX |
| `collectionMode` | platform / issuer / none |
| `mxVatTreatment` | export_zero |

#### 📋 Qué se necesita para vender aquí

| Requisito | ¿Aplica? |
|---|---|
| **Alta fiscal en el país** | Sí / No — norma que lo exige |
| **Representante legal local** | Sí / No |
| **Declarar y enterar el impuesto** | Vibra / la emisora / nadie |
| **Facturación electrónica local** | Sí / No — formato exigido |
| **Umbral mínimo de ventas** | Monto y periodo, o "ninguno" |
| **Otras obligaciones** | Reportes periódicos, retención de datos, etc. |

**Cobro de Vibra:** fórmula exacta.
**Justificación del impuesto local:** norma citada + fuente oficial.
**Justificación del IVA mexicano:** encuadre Art. 29-IV.
**Lo que el comprador ve:** tabla del resumen de tarjeta.
**Decisiones abiertas:** …
```

> **El bloque "Qué se necesita para vender aquí" es obligatorio en toda ficha.** Es la diferencia
> entre un país que se habilita cambiando una línea de config y uno que requiere un trámite
> previo de semanas. Ese dato lo da **Stripe Tax**, no una búsqueda en internet.
