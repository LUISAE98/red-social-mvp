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

**LatAm queda COMPLETA** — los 17 países integrados, todos con el mismo bloqueo — **exigen alta previa a la primera venta**:

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

## 6.4 Bloqueados: exigen alta desde la venta 1 (2026-08-08)

Vista consolidada de LatAm + Europa + Oceanía + África. **Ninguno tiene fila en `COUNTRY_TAX_CONFIG`**,
así que hoy el checkout los rechaza. No falta programarlos: falta el trámite. El detalle por país
está en §6.2 (LatAm), §6.3 (Europa), §6.6 (Oceanía) y §6.7 (África).

⚠️ **La Polinesia Francesa es el caso a no malinterpretar:** su moneda (XPF) SÍ está en el
catálogo, porque la comparte con Nueva Caledonia, que sí vende. Tener moneda **no** es permiso de
venta — lo gatea `COUNTRY_TAX_CONFIG`, y ahí no tiene fila. Hay un test que lo verifica.

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇨🇭 Suiza | CHF | Alemán/francés/italiano | 8,1% | MWST/TVA | Vibra (tras alta) | Trimestral | FTA + **representante fiscal** | CHF 100.000 **mundial** ⚠️ | 🔴 No cobrable |
| 🇱🇮 Liechtenstein | CHF | Alemán | 8,1% | MWST | Vibra (tras alta) | Trimestral | Sistema suizo (unión aduanera) | Igual que Suiza | 🔴 No cobrable |
| 🇲🇰 Macedonia del Norte | MKD | Macedonio | 18% | DDV | Vibra (tras alta) | Por confirmar | **Representante fiscal local** solidario | Ninguno | 🔴 No cobrable |
| 🇵🇫 Polinesia Francesa | XPF | Francés/Tahitiano | 13% servicios / 16% estándar | TVA | Vibra (tras alta) | Por confirmar | DICP | **Cero** | 🔴 No cobrable |
| 🇰🇪 Kenia | KES | Suajili/Inglés | 16% | VAT | Vibra (tras alta) | Mensual | KRA | **Cero** | 🔴 No cobrable |
| 🇬🇭 Ghana | GHS | Inglés | 15% | VAT | Vibra (tras alta) | Mensual | GRA + **E-VAT obligatorio** | **Cero** | 🔴 No cobrable |
| 🇹🇿 Tanzania | TZS | Suajili/Inglés | 18% | VAT | Vibra (tras alta) | Mensual | TRA | **Cero** + **3% de renta sobre bruto** ⚠️ | 🔴 No cobrable |
| 🇺🇬 Uganda | UGX | Inglés/Suajili | 18% | VAT | Vibra (tras alta) | Por confirmar | URA | **Cero** | 🔴 No cobrable |

⚠️ Los "por confirmar" son huecos REALES: se buscaron y las fuentes no los resuelven con claridad.
Se dejan vacíos a propósito — inventar una frecuencia de declaración es peor que no tenerla. Se
cierran cuando el país se priorice, con la profundidad que se le dio a Panamá (§6).

### Lo que no se ve en la tabla

**🇨🇭 Suiza no tiene umbral aunque lo parezca.** Los CHF 100.000 son de facturación **mundial**, no
suiza: si el ingreso global los supera, hay que registrarse aunque se venda una sola vez ahí. Es
la confusión más cara de esta lista. Ver §6.3.

**🇨🇴 Colombia es el único que puede quedar SIN declaraciones.** Acogiéndose al sistema alternativo,
los emisores de tarjeta retienen y Vibra no presenta nada. Sigue haciendo falta el RUT, pero es un
trámite una vez. El más barato de operar de los 14 — bloqueado por **D-11**.

**🇲🇰 Macedonia del Norte exige representante fiscal local solidariamente responsable**: alguien en
el país responde con su patrimonio por los impuestos de Vibra. Para el tamaño de ese mercado, no
compensa.

### Orden de prioridad sugerido

1. 🇨🇴 **Colombia** — resolver D-11; si el 19% se le suma al comprador, es el más barato de todos.
2. 🇨🇱 **Chile** — el más predecible: alta clara, formulario claro, pago en dólares.
3. 🇬🇧 **Reino Unido** — el mercado más grande, pero sin margen de prueba (umbral cero).
4. 🇵🇪 **Perú** — claro, con declaración mensual.
5. El resto, solo si aparece demanda real.

---

## 6.5 Asia-Pacífico y Medio Oriente (2026-08-10)

Los 13 integrados. Ninguno cobra impuesto hoy, por dos razones distintas que conviene no mezclar.

### 🟢 ACTIVOS — no existe impuesto al consumo

Los únicos de TODA la tabla sin reloj corriendo: no hay umbral que cruzar ni alta que llegue nunca.
Son estrictamente mejores que Noruega, Islandia y Bosnia.

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇭🇰 Hong Kong | HKD | Chino/Inglés | **0%** | No existe | Nadie | Ninguna | **No existe** | N/A | ✅ Activo |
| 🇶🇦 Qatar | QAR | Árabe | **0%** | Sin IVA aún | Nadie | Ninguna | **No existe** | N/A | ✅ Activo |
| 🇰🇼 Kuwait | KWD | Árabe | **0%** | Sin IVA aún | Nadie | Ninguna | **No existe** | N/A | ✅ Activo |

Helper: `noConsumptionTax(currency)` — tasa **0**, `collectionMode: "none"`.

⚠️ Qatar y Kuwait firmaron el acuerdo de IVA del CCG pero **no lo han implementado**. Si lo hacen,
pasan a `belowThreshold` o a `cannot_sell` según lo que exija el régimen. Vigilancia manual.

### ✅ ACTIVOS — con umbral, se vende sin alta

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇯🇵 Japón | JPY | Japonés | 10% | JCT | Nadie (bajo umbral) | Anual | NTA | **¥10.000.000**/año (~US$65.000) | ✅ Activo |
| 🇲🇾 Malasia | MYR | Malayo | 8% | SST | Nadie (bajo umbral) | Por confirmar | RMCD | **MYR 500.000**/12m (~US$106.000) | ✅ Activo |
| 🇵🇭 Filipinas | PHP | Filipino/Inglés | 12% | VAT | Nadie (bajo umbral) | Trimestral | BIR (RA 12023, 2024) | **PHP 3.000.000**/12m (~US$51.000) | ✅ Activo |
| 🇹🇭 Tailandia | THB | Tailandés | 7% | VAT | Nadie (bajo umbral) | **Mensual** | Revenue Department | **THB 1.800.000**/año (~US$50.000) | ✅ Activo |
| 🇦🇺 Australia | AUD | Inglés | 10% | GST | Nadie (bajo umbral) | Trimestral | ATO simplificado | **A$75.000**/año (~US$49.000) | ✅ Activo |
| 🇯🇴 Jordania | JOD | Árabe | 16% | GST | Nadie (bajo umbral) | Por confirmar | ISTD | **JOD 30.000**/12m (~US$42.000) | ✅ Activo |
| 🇮🇩 Indonesia | IDR | Indonesio | 11% | PPN | Nadie (bajo umbral) | Mensual | DGT | **IDR 600.000.000**/año (~US$37.000) | ✅ Activo |
| 🇳🇿 Nueva Zelanda | NZD | Inglés | 15% | GST | Nadie (bajo umbral) | Trimestral | IRD | **NZ$60.000**/12m móviles (~US$36.000) | ✅ Activo |
| 🇹🇼 Taiwán | TWD | Chino | 5% | VAT | Nadie (bajo umbral) | Bimestral | MOF | **NTD 600.000**/año (~US$18.500) | ✅ Activo |
| 🇸🇬 Singapur | SGD | Inglés | 9% | GST | Nadie (bajo umbral) | Trimestral | IRAS (OVR) | **SGD 100.000 local Y SGD 1M global** ⚠️ | ✅ Activo |

Helper: `belowThreshold()` — `collectionMode: "platform"` + `registrationStatus: "not_registered"`.
Al cruzar un umbral: cambiar ese campo a `"registered"` en los **dos** espejos.

**🇯🇵 Japón es el hallazgo grande:** ~US$65.000 al año, el umbral más holgado de toda la tabla, en
uno de los mercados más ricos del mundo para creadores. Se puede construir algo real antes del alta.

**🇸🇬 Singapur exige DOS condiciones a la vez** (ventas locales ≥ SGD 100.000 **y** facturación
mundial ≥ SGD 1.000.000). Basta que una no se cumpla para no tener que registrarse. Se parece a
Suiza en que mira la facturación global, pero allá una sola condición basta — por eso Suiza está
bloqueada y Singapur no.

**🇹🇼 Taiwán es el más apretado del bloque** (~US$18.500) y el de tasa más baja (5%).

### 🚨 Monedas: dos trampas de formato de Stripe

Integrar estos 13 obligó a arreglar `toStripeAmount`:

**Dinares de TRES decimales (KWD, JOD — y BHD, OMR, TND si algún día entran).** El importe va en
MILÉSIMAS, no en centésimas. Con la fórmula genérica `amount * 100` se le habría cobrado al
comprador **la décima parte**: 15.778 KWD habrían salido como 1.578 KWD. Además Stripe exige que el
último dígito sea 0, así que se redondea a la decena de fils. Cubierto con tests.

**El yen ya estaba** en `ZERO_DECIMAL`; el nuevo dólar taiwanés **no** necesita trato especial
(su restricción de divisibilidad es solo para transferencias manuales, no para cargos — igual que
el forinto húngaro, que se verificó de paso y está bien).

### Idiomas

Ninguno de estos idiomas está en los 24 de la UE: japonés, malayo, tailandés, árabe, indonesio,
chino y coreano caen al **fallback en inglés**. No bloquea la venta, y Hong Kong, Singapur,
Australia, Nueva Zelanda y Filipinas son mercados donde el inglés es natural. Ver §6.3 y
`i18n/locales.ts`.

### 🚫 De Asia y Medio Oriente NO se integró

| País | Motivo |
|---|---|
| 🇮🇳 India · 🇸🇦 Arabia Saudita · 🇰🇷 Corea del Sur · 🇻🇳 Vietnam · 🇧🇭 Baréin · 🇴🇲 Omán · 🇦🇪 EAU | Umbral **cero**: alta desde la venta 1. Baréin además exige representante fiscal |
| 🇷🇺 Rusia · 🇧🇾 Bielorrusia · 🇨🇺 Cuba | Sanciones — Stripe no opera |
| 🇮🇱 Israel | **Dos motivos, cualquiera basta** (Luis, 2026-08-10; razones detalladas 2026-08-19): 1) inestabilidad política — un régimen de alta y declaración continua asume que el país opera igual dentro de un año; 2) exige **representante fiscal residente**, que Vibra no tiene (mismo motivo que Macedonia del Norte y Suiza) |

Hay un test que verifica que estos sigan fuera.

---

## 6.6 Oceanía (2026-08-10)

Australia y Nueva Zelanda están en §6.5, con Asia-Pacífico. Aquí van los cuatro que quedaban.
Los cuatro cobran cero, pero **cada uno por un motivo distinto**, y esa diferencia decide si algún
día habrá que cobrar ahí.

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇬🇺 Guam | USD | Inglés/Chamorro | **0%** | No existe | Nadie | Ninguna | **No existe** | N/A | ✅ Activo |
| 🇵🇬 Papúa Nueva Guinea | PGK | Inglés/Tok Pisin | 10% | GST | Nadie (B2C sin régimen) | Ninguna | No existe para extranjeros | N/A | ✅ Activo |
| 🇳🇨 Nueva Caledonia | XPF | Francés | 11% | TGC | Nadie (bajo umbral) | Por confirmar | DSF | **XPF 7.500.000**/año (~US$68.000) | ✅ Activo |
| 🇫🇯 Fiyi | FJD | Inglés/Fiyiano | **12,5%** | VAT | Nadie (bajo umbral) | Por confirmar | FRCS + **agente fiscal local** | **FJD 100.000**/12m (~US$44.000) | ✅ Activo |

### Por qué cada uno lleva un helper distinto

* **🇬🇺 Guam — `noConsumptionTax("USD")`.** No hay IVA ni GST. Su *Business Privilege Tax* del 4%
  recae en negocios **establecidos en Guam**, no en un vendedor extranjero. Nunca habrá nada que
  cobrar. Además no trajo moneda nueva: usa el dólar, que ya estaba.
* **🇵🇬 Papúa Nueva Guinea — `noDigitalRegime("GST", 0.10, "PGK")`.** El GST del 10% existe, pero
  el reverse charge solo alcanza a clientes registrados en GST (B2B). Las ventas a consumidores
  desde el exterior no tienen régimen. Si legislan uno, esta fila cambia.
* **🇳🇨 Nueva Caledonia y 🇫🇯 Fiyi — `belowThreshold()`.** El régimen para extranjeros existe y
  está activo; solo falta cruzar el umbral. Reloj corriendo, vigilancia manual (**D-13**).

⚠️ **Fiyi cobra 12,5%, no 15%:** bajó el 1 de agosto de 2025. Hay un test que fija ese valor
para que nadie lo "corrija" al dato viejo, que sigue circulando en fuentes secundarias.

⚠️ **Registrarse en Fiyi exige agente fiscal local o establecimiento permanente**, como Macedonia
del Norte. Es un motivo para no dejar que cruce el umbral sin decidirlo antes.

### 🚨 El franco CFP es moneda SIN decimales

XPF entró a `ZERO_DECIMAL` junto con XAF y XOF. Sin eso, la fórmula genérica `amount * 100`
le habría cobrado a Nueva Caledonia **100 veces de más**. Cubierto con test.

Es la tercera trampa de formato de Stripe que aparece en esta tabla, después de las milésimas del
Golfo (§6.5) y los enteros de la corona islandesa (§6.3). **Al agregar una moneda hay que revisar
siempre `toStripeAmount`,** no solo el catálogo.

### 🚫 Lo que NO se integró de Oceanía

**🇵🇫 Polinesia Francesa** — TVA 13% servicios / 16% estándar, con umbral **CERO**: alta desde la
primera venta. Está en §6.4. Su moneda ya quedó en el catálogo por compartirla con Nueva Caledonia.

**Los microestados** — Islas Salomón, Vanuatu, Samoa, Tonga, Kiribati, Micronesia, Islas Marshall,
Palaos, Nauru, Tuvalu, Islas Cook, Niue, Wallis y Futuna, Samoa Americana, Marianas del Norte.

Casi todos tienen impuesto al consumo propio (15% en Vanuatu, Samoa y Tonga), pero ninguno tiene
régimen para proveedores digitales extranjeros — son más pequeños que Bolivia, que tampoco lo
tiene. **No se verificaron uno por uno a propósito:** son mercados de 100.000 a 300.000 habitantes
y cada país nuevo cuesta cuatro sitios de código, filas en dos espejos, tests, ficha y un umbral
más que recordar. No compensa.

Con esto **Oceanía queda cerrada.** Lo que faltaba de peso —Australia y Nueva Zelanda— ya estaba.

---

## 6.7 África (2026-08-11)

⚠️ **Es la región que más rápido está legislando esto, y esta sección caduca antes que las
demás.** Marruecos entró en vigor el 11 de junio de 2026, Nigeria el 1 de enero, Malaui el 15 de
abril, Botsuana en junio. Lo que hoy no tiene régimen puede tenerlo en seis meses.

Ventaja frente a LatAm: **Stripe Tax sí cubre buena parte de África** (19 países), así que su
monitoreo avisará de los cambios — al revés que con Bolivia y compañía.

### ✅ ACTIVOS — con umbral, se vende sin alta

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇿🇦 Sudáfrica | ZAR | Inglés/Afrikáans | 15% | VAT | Nadie (bajo umbral) | Bimestral | SARS | **ZAR 2.300.000**/12m móviles (~US$125.000) | ✅ Activo |
| 🇪🇬 Egipto | EGP | Árabe | 14% | VAT | Nadie (bajo umbral) | Mensual | ETA (registro simplificado) | **EGP 500.000**/12m (~US$10.000) | ✅ Activo |

**🇿🇦 Sudáfrica tiene el umbral más holgado de TODA la tabla mundial.** Subió de ZAR 1.000.000 a
**ZAR 2.300.000 el 1 de abril de 2026** — unos US$125.000 al año, casi el doble que Japón
(~US$65.000), que era el récord anterior. Y es el mercado de creadores más grande de África, en
inglés. Es el país de mayor margen de operación sin alta que existe hoy en la tabla.

**🇪🇬 Egipto está en el extremo opuesto:** ~US$10.000 al año lo convierte en el segundo umbral más
apretado que tenemos, solo por encima de Noruega (~US$4.500). Vigilarlo de cerca.

### 🚨 En África el impuesto NO es el único filtro

Es la primera región donde **Stripe puede ser el bloqueo, no el fisco**. Que el impuesto permita
vender no significa que se pueda cobrar:

| Situación | Países |
|---|---|
| **Stripe no opera** | Sudán · Sudán del Sur · Somalia · Eritrea · Libia |
| **Restricciones o demoras por riesgo de sanciones** | Zimbabue · Burundi · Rep. Centroafricana · RD Congo · Guinea · Guinea-Bisáu · Malí |

⚠️ **Zimbabue es el caso ilustrativo:** fiscalmente sería vendible —IVA 15,5% con umbral de
US$25.000, y desde el 1-ene-2026 hasta con retención por intermediarios— pero Stripe lo restringe.
**No agregarlo aunque el impuesto lo permita.** Hay un test que verifica que estos doce sigan fuera.

### 🚫 Con alta desde la venta 1 → §6.4

Marruecos, Kenia, Ghana, Nigeria, Tanzania y Uganda. Dos merecen nota:

* **🇬🇭 Ghana** exige además **facturación electrónica certificada (E-VAT)**. Es de los regímenes
  más pesados de todo el documento: no basta con declarar, hay que emitir por su sistema.
* **🇹🇿 Tanzania** cobra 18% de IVA **más un 3% de impuesto sobre ingresos brutos** (subió del 2%
  el 1-jul-2026). Es el único de toda la tabla mundial que grava el ingreso además del consumo —
  ese 3% sale del margen, no del comprador.

### ✅ Verificados y descartados

* **🇨🇻 CABO VERDE** (verificado 2026-08-12). IVA **15%**, **umbral CERO** y **representante fiscal
  residente OBLIGATORIO** — la propia solicitud de registro pide los datos del representante local.
  Declaración **trimestral**, **sin derecho a deducir IVA soportado**, y **facturación electrónica**
  obligatoria para los no residentes que la Agência de Receitas incluya en su lista de operadores de
  e-commerce (lista que se actualiza periódicamente, así que la obligación puede aparecer sin aviso).
  Dos bloqueadores independientes sobre un mercado de ~525.000 habitantes: descartado sin matices.
* **🇲🇼 MALAUI** — obliga a registrarse aunque no se alcance el umbral. Descartado.

### ⚠️ Sin verificar — el resto del continente

Argelia, Túnez, Angola, Zambia, Etiopía, Senegal, Camerún, Ruanda, Mauricio, Namibia, Mauritania y
los demás. Casi todos tienen IVA propio (18–19% en el África francófona), la mayoría sin régimen
para proveedores extranjeros. No se verificaron uno por uno: fuera de Sudáfrica, Nigeria, Egipto,
Botsuana y Costa de Marfil —los cinco integrados— el mercado de creadores es marginal y la
penetración de tarjeta baja.

**Nota de formato:** el chelín ugandés (UGX) ya está en `WHOLE_UNIT_ONLY` y los francos CFA
(XAF/XOF) en `ZERO_DECIMAL` desde las integraciones del Golfo y Oceanía. Si algún día entran,
esa trampa ya está cubierta. Ni ZAR ni EGP necesitan trato especial.

---

## 6.8 🇨🇦 Canadá — el país que no cabe en el modelo (2026-08-11)

Canadá no tiene un impuesto: tiene **cinco registros distintos**, cada uno con su propia regla.
Es el único caso de todo el documento donde una fila de `COUNTRY_TAX_CONFIG` no describe bien la
realidad.

| Nivel | Impuesto | Tasa | Umbral | ¿Vende sin alta? |
|---|---|---|---|---|
| **Federal** | GST/HST | **5%–15% según provincia** | CAD 30.000/12m móviles (~US$22.000) | ✅ Sí |
| 🇨🇦 Québec | QST | 9,975% | CAD 30.000/año | ✅ Sí |
| 🇨🇦 Columbia Británica | PST | 7% | CAD 10.000/año | ✅ Sí |
| 🇨🇦 Saskatchewan | PST | 6% | **CERO** | ❌ **Desde la venta 1** |
| 🇨🇦 Manitoba | RST | 7% | **CERO en la práctica** | ❌ **Desde la venta 1** |

⚠️ El umbral nominal de CAD 30.000 de Manitoba **solo aplica a vendedores que pagaron RST en sus
propias compras** — cosa que un proveedor extranjero nunca cumple. En la práctica es cero.

### Ficha de integración

| Campo | Valor |
|---|---|
| País | 🇨🇦 Canadá — `CA` |
| Moneda | CAD |
| Idioma | Inglés / Francés |
| TASA | 5% (**suelo federal**, no "la tasa de Canadá") |
| Impuesto | GST/HST |
| Recaudación | Nadie (bajo umbral) |
| Declaración | Trimestral, en CAD (registro simplificado, sin BN canadiense ni representante) |
| Alta fiscal | CRA — Business Registration Online |
| Umbral | CAD 30.000/12m móviles federal · QC 30.000 · BC 10.000 · **SK y MB: cero** |
| Estatus | ✅ Activo — sin impuesto |

### 🚨 Exposición aceptada a conciencia (decisión de Luis, 2026-08-11)

Se entró **cubriendo los tres niveles CON umbral** (federal, Québec y Columbia Británica).
Saskatchewan y Manitoba quedan pendientes.

Eso significa que **la primera venta a esas dos provincias genera obligación de registro ese mismo
día**. No es un umbral que vigilar: es incumplimiento técnico desde el minuto uno.

**Dimensión de la exposición:** Saskatchewan (~1,2 M) y Manitoba (~1,5 M) suman ~2,7 de los
41 millones de canadienses, un **6,6%**. El riesgo material es PST del 6–7% sobre esa fracción de
las ventas canadienses, más eventuales multas. Pequeño en absoluto, pero real y permanente.

> Se documenta aquí para que sea una decisión visible y no un olvido. Si algún día Canadá pasa a
> ser un mercado con peso, esto se revisa **antes**, no después.

### 🚨 Aquí cruzar el umbral NO es cambiar un campo

En los otros 17 países bajo umbral, el día que se cruza basta con poner
`registrationStatus: "registered"` en los dos espejos y el motor hace el resto.

**En Canadá eso cobraría mal.** La tasa efectiva del GST/HST depende de la provincia del comprador
—5% en Alberta, 13% en Ontario, 15% en Nueva Escocia— y `resolveCountry.ts` solo distingue PAÍS.
Registrarse exige antes **resolver la provincia**, que es un cambio de modelo, no una bandera.

Por eso la fila guarda **0.05, el suelo federal**, y hay un test que lo fija: si alguien lo
"corrige" a una tasa promedio o al HST máximo, es señal de que creyó que Canadá se comporta como
los demás.

Es la misma limitación de subdivisión que dejó fuera a Ucrania (Crimea y Donbás) — solo que allá
el riesgo era un embargo y aquí es cobrar de menos.

---

## 6.9 🇺🇸 Estados Unidos (2026-08-11)

**No existe sales tax federal.** El impuesto es estatal: 45 estados + DC lo tienen; Nuevo
Hampshire, Oregón, Montana, Alaska y Delaware no (Alaska sí permite impuestos locales).

### Ficha de integración

| Campo | Valor |
|---|---|
| País | 🇺🇸 Estados Unidos — `US` |
| Moneda | USD *(ya estaba en el catálogo: no hizo falta agregar ninguna)* |
| Idioma | Inglés |
| TASA | **0** — ver la advertencia de abajo |
| Impuesto | Sales tax (estatal) |
| Recaudación | Nadie (bajo umbral en los 50 estados) |
| Declaración | Por estado, tras registrarse |
| Alta fiscal | Por estado, ante su Department of Revenue |
| Umbral | **Por estado.** 41 estados US$100.000 · AL y MS US$250.000 · CA, TX y NY US$500.000 |
| Estatus | ✅ Activo — sin impuesto |

### ✅ Por qué EE. UU. es más seguro que Canadá

Tras *South Dakota v. Wayfair* (2018) cada estado fija su **nexo económico**. La diferencia que
importa: **ningún estado lo tiene en cero.**

| | 🇺🇸 EE. UU. | 🇨🇦 Canadá |
|---|---|---|
| Jurisdicciones | 46 | 5 |
| Umbral mínimo | **US$100.000** | **Cero** (Saskatchewan, Manitoba) |
| ¿Vende sin alta? | **Sí, en los 50 estados** | Sí, salvo en 2 provincias |
| Exposición desde la venta 1 | **Ninguna** | ~6,6% del país |

Canadá tiene cinco jurisdicciones y dos obligan desde el minuto uno. Estados Unidos tiene 46 y
ninguna lo hace. **Estar sin registrar es plenamente legal en todas partes**, y por eso su fila no
lleva la nota de exposición aceptada que sí lleva la de Canadá (§6.8).

Además el umbral es **por estado**: para deber algo en California harían falta US$500.000 vendidos
solo en California en 12 meses.

### 🚨 La tasa va en 0, y NO significa "aquí no hay impuesto"

No existe una tasa federal que guardar. Van de **2,90% (Colorado) a 7,25% (California)** de base
estatal, más locales que suman hasta ~5 puntos. Cualquier número en esa celda sería falso para 45
jurisdicciones.

Es un caso **distinto** de Hong Kong, Qatar, Kuwait y Guam, donde el impuesto de verdad no existe:
esos usan `noConsumptionTax`. Estados Unidos usa `belowThreshold`, que dice "hay régimen y
estamos debajo". Hay un test que fija esa diferencia.

### Tabla por estado — tasas al 1 de julio de 2026 (Tax Foundation)

| Estado | Estatal | Local prom. | Combinada | Umbral de nexo |
|---|---|---|---|---|
| Alabama | 4,00% | 5,46% | 9,46% | **US$250.000** |
| Alaska | 0,00% | 1,82% | 1,82% | US$100.000 *(solo local)* |
| Arizona | 5,60% | 2,94% | 8,54% | US$100.000 |
| Arkansas | 6,50% | 2,98% | 9,48% | US$100.000 |
| California | 7,25% | 1,78% | 9,03% | **US$500.000** |
| Carolina del Norte | 4,75% | 2,35% | 7,10% | US$100.000 |
| Carolina del Sur | 6,00% | 1,49% | 7,49% | US$100.000 |
| Colorado | 2,90% | 4,99% | 7,89% | US$100.000 |
| Connecticut | 6,35% | 0,00% | 6,35% | US$100.000 |
| Dakota del Norte | 5,00% | 2,09% | 7,09% | US$100.000 |
| Dakota del Sur | 4,20% | 1,91% | 6,11% | US$100.000 |
| Delaware | 0,00% | 0,00% | 0,00% | — *(sin sales tax)* |
| Distrito de Columbia | 6,00% | 0,00% | 6,00% | US$100.000 |
| Florida | 6,00% | 0,98% | 6,98% | US$100.000 |
| Georgia | 4,00% | 3,56% | 7,56% | US$100.000 |
| Hawái | 4,00% | 0,50% | 4,50% | US$100.000 |
| Idaho | 6,00% | 0,03% | 6,03% | US$100.000 |
| Illinois | 6,25% | 2,73% | 8,98% | US$100.000 |
| Indiana | 7,00% | 0,00% | 7,00% | US$100.000 |
| Iowa | 6,00% | 0,94% | 6,94% | US$100.000 |
| Kansas | 6,50% | 2,21% | 8,71% | US$100.000 |
| Kentucky | 6,00% | 0,00% | 6,00% | US$100.000 |
| Luisiana | 5,00% | 5,13% | 10,13% | US$100.000 |
| Maine | 5,50% | 0,00% | 5,50% | US$100.000 |
| Maryland | 6,00% | 0,00% | 6,00% | US$100.000 |
| Massachusetts | 6,25% | 0,00% | 6,25% | US$100.000 |
| Michigan | 6,00% | 0,00% | 6,00% | US$100.000 |
| Minnesota | 6,88% | 1,26% | 8,14% | US$100.000 |
| Misisipi | 7,00% | 0,06% | 7,06% | **US$250.000** |
| Misuri | 4,23% | 4,22% | 8,45% | US$100.000 |
| Montana | 0,00% | 0,00% | 0,00% | — *(sin sales tax)* |
| Nebraska | 5,50% | 1,48% | 6,98% | US$100.000 |
| Nevada | 6,85% | 1,39% | 8,24% | US$100.000 |
| Nueva Jersey | 6,63% | -0,02% | 6,61% | US$100.000 |
| Nueva York | 4,00% | 4,54% | 8,54% | **US$500.000** |
| Nuevo Hampshire | 0,00% | 0,00% | 0,00% | — *(sin sales tax)* |
| Nuevo México | 4,88% | 2,80% | 7,68% | US$100.000 |
| Ohio | 5,75% | 1,54% | 7,29% | US$100.000 |
| Oklahoma | 4,50% | 4,56% | 9,06% | US$100.000 |
| Oregón | 0,00% | 0,00% | 0,00% | — *(sin sales tax)* |
| Pensilvania | 6,00% | 0,34% | 6,34% | US$100.000 |
| Rhode Island | 7,00% | 0,00% | 7,00% | US$100.000 |
| Tennessee | 7,00% | 2,61% | 9,61% | US$100.000 |
| Texas | 6,25% | 1,95% | 8,20% | **US$500.000** |
| Utah | 6,10% | 1,32% | 7,42% | US$100.000 |
| Vermont | 6,00% | 0,43% | 6,43% | US$100.000 |
| Virginia | 5,30% | 0,47% | 5,77% | US$100.000 |
| Virginia Occidental | 6,00% | 0,60% | 6,60% | US$100.000 |
| Washington | 6,50% | 3,07% | 9,57% | US$100.000 |
| Wisconsin | 5,00% | 0,72% | 5,72% | US$100.000 |
| Wyoming | 4,00% | 1,39% | 5,39% | US$100.000 |

⚠️ La columna **local promedio** es un promedio ponderado: la tasa real depende del municipio.
Luisiana, Colorado y Alabama tienen jurisdicciones locales que además **registran aparte**.

⚠️ Alaska no tiene sales tax estatal pero sus municipios sí, coordinados por la ARSSTC, con su
propio umbral de US$100.000.

### ⚠️ Lo que NO está resuelto: qué servicios son gravables

Es la parte más movediza y la que habría que cerrar **antes** de registrarse en cualquier estado:

* Unos **30 estados** gravan algún producto digital; **~25** gravan SaaS. Las definiciones difieren
  entre sí.
* **Florida y Virginia los eximen** explícitamente.
* Una videollamada 1-a-1 puede ser *servicio* (no gravado) en un estado y *producto digital*
  (gravado) en otro. Las propinas y donaciones probablemente no sean venta en ninguno.
* Es el área que más rápido cambia de todo el documento: California amplió su base con la SB 122,
  Colorado y Washington ampliaron software, Utah codificó SaaS.

**No se investigó estado por estado a propósito:** con umbrales de US$100.000+ por estado, la
pregunta no se vuelve real hasta tener volumen serio en uno concreto — y para entonces la
respuesta de hoy estaría vencida.

### 🚨 Registrarse aquí tampoco es cambiar un campo

Igual que Canadá: haría falta resolver el **estado** del comprador (**D-16**) y además decidir la
gravabilidad de cada uno de los 11 servicios en ese estado. Dos casos distintos ya piden resolución
por subdivisión.

Diferencia con Canadá: allá esa limitación produce **exposición hoy**; aquí solo bloquea el futuro.

---

## 6.10 Países con alta obligatoria — ENCENDIDOS con alta pendiente (2026-08-11)

Los cuatro **exigen alta desde la primera venta**: no tienen umbral. El código ya cobra; **las
altas reales están pendientes**. Están encendidos para probar con Stripe en **modo prueba**, donde
no hay dinero real ni obligación fiscal — la misma decisión que se tomó con la UE.

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇧🇷 Brasil | BRL | Portugués | **1,0%** hoy → 26,5% en 2033 | CBS + IBS | **Vibra** | Mensual | CNPJ — Receita Federal | Ninguno | 🟡 Alta pendiente |
| 🇨🇴 Colombia | COP | Español | 19% | IVA | **Vibra** (o emisores, si se acoge) | Bimestral — o ninguna con retención | RUT + firma electrónica — DIAN | Ninguno | 🟡 Alta pendiente |
| 🇨🇱 Chile | CLP | Español | 19% | IVA | **Vibra** | Mensual o trimestral, en USD/EUR | Régimen simplificado — SII | Ninguno | 🟡 Alta pendiente |
| 🇵🇪 Perú | PEN | Español | 18% | IGV | **Vibra** (agente de percepción) | Mensual | RUC — SUNAT | Ninguno | 🟡 Alta pendiente |
| 🇺🇾 Uruguay | UYU *(se puede pagar en USD)* | Español | **22%** al comprador *(+ IRNR 12% que absorbe Vibra)* | IVA | **Vibra** | **Trimestral** | DGI · sin representante local | Ninguno | 🟡 Alta pendiente |

### 🌍 Europa no comunitaria (2026-08-11)

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇬🇧 Reino Unido | GBP | Inglés | 20% | VAT | **Vibra** | Trimestral | HMRC — **NETP** | **Cero** para extranjeros | 🟡 Alta pendiente |
| 🇹🇷 Turquía | TRY | Turco | 20% | KDV | **Vibra** | Mensual | VAT No. 3 (GİB) | Ninguno | 🟡 Alta pendiente |
| 🇷🇸 Serbia | RSD | Serbio | 20% | PDV | **Vibra** | Por confirmar | Poreska uprava | Ninguno | 🟡 Alta pendiente |
| 🇦🇱 Albania | ALL | Albanés | 20% | TVSH | **Vibra** | Mensual | Drejtoria e Tatimeve | Ninguno | 🟡 Alta pendiente |
| 🇲🇪 Montenegro | **EUR** | Montenegrino | 21% | PDV | **Vibra** | Por confirmar | Uprava prihoda i carina | Ninguno | 🟡 Alta pendiente |
| 🇲🇩 Moldavia | MDL | Rumano | 20% | TVA | **Vibra** | Por confirmar | Serviciul Fiscal de Stat | Ninguno | 🟡 Alta pendiente |

### 🌏 Asia y Golfo (2026-08-11)

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇰🇷 Corea del Sur | KRW | Coreano | 10% | VAT | **Vibra** | **Trimestral** — día 25 | Hometax · sin representante · ⚠️ **alta en 20 días** desde el inicio | Ninguno | 🟡 Alta pendiente |
| 🇻🇳 Vietnam | VND | Vietnamita | 10% | VAT *(+ CIT 5%, ver abajo)* | **Vibra** | **Trimestral** | Portal GDT · sin representante | Ninguno | 🟡 Alta pendiente |
| 🇦🇪 EAU | AED | Árabe | 5% | VAT | **Vibra** | **Trimestral** (mensual solo > AED 150 M) | FTA / EmaraTax · sin representante | Ninguno | 🟡 Alta pendiente |
| 🇸🇦 Arabia Saudita | SAR | Árabe | 15% | VAT | **Vibra** | **Trimestral** (mensual solo > SAR 40 M) | ZATCA · representante opcional | Ninguno | 🟡 Alta pendiente |

### 🌍 África (2026-08-11)

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇳🇬 Nigeria | NGN | Inglés | **7,5%** | VAT | **Vibra** | Por confirmar | FIRS (Tax Act 2025) | Ninguno | 🟡 Alta pendiente |
| 🇲🇦 Marruecos | MAD | Árabe/Francés | 20% | TVA | **Vibra** | Por confirmar | Plataforma DGI | Ninguno | 🟡 Alta pendiente |

### 🌊 Oceanía (2026-08-11)

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇵🇫 Polinesia Francesa | XPF | Francés/Tahitiano | **13%** servicios | TVA | **Vibra** | Por confirmar | DICP | Ninguno | 🟡 Alta pendiente |

Cierra Oceanía. Su moneda ya estaba en el catálogo por compartirla con Nueva Caledonia.

⚠️ **Su TVA tiene DOS tasas: 13% para servicios y 16% estándar.** Se usa 13% porque los 11
servicios de Vibra son servicios. Si el fisco polinesio llegara a clasificar el contenido de pago
(VOD, post premium, tickets) como bien, subiría al 16%.

🚨 **PF y NC comparten moneda pero NO régimen:** Nueva Caledonia tiene umbral (XPF 7.500.000) y
Polinesia no tiene ninguno. Hay un test que lo fija.

### 🏝️ Los 13 microestados del Pacífico — integrados sin cobrar (2026-08-11)

| País | Población | Moneda | Impuesto local | Cobra Vibra |
|---|---|---|---|---|
| 🇸🇧 Islas Salomón | ~750.000 | SBD | GST 15% | No |
| 🇻🇺 Vanuatu | ~330.000 | VUV | VAT 15% | No |
| 🇼🇸 Samoa | ~220.000 | WST | GST 15% | No |
| 🇰🇮 Kiribati | ~130.000 | AUD ✓ | VAT 12,5% | No |
| 🇫🇲 Micronesia | ~115.000 | USD ✓ | — | No |
| 🇹🇴 Tonga | ~105.000 | TOP | Consumption Tax 15% | No |
| 🇲🇵 Marianas del Norte | ~47.000 | USD ✓ | — | No |
| 🇦🇸 Samoa Americana | ~45.000 | USD ✓ | — | No |
| 🇲🇭 Islas Marshall | ~42.000 | USD ✓ | — | No |
| 🇳🇷 Nauru | ~12.000 | AUD ✓ | — | No |
| 🇹🇻 Tuvalu | ~11.000 | AUD ✓ | — | No |
| 🇼🇫 Wallis y Futuna | ~11.000 | XPF ✓ | — | No |
| 🇳🇺 Niue | ~1.900 | NZD ✓ | — | No |

Solo cuatro trajeron moneda nueva (TOP, SBD, VUV, WST); el resto reutiliza AUD, NZD, USD y XPF.
⚠️ El **vatu (VUV) es moneda sin decimales** para Stripe — entró a `ZERO_DECIMAL`.

### 🚨 Estos 13 se integraron sobre una PROBABILIDAD, no sobre verificación

A diferencia del resto del documento, **no se confirmó país por país** que no exista régimen para
proveedores digitales extranjeros: se buscó y **no hay información pública clara**.

Se integraron por el mismo razonamiento que Bolivia o Papúa Nueva Guinea —jurisdicciones de 1.900
a 750.000 habitantes no construyen regímenes tipo OSS— y porque verificarlos serían 15
investigaciones separadas para un mercado combinado de ~1,8 millones, menos que media Nueva
Zelanda. **Decisión de Luis, 2026-08-11.**

Varios tienen IVA propio (15% en Vanuatu, Samoa y Tonga). Lo que no se encontró es que **alcance a
un vendedor extranjero sin presencia local**.

**🚫 Dos del Pacífico quedaron FUERA porque sí hay evidencia positiva de impuesto:**

| País | Motivo |
|---|---|
| 🇨🇰 Islas Cook | Régimen **confirmado** para no residentes, VAT 15% |
| 🇵🇼 Palaos | GST 10% desde 2023 |

Hay un test que los mantiene fuera: si alguien los agrega "para completar el Pacífico", estaría
vendiendo sin alta donde sí hay régimen.

Elegidos por razones opuestas: **Marruecos por calidad** (~90% de penetración de internet, el doble
de ingreso per cápita que Nigeria) y **Nigeria por volumen** (~230 M de habitantes y una de las
culturas de creadores más fuertes del mundo).

⚠️ **Ambos tenían control de cambios que impedía comprar en el extranjero, y ambos se relajaron:**

* 🇳🇬 Las tarjetas naira se **reactivaron en jul-2025** tras tres años suspendidas. Los bancos
  ponen sus propios topes (GTBank pasó de US$1.000 a US$6.000 por trimestre). No es limitante
  para el ticket de Vibra.
* 🇲🇦 La dotación anual de e-commerce subió a **20.000 dirhams (~US$2.000)** el 1-ene-2026.
  Agotada la cuota, el banco rechaza los pagos internacionales.

⚠️ **Marruecos se llega a tiempo** (su régimen entró en vigor el 11-jun-2026, hace dos meses).
**Nigeria se llega tarde**: la obligación arrancó el 1-ene-2026, mismo caso que Brasil. Confirmar
el régimen de multas antes de dar el alta.

**🚫 Los otros cuatro africanos quedaron fuera:**

| País | Motivo |
|---|---|
| 🇰🇪 Kenia | **M-Pesa domina los pagos, no la tarjeta.** Mismo problema que India con UPI |
| 🇹🇿 Tanzania | 18% de IVA **más 3% sobre ingreso bruto**, que sale del margen |
| 🇺🇬 Uganda | El más pobre y menos conectado |
| 🇬🇭 Ghana | Mercado decente, pero exige facturación electrónica certificada (E-VAT) |

**🇸🇦 Arabia Saudita:** la facturación electrónica (Fatoora) **NO aplica a no residentes**, que es
la parte más pesada de su régimen. El representante fiscal es **opcional** desde jul-2025, pero sin
él ZATCA pediría garantía bancaria — ⚠️ **monto sin confirmar**, las fuentes se contradicen.

**🇰🇷 Corea del Sur:** el alta debe hacerse **dentro de los 20 días** desde que se empieza a operar.

### 🚨 🇻🇳 Vietnam: el CIT se recupera por el cargo de conversión, no absorbiéndolo

Vietnam cobra **dos** impuestos, como Uruguay:

| | Tasa | Quién lo paga |
|---|---|---|
| **VAT** | 10% | El comprador — es el de la tabla |
| **CIT** | 5% sobre ingreso **BRUTO** | Vibra, de su margen |

🚨 **DECISIÓN (Luis, 2026-08-11): a diferencia de Uruguay, ese 5% NO se absorbe.** Se recupera
subiendo el **cargo de conversión del dong al 7%** (2% estándar + 5% del CIT).

**No se desglosa al comprador: es precio, no impuesto.** El comprador vietnamita paga un poco más
y el servicio se puede ofrecer, en vez de no ofrecerlo.

Vive en `FX_CONVERSION_FEE_BY_CURRENCY` (`lib/currency/catalog.ts`, con copia en el backend y test
de paridad). La tasa fiscal de Vietnam **sigue siendo 10%** — el 7% no la contamina, y hay un test
que lo verifica.

⚠️ Si Vietnam no se registra, los bancos e intermediarios retienen y enteran mensualmente. Es la
vía del incumplimiento, no una alternativa — mismo patrón que Perú.

### 🚫 De Asia NO se integraron

| País | Motivo |
|---|---|
| 🇮🇳 India | Representante fiscal obligatorio **y** UPI —el método dominante— inaccesible desde México. Solo llegarías a la fracción con tarjeta internacional, con rechazos altos por el 2FA del RBI |
| 🇧🇭 Baréin | Representante fiscal obligatorio |
| 🇴🇲 Omán | Sin confirmar si exige representante |

🚨 **Montenegro usa el EURO pero NO es de la UE.** El OSS no lo cubre: necesita su propio
registro. Tener la moneda de la UE no implica estar en su régimen fiscal. Hay un test que lo fija.

🚨 **El umbral británico de £90.000 NO aplica.** Es solo para empresas **establecidas** en UK.
Para un extranjero (*Non-Established Taxable Person*) es **cero**, desde la primera libra.

**🚫 Tres europeos quedaron fuera a propósito (decisión de Luis, 2026-08-11):**

| País | Motivo |
|---|---|
| 🇲🇰 Macedonia del Norte | Exige **representante fiscal local solidariamente responsable** — alguien allá responde con su patrimonio — para un mercado de 1,8 millones |
| 🇨🇭 Suiza · 🇱🇮 Liechtenstein | Los CHF 100.000 son de facturación **mundial**, no suiza: el umbral no protege. Además exigen representante fiscal, y basta **una** venta B2C para que todas las ventas suizas queden gravadas |

Hay un test que verifica que los tres sigan fuera.

Helper: `platformCollects(taxName, taxRate, currency, registered)`. Sin estado intermedio: o
cobra (`registered`) o bloquea la venta (`cannot_sell`). **No existe "vender sin cobrar"** como en
los países con umbral — aquí eso sería ilegal, no una zona gris.

### 🚨 Lista de verificación previa a `sk_live`

```ts
export const ALTAS_PENDIENTES = [
  "BR", "CO", "CL", "PE", "UY",   // LatAm
  "GB", "TR", "RS", "AL", "ME", "MD",  // Europa no comunitaria
  "KR", "VN", "AE", "SA",              // Asia y Golfo
  "NG", "MA",                          // África
  "PF",                                // Oceanía
];
```

Mientras esa lista tenga entradas, hay países **cobrando un impuesto que Vibra todavía no puede
enterar**. En modo prueba es inocuo. En producción sería quedarse con dinero ajeno.

**Al completar un alta: borrar su entrada de `ALTAS_PENDIENTES`.** Cuando quede vacía, se puede
pasar a llaves reales sin deuda. Hay un test que verifica que la lista coincida con los países
encendidos.

Interruptores individuales: `BR_CNPJ_REGISTERED`, `CO_DIAN_REGISTERED`, `CL_SII_REGISTERED`,
`PE_SUNAT_REGISTERED`, `UY_DGI_REGISTERED`, `GB_HMRC_REGISTERED`, `TR_GIB_REGISTERED`,
`RS_PURS_REGISTERED`, `AL_TATIME_REGISTERED`, `ME_UPC_REGISTERED`, `MD_SFS_REGISTERED`,
`KR_NTS_REGISTERED`, `VN_GDT_REGISTERED`, `AE_FTA_REGISTERED`, `SA_ZATCA_REGISTERED`,
`NG_FIRS_REGISTERED`, `MA_DGI_REGISTERED`, `PF_DICP_REGISTERED`. En `false` el país pasa a `cannot_sell` y el checkout lo rechaza.

### 🇧🇷 Brasil: la única tasa de la tabla que cambia con el calendario

| Año | CBS | IBS | Total |
|---|---|---|---|
| **2026 (hoy)** | 0,9% | 0,1% | **1,0%** |
| 2027 | ~8,8% (plena; mueren PIS/COFINS) | 0,1% | ~8,9% |
| 2029–2032 | 8,8% | Sube gradual, bajan ICMS e ISS | Transición |
| 2033 | 8,8% | 17,7% | **26,5%** |

Hay un test que fija el 1%. Quien lo vea y lo "corrija" al 26,5% estaría cobrándoles a los
brasileños **26 veces de más, siete años antes de tiempo**.

⚠️ El registro venció el **1 de agosto de 2026**. Y no registrarse no es no pagar: la CBS/IBS se
cobra sobre la **remesa al exterior a tasas de referencia**, más multa.

### 🇨🇴 Colombia: la opción de no recaudar sigue disponible, pero se gasta una sola vez

La **Res. DIAN 000049/2019** permite acogerse a que retengan los emisores de tarjeta — y entonces
Vibra **no presenta declaración**. Se dejó como `platform` porque esa opción todavía no se ha
tomado.

* **Art. 1°:** el alta NO es un formulario. Es una petición por el canal **PQSR** de la DIAN.
* **Art. 5°:** la DIAN publica por resolución un listado **taxativo** con fecha de aplicación.
* **Art. 2°:** 🚨 el cambio de modalidad es **por ÚNICA VEZ**. No gastarlo por accidente.

Sigue abierta **D-11**: si ese 19% se le suma al comprador o se le descuenta a Vibra.

### 🇺🇾 Uruguay: el único donde un impuesto sale de TU margen

Uruguay cobra **dos** impuestos, y solo uno cabe en el modelo:

| | Qué es | Quién lo paga |
|---|---|---|
| **IVA 22%** | Impuesto al consumo | **El comprador** — es el que está en la tabla |
| **IRNR 12%** | Impuesto a la **renta** del no residente | **Vibra**, de su propio ingreso |

🚨 **DECISIÓN FINAL (2026-08-11): se cobra SOLO el 22% y Vibra ABSORBE el IRNR.**
Sobre una venta de $100 de base, el margen queda en **$13 en vez de $25**.

**Se probó recuperarlo vía el cargo de conversión —UYU al 14%— y se descartó.** El total subía a
**$143** por cada $100 de base: el país más caro de toda la tabla, 36% por encima de Argentina.
La razón es que el **IVA del 22% se calcula DESPUÉS del ajuste y lo amplifica**. Se prefirió
absorber el impuesto antes que cobrarle eso al comprador uruguayo.

⚠️ **Si alguien reconsidera subir el cargo de conversión del UYU, ese es el número a revisar.**
Hay un test que fija el 2% con esta explicación. Contrasta con 🇻🇳 Vietnam, donde el ajuste sí se
aplicó (7%) porque su IVA del 10% amplifica mucho menos.

El IRNR **no aparece en `COUNTRY_TAX_CONFIG` y es correcto que no aparezca** — ese campo modela lo
que se le cobra al comprador. Hay un test que impide "completar" la tasa a 34%: hacerlo le cobraría
al uruguayo un impuesto que no le toca pagar.

**El Convenio México–Uruguay** (vigente desde 2011) puede reducirlo, pero no automáticamente:

| Artículo | Cubre | Resultado |
|---|---|---|
| **Art. 7** Beneficios empresariales | Sesión 1-a-1, saludos, consejos, tiempo contigo | **0%** (no hay EP en Uruguay) |
| **Art. 12** Regalías, tope **10%** | Tickets de live, VOD, post premium — la definición incluye *"derecho de autor sobre obra artística, incluidas películas cinematográficas"* | 10% |
| **Art. 20** Otras rentas | Lo que no encaje arriba | ⚠️ **Uruguay SÍ puede gravar** |

⚠️ El Art. 20 de este tratado **no** sigue el modelo OCDE: dice que las otras rentas *"podrán
someterse a imposición en ese otro Estado"*. Lo que no se encuadre en el Art. 7 se cae ahí y queda
gravado igual.

Reclamar el beneficio exige certificado de residencia fiscal del SAT (**Decreto 323/012** +
**Resolución DGI 2.456/2012**), normas escritas para la retención B2B — autoliquidando, el
procedimiento no está claro.

**Lo bueno del régimen uruguayo:** declaración **trimestral** (mejor que Perú y Brasil, mensuales),
**se puede pagar en dólares** —lo que evita el doble cambio de divisa— y **no exige representante
local**. Si se opta por dólares hay que mantenerlo **3 años**.

**Contexto:** 30+ plataformas registradas ante DGI pagaron más de US$50 millones en un año
(Netflix, Spotify, Airbnb, Booking, Uber). De Kick, Twitch y OnlyFans no hay registro público —
operan ahí sin figurar. No es precedente a seguir: Uruguay no tiene umbral.

### 🇵🇪 Perú: el respaldo bancario no es una alternativa

Si Vibra no se registra, la SUNAT la publica por Decreto Supremo en un **listado de incumplidos**,
le quita la condición de agente y la responsabilidad pasa a los facilitadores de pago. El comprador
paga igual, pero Vibra queda en una lista pública y sale con intereses y multas.

---

## 6.12 🚨 PENDIENTE UE: territorios FUERA del territorio IVA de la Unión (2026-08-11)

> **Guardado para cuando se retome Europa.** No es una expansión: es un **error de cobro en países
> que YA están encendidos**.

Varios territorios pertenecen a un Estado miembro —y por tanto resuelven a su código de país— pero
están **fuera del territorio IVA de la UE**. **El OSS no los cubre.**

| Territorio | País | Código que resuelve | Población | Su impuesto real |
|---|---|---|---|---|
| **Canarias** | 🇪🇸 España | `ES` | **~2,2 M** | **IGIC 7%**, no IVA |
| Ceuta y Melilla | 🇪🇸 España | `ES` | ~170.000 | IPSI |
| Guadalupe · Martinica · Guayana Francesa · Reunión · Mayotte | 🇫🇷 Francia | `FR` | **~2,8 M** | Octroi de mer |
| Åland | 🇫🇮 Finlandia | `FI` | ~30.000 | Régimen propio |

### El problema concreto

Hoy a un comprador en Tenerife se le cobra **21% de IVA español** —porque su país es `ES`— y se
declararía por el **OSS**. Las dos cosas están mal: Canarias no está en el territorio IVA de la UE
y el OSS no la alcanza.

Son **~5,2 millones de personas**, más que Irlanda o Croacia.

### Es la CUARTA vez que aparece la misma causa raíz

`resolveCountry.ts` solo distingue **país**, no subdivisión (**D-16**). Ya lo pedían:

| Caso | Qué bloquea |
|---|---|
| 🇨🇦 Canadá | Registrarse (tasa 5–15% por provincia) |
| 🇺🇸 EE. UU. | Registrarse (tasa por estado) |
| 🇺🇦 Ucrania | Entrar (embargo regional OFAC) |
| **🇪🇺 Territorios UE** | **Nada — ya está cobrando mal HOY** |

Los tres primeros bloquean el futuro. **Este es dinero mal cobrado en mercados vivos.**

### 🚨 CORRECCIÓN (2026-08-11): NO a todos les corresponde cero

La primera versión de esta ficha decía que a los nueve territorios habría que cobrarles cero.
**Solo es cierto para dos.** Lo que aplica de verdad:

| Territorio | ISO propio | TASA correcta | Impuesto | Alta necesaria | Hoy le cobramos |
|---|---|---|---|---|---|
| 🇬🇫 Guayana Francesa | ✅ `GF` | **0%** | TVA **no aplicable** | Ninguna | ~~IVA francés 20%~~ ✅ **corregido** |
| 🇾🇹 Mayotte | ✅ `YT` | **0%** | TVA **no aplicable** | Ninguna | ~~IVA francés 20%~~ ✅ **corregido** |
| 🇬🇵 Guadalupe | ✅ `GP` | **8,5%** | TVA DOM | DGFiP | ❌ IVA francés 20% |
| 🇲🇶 Martinica | ✅ `MQ` | **8,5%** | TVA DOM | DGFiP | ❌ IVA francés 20% |
| 🇷🇪 Reunión | ✅ `RE` | **8,5%** | TVA DOM | DGFiP | ❌ IVA francés 20% |
| Canarias | ❌ resuelve `ES` | **7%** | IGIC | **Agencia Tributaria Canaria** | ❌ IVA español 21% |
| Ceuta | ❌ resuelve `ES` | Variable | IPSI | Sin régimen conocido para extranjeros | ❌ IVA español 21% |
| Melilla | ❌ resuelve `ES` | Variable | IPSI | Sin régimen conocido para extranjeros | ❌ IVA español 21% |
| Åland | ❌ resuelve `FI` | Territorio tercero | Fuera del IVA comunitario | Sin resolver | ❌ IVA finlandés 24% |

**Canarias no es cero: es IGIC 7%**, y los servicios digitales a consumidores canarios tributan por
IGIC **sin importar dónde esté el prestador**, con registro propio ante la Agencia Tributaria
Canaria — aparte del OSS y aparte de España.

**Guadalupe, Martinica y Reunión tampoco: TVA 8,5%.** Son territorios de exportación respecto a
Francia metropolitana pero aplican su propio IVA.

**Åland es "territorio tercero"** para el IVA comunitario, comparable a una jurisdicción fuera de
la UE. Dentro de Åland aplica el IVA finlandés; desde fuera, el OSS no lo cubre.

### ✅ Lo que YA se arregló (2026-08-11)

**Guayana Francesa (`GF`) y Mayotte (`YT`) tienen código ISO propio**, así que la geolocalización
por IP los distingue de Francia. Se les agregó fila con `noConsumptionTax` y ya cobran **cero**.

🚨 **Limitación:** nuestra regla de resolución da preferencia a la TARJETA sobre la IP. Un
comprador en Mayotte con tarjeta de un banco francés metropolitano reportará `FR` y se le cobrará
el 20% igual. Estas filas solo corrigen cuando la IP manda.

### ✅ Segunda tanda de correcciones (2026-08-11)

**🇬🇵🇲🇶🇷🇪 Guadalupe, Martinica y Reunión** — integrados con **TVA 8,5%** (no cero, no 20%).

> ✅ **UN SOLO REGISTRO PARA LOS TRES.** El punto de contacto para no residentes de fuera de la UE
> es el **SIEE** (Service des Impôts des Entreprises Étrangères), Noisy-le-Grand, que da un número
> de TVA francés y cubre los DOM. Comparten el interruptor `FR_DOM_REGISTERED`.

**🇮🇨 Canarias** — fila agregada con el dato correcto, pero **HOY NO SE ACTIVA**:

| Dato | Valor |
|---|---|
| Impuesto | **IGIC 7%** — grava los servicios digitales a consumidores canarios **sin importar dónde esté el prestador** |
| **Umbral** | ✅ **€100.000** de base imponible del año anterior |
| Alta | **Modelo 400** (censal) ante la Agencia Tributaria Canaria |
| Declaración | **Modelo 420, trimestral** |

El umbral es la buena noticia: por debajo de €100.000 **no hay obligación de darse de alta**, así
que lo correcto hoy sería cobrarles **cero**, no el 21% español.

🚨 La fila usa el código `IC` (ISO 3166-1 excepcionalmente reservado), que **nadie emite en la
práctica**: un canario resuelve como `ES`. Se deja lista para que el día que exista resolución por
subdivisión (D-16) o detección por código postal `35xxx`/`38xxx`, Canarias funcione sin volver a
investigar.

### ✅ RESUELTO (2026-08-11): corrección por subdivisión

**La geolocalización ya daba la región — la estábamos descartando.**

* `ipwho.is` devuelve `region_code` junto al `country_code`. El backend leía solo el segundo.
* Vercel manda `x-vercel-ip-country-region` con el código ISO 3166-2. El middleware lo ignoraba.

Se agregó `SUBDIVISION_TAX_OVERRIDES` en `backend/src/tax/resolveCountry.ts`, con espejo en
`lib/tax/subdivisions.ts` y test de paridad:

| Subdivisión | Resuelve como | Impuesto | Antes cobrábamos |
|---|---|---|---|
| `ES-CN` Canarias | **IC** | IGIC 7%, umbral €100.000 → hoy **cero** | ❌ 21% español |
| `ES-CE` Ceuta | **EA** | IPSI, sin régimen para extranjeros → **cero** | ❌ 21% español |
| `ES-ML` Melilla | **EA** | IPSI, íd. | ❌ 21% español |

La península sigue resolviendo como `ES` y cobrando su 21%. Hay tests que lo verifican en las
dos direcciones.

### ⬜ Lo que sigue sin resolver

* **🇬🇵🇲🇶🇷🇪 Guadalupe, Martinica y Reunión** — tienen ISO propio, pero cobrarles su 8,5% exige
  alta ante la DGFiP. Se les podría poner `cannot_sell` o cobrar cero mientras tanto.
* **Åland** — resuelve como `FI` y su régimen no está resuelto. Se dejó fuera del mapa de
  subdivisiones a propósito: haría falta investigarlo antes de decidir qué cobrarle.

**Estado de D-22: 8 de 9 resueltos.** Solo queda Åland.

### La buena noticia: es el más fácil de los cuatro

Se resuelve con **códigos postales**, sin geolocalización fina:

* 🇪🇸 Canarias `35xxx` y `38xxx` · Ceuta `51xxx` · Melilla `52xxx`
* 🇫🇷 Guadalupe `971xx` · Martinica `972xx` · Guayana `973xx` · Reunión `974xx` · Mayotte `976xx`
* 🇫🇮 Åland `22xxx`

⚠️ Requiere capturar el código postal de facturación, que hoy no siempre se pide.

Queda como **D-22**.

---

## 6.13 🏝️ Caribe (2026-08-11)

Se integraron 9. ⚠️ **Belice se había ignorado por completo** en las listas anteriores: aquellas eran
de "Latinoamérica" en sentido **lingüístico**, y Belice es anglófono. Geográficamente es
Centroamérica. Lo mismo pasó con todo el Caribe.

### ✅ Con umbral

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|
| 🇸🇷 Surinam | SRD | Neerlandés | 10% | VAT | Nadie (bajo umbral) | Belastingdienst | **SRD 500.000** (~US$13.000) | ✅ Activo |

### 🟢 Sin régimen para extranjeros

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Estatus |
|---|---|---|---|---|---|---|
| 🇧🇿 Belice | BZD | Inglés | 12,5% | GST | Nadie | ✅ Activo — **verificado** |
| 🇹🇹 Trinidad y Tobago | TTD | Inglés | 12,5% | VAT | Nadie | ✅ Activo — ⚠️ **ambiguo** |
| 🇯🇲 Jamaica | JMD | Inglés | 15% | GCT | Nadie | ✅ Activo — 🚨 **cambia en 2027** |
| 🇬🇩 Granada | XCD | Inglés | 15% | VAT | Nadie | ✅ Activo — ⚠️ propuesta en curso |
| 🇰🇾 Islas Caimán | KYD | Inglés | **0%** | No existe | Nadie | ✅ Activo |
| 🇧🇲 Bermudas | BMD | Inglés | **0%** | No existe | Nadie | ✅ Activo |
| 🇹🇨 Turcas y Caicos | **USD** | Inglés | **0%** | No existe | Nadie | ✅ Activo |
| 🇻🇬 Islas Vírgenes Británicas | **USD** | Inglés | **0%** | No existe | Nadie | ✅ Activo |

### 🚨 Jamaica: el único país con FECHA conocida de cambio

Su **GCT del 15% sobre servicios digitales del exterior está anunciado y sería efectivo a
principios de 2027**. Hoy no hay régimen, así que entra como `noDigitalRegime` y vende a cero.

Cuando entre en vigor hay que pasarlo a `platformCollects` con alta ante la TAJ. Es el único caso
de toda la tabla donde se sabe la fecha por adelantado. Queda como **D-23**.

### ⚠️ Trinidad y Tobago es el más ambiguo de los 103

**No hay legislación específica** para servicios digitales, pero algunas fuentes sugieren que una
empresa extranjera igual tendría obligación de registro sin importar la facturación. Se integró
como sin régimen porque no se encontró norma que lo exija — **si Trinidad gana volumen, consultar
con asesor local antes de seguir vendiendo**.

### 🏝️ Segunda tanda del Caribe y territorios americanos (2026-08-11)

Investigación profunda por bloques. **13 integrados**, 6 fuera por exigir alta.

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇵🇷 Puerto Rico | USD | Español/Inglés | 11,5% | IVU | Nadie (bajo umbral) | Al registrarse | Hacienda PR | **US$100.000 o 200 transacciones** | ✅ Activo |
| 🇻🇮 Islas Vírgenes EE. UU. | USD | Inglés | 5% | Gross Receipts | Nadie | Ninguna | **No adoptó nexo económico** | No aplica | ✅ Activo |
| 🇭🇹 Haití | HTG | Francés/Criollo | 10% | TCA | Nadie | Ninguna | Sin régimen digital | No aplica | ✅ Activo |
| 🇧🇶 Bonaire | USD | Neerlandés | 8% | ABB | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇱🇨 Santa Lucía | XCD | Inglés | 12,5% | VAT | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇻🇨 San Vicente y las Granadinas | XCD | Inglés | 16% | VAT | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇦🇬 Antigua y Barbuda | XCD | Inglés | 17% | ABST | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇰🇳 San Cristóbal y Nieves | XCD | Inglés | 17% | VAT | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇩🇲 Dominica | XCD | Inglés | 15% | VAT | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇦🇮 Anguila | XCD | Inglés | 13% | GST | Nadie | Ninguna | Sin régimen para extranjeros | No aplica | ✅ Activo |
| 🇲🇸 Montserrat | XCD | Inglés | 0% | No existe | Nadie | Ninguna | No existe | No aplica | ✅ Activo |
| 🇬🇱 Groenlandia | DKK | Groenlandés/Danés | 0% | No existe | Nadie | Ninguna | No existe | No aplica | ✅ Activo |
| 🇵🇲 San Pedro y Miquelón | EUR | Francés | 0% | No existe | Nadie | Ninguna | No existe | No aplica | ✅ Activo |

**Solo Haití trajo moneda nueva (HTG).** El resto reutiliza USD, XCD, DKK y EUR.

### 🚨 Puerto Rico NO estaba cubierto por la fila de Estados Unidos

Es el hallazgo que más valía: PR tiene **su propio sistema fiscal** (Hacienda PR, IVU 11,5%) con
umbral Wayfair propio de **US$100.000 o 200 transacciones**. Antes resolvía a `PR`, esa fila no
existía y **simplemente no se le vendía** — a 3,2 millones de hispanohablantes.
Hay un test que verifica que no herede la fila de `US`. Cierra **D-24**.

### 🏝️ El Caribe oriental está limpio, y se verificó

Se buscó un **marco OECS armonizado y NO existe**: cada país legisla por su cuenta. El único que
se movió fue Granada, con una propuesta que aún no es ley. Los siete restantes no tienen régimen
para proveedores extranjeros, y **todos comparten XCD**.

### 🇬🇱🇵🇲 Groenlandia y San Pedro y Miquelón

Ninguno tiene IVA ni impuesto general al consumo, y **ambos están fuera del territorio IVA de la
UE** pese a su vínculo con Dinamarca y Francia: no los cubre el OSS ni les aplica el IVA de esos
países. Hay un test que lo fija.

### 🔴 Del Caribe NO se integraron

| País | Motivo |
|---|---|
| 🇧🇧 Barbados | VAT 17,5%, régimen para extranjeros desde dic-2019, **umbral cero** |
| 🇨🇼 Curazao | **OB 6%** sobre servicios digitales de extranjeros, umbral cero, declaración **mensual** |
| 🇸🇽 Sint Maarten | **TOT 5%**, no residentes se consideran domiciliados ante la Inspección, **mensual incluso declarando cero** |
| 🇧🇸 Bahamas | VAT 10%, régimen vigente, umbral cero (⚠️ fuentes en conflicto) |
| 🇦🇼 Aruba | BBO/BAVP/BAZV 7% sobre servicios electrónicos desde ene-2023, umbral cero |
| 🇬🇾 Guyana | VAT 14% + **representante fiscal obligatorio** |
| 🇭🇹 Haití | Sin verificar. Crisis de seguridad |
| 🇨🇺 Cuba | Embargo integral OFAC |
| Caribe oriental (7) · territorios menores | Sin verificar |

✅ **🇵🇷 Puerto Rico se integró** con fila propia — ver arriba. **D-24 cerrada.**

---

## 6.14 🏔️ Microestados y territorios europeos (2026-08-11)

| País | Moneda | Idioma | TASA | Impuesto | Recaudación | Declaración | Alta fiscal | Umbral | Estatus |
|---|---|---|---|---|---|---|---|---|---|
| 🇲🇨 Mónaco | EUR | Francés | 20% | TVA francés | **Vibra** | Vía OSS | **Ninguna nueva** | Cero | ✅ Activo — **cobra** |
| 🇯🇪 Jersey | GBP | Inglés | 5% | GST | Nadie (bajo umbral) | Al registrarse | Revenue Jersey | **£300.000**/12m móviles (~US$385.000) | ✅ Activo |
| 🇦🇩 Andorra | EUR | Catalán | **4,5%** | IGI | Nadie (bajo umbral) | Al registrarse | NRT — régimen digital desde 2013 | **€40.000**/año | ✅ Activo |
| 🇸🇲 San Marino | EUR | Italiano | 17% | Imposta monofase | Nadie | Ninguna | **No alcanza servicios** | No aplica | ✅ Activo |
| 🇫🇴 Islas Feroe | DKK | Feroés/Danés | 25% | MVG | Nadie | Ninguna | Solo con actividad establecida ahí | DKK 50.000 (locales) | ✅ Activo |
| 🇬🇮 Gibraltar | GIP | Inglés | **0%** | No existe | Nadie | Ninguna | No existe | No aplica | ✅ Activo |
| 🇻🇦 Ciudad del Vaticano | EUR | Italiano | **0%** | No existe | Nadie | Ninguna | No existe | No aplica | ✅ Activo |
| 🇬🇬 Guernsey | GBP | Inglés | **0%** | No existe | Nadie | Ninguna | No existe *(GST propuesto)* | No aplica | ✅ Activo |
| 🇸🇯 Svalbard | NOK | Noruego | **0%** | No existe | Nadie | Ninguna | Exento del IVA noruego | No aplica | ✅ Activo |

Solo Gibraltar trajo moneda nueva (GIP, anclada 1:1 a la esterlina).

### 🚨 Mónaco usa `eu()` y NO es un atajo

Mónaco **no es miembro de la UE**, pero para efectos de IVA **es territorio francés**: misma base,
misma tasa (20%), administrado por la DGFiP. El **Art. 7 de la Directiva del IVA** asimila las
operaciones con Mónaco a operaciones con Francia.

Por eso **el registro OSS ya lo cubre** y no hace falta alta nueva — es el único país que se sumó
cobrando impuesto sin agregar una entrada a `ALTAS_PENDIENTES`.

Usar `eu()` además es correcto en comportamiento: si `EU_OSS_REGISTERED` se apaga, Mónaco debe
apagarse con él, porque depende exactamente del mismo registro.

> 🚨 **Es el CONTRARIO de Montenegro**, que usa euro pero **no** está en el régimen comunitario y
> necesita su propio registro. **Moneda y territorio fiscal son cosas distintas.** Hay un test que
> contrasta los dos casos.

### 🚨 Jersey tiene el umbral más alto del mundo

**£300.000 en 12 meses móviles (~US$385.000)**, por encima de Sudáfrica (~US$125.000), que era el
récord. Y **Andorra tiene la tasa más baja de Europa**: IGI 4,5%.

### 🟢 Impuesto que existe pero no alcanza a Vibra

* **🇸🇲 San Marino** — su imposta monofase del 17% grava importación de **bienes** y
  **expresamente no se extiende a prestaciones de servicios**. No es que falte régimen: el
  impuesto no llega hasta aquí.
* **🇫🇴 Islas Feroe** — MVG 25% con umbral DKK 50.000, pero la obligación solo alcanza a negocios
  con **actividad establecida** en territorio feroés. Están fuera del IVA danés pese a ser
  territorio de Dinamarca.

### 🚫 No se integraron

| País | Motivo |
|---|---|
| 🇽🇰 Kosovo | VAT 18% con **representante fiscal obligatorio** |
| 🇮🇲 Isla de Man | Forma parte del **área IVA del Reino Unido**: entra cuando entre UK |

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
| 🌏 Asia-Pacífico bajo umbral | JP · MY · PH · TH · AU · JO · ID · NZ · TW · SG | ✅ Activos — **vigilancia manual** | No — hasta cruzar el umbral |
| 🟢 Sin impuesto al consumo | HK · QA · KW · **GU** | ✅ Activos — **sin reloj** | No — no existe el impuesto |
| 🌊 Oceanía | PG (sin régimen) · NC · FJ (bajo umbral) | ✅ Activos | No |
| 🌍 África | ZA · EG (bajo umbral) | ✅ Activos — **vigilancia manual** | No — hasta cruzar el umbral |
| 🇨🇦 Canadá | CA | ✅ Activo — ⚠️ **exposición SK/MB aceptada** | No — hasta cruzar el umbral |
| 🇺🇸 Estados Unidos | US | ✅ Activo — sin exposición | No — hasta cruzar el umbral de algún estado |
| 🌎 LatAm con alta obligatoria | BR · CO · CL · PE · UY | 🟡 **Encendidos, alta PENDIENTE** | **Sí** — 1% BR · 19% CO · 19% CL · 18% PE · 22% UY |
| 🌍 Europa no-UE con alta obligatoria | GB · TR · RS · AL · ME · MD | 🟡 **Encendidos, alta PENDIENTE** | **Sí** — 20% salvo ME 21% |
| 🌏 Asia y Golfo con alta obligatoria | KR · VN · AE · SA | 🟡 **Encendidos, alta PENDIENTE** | **Sí** — 10% KR · 10% VN · 5% AE · 15% SA |
| 🌍 África con alta obligatoria | NG · MA | 🟡 **Encendidos, alta PENDIENTE** | **Sí** — 7,5% NG · 20% MA |
| 🌊 Oceanía con alta obligatoria | PF | 🟡 **Encendido, alta PENDIENTE** | **Sí** — 13% |
| 🏝️ Microestados del Pacífico | 13 (TO·SB·VU·WS·KI·NR·TV·NU·WF·FM·MH·AS·MP) | ✅ Activos — ⚠️ sin verificar | No |
| 🏝️ Caribe | SR (umbral) + BZ·TT·JM·GD·KY·BM·TC·VG | ✅ Activos | No |
| 🏝️ Caribe y territorios (2ª) | PR (umbral) + VI·HT·BQ·LC·VC·AG·KN·DM·AI·MS·GL·PM | ✅ Activos | No |
| 🏔️ Microestados europeos | **MC (cobra vía OSS)** + JE·AD (umbral) + SM·FO·GI·VA·GG·SJ | ✅ Activos | Solo Mónaco — 20% |
| 🌍 Cáucaso | AZ (umbral US$10.000, régimen desde 1-sep-2026) | ✅ Activo | No |
| 🇫🇷 Territorios sin TVA | GF · YT | ✅ Activos — **D-22 corregido** | No |
| 🇫🇷 DOM con TVA propia | GP · MQ · RE | 🟡 Activos, **alta SIEE pendiente** | **Sí** — 8,5% |
| 🇮🇨 Canarias · 🇪🇦 Ceuta y Melilla | IC · EA | ✅ **ACTIVOS** vía corrección de subdivisión | No — Canarias bajo umbral €100.000; IPSI sin régimen |
| ⬜ Resto de LatAm | CL · CO · PE · UY · BR | Sin ficha — **no cobrables** | — |
| ⬜ Resto de Europa no-UE | CH · LI · MK | Fuera a propósito — representante fiscal / umbral mundial | — |
| 🚫 Excluidos a propósito | UA (embargo regional) · RU · BY · CU (sanciones) · IL (decisión de Luis) | No integrar | — |
| ⬜ Resto de Asia / Medio Oriente | IN · SA · KR · VN · BH · OM · AE | Sin ficha — umbral cero | — |
| ⬜ Oceanía restante | PF (umbral cero) + microestados | Sin ficha — no compensan | — |
| ⬜ África restante | MA · KE · GH · NG · TZ · UG (umbral cero) + resto sin verificar | Sin ficha | — |
| 🚫 África — Stripe no procesa | SD · SS · SO · ER · LY + riesgo: ZW · BI · CF · CD · GN · GW · ML | No integrar | — |
| ⬜ Resto del mundo | — | Sin ficha — **no cobrables** | — |

**Total cobrable: 133 jurisdicciones.** De ellas, **50 cobran impuesto** (MX + 27 UE + 5 LatAm + 6 Europa no comunitaria + 4 Asia/Golfo + 2 África). Un país sin fila en `COUNTRY_TAX_CONFIG` no es cobrable y el
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
| ~~D-09~~ | ~~LatAm pendiente~~ **Cerrada 2026-08-11: los 17 países de LatAm están integrados** | ✅ |
| **D-19** | 🇺🇾 ¿El Convenio México–Uruguay elimina o reduce el IRNR 12%? Depende de encuadrar cada servicio en Art. 7 (0%), Art. 12 (10%) o Art. 20 (12%). Hoy ese 12% sale del margen | Fiscalista MX/UY |
| **D-18** | 🚨 **Completar las 18 altas de `ALTAS_PENDIENTES` ANTES de pasar a `sk_live`.** Hoy cobran en modo prueba sin poder enterar | Luis |
| **D-20** | 🇸🇦 Confirmar si ZATCA exige garantía bancaria a un no residente sin representante fiscal, y por cuánto. Las fuentes se contradicen | Luis / asesor SA |
| **D-21** | 🇻🇳 Confirmar las tasas presuntas de Vietnam (VAT 10% / CIT 5%) contra normativa directa. Hoy vienen de una sola fuente especializada | Fiscalista VN |
| **D-11** | 🇨🇴 **Una sola pregunta abierta:** ¿la retención en la fuente del sistema alternativo SE SUMA al comprador o se DESCUENTA de lo que cobra Vibra? Vale 19% de cada venta colombiana. **RESUELTO 2026-08-11:** el cambio de modalidad SÍ es posible pero **por ÚNICA VEZ** (Art. 2° Res. DIAN 000049/2019) → no gastar ese cambio: entrar DIRECTO al sistema de retención. El alta NO es un formulario: es una petición por el canal **PQSR** de la DIAN (Art. 1°), y la DIAN debe publicarte por resolución en un listado taxativo con fecha de aplicación (Art. 5°) | Fiscalista CO |
| ~~D-12~~ | ~~🇺🇾 Confirmar IRNR y quién retiene~~ **Resuelta 2026-08-11:** recauda Vibra (no hay retención bancaria para B2C), declaración trimestral, se puede pagar en USD. El IRNR sigue abierto en D-19 | ✅ |
| **D-13** | Contador de ventas acumuladas por país + alerta al 80% del umbral. **19 países** encendidos con vigilancia manual (NO · IS · BA · JP · MY · PH · TH · AU · JO · ID · NZ · TW · SG · NC · FJ · ZA · EG · CA · US); el contador la reemplazaría. Cuantos más umbrales, menos sostenible es recordarlos | Luis + Claude |
| ~~D-14~~ | ~~🇺🇦 ¿Entrar a Ucrania?~~ **Resuelta 2026-08-08: NO.** Requeriría discriminación regional (Crimea/Donetsk/Lugansk bajo embargo OFAC) que no existe | ✅ |
| **D-15** | 🇨🇦 Saskatchewan y Manitoba: sin umbral, obligación desde la venta 1. Exposición ~6,6% de Canadá **aceptada a conciencia**. Revisar si Canadá gana peso | Luis |
| **D-16** | Resolución por **subdivisión** en `resolveCountry.ts`. Bloquea registrarse en 🇺🇸 y 🇨🇦, entrar a 🇺🇦, y **cobrar bien en los territorios UE fuera del IVA comunitario (D-22)**. **CUATRO** casos ya la piden | Luis + Claude |
| **D-23** | 🇯🇲 Jamaica anuncia GCT 15% sobre digitales del exterior para **principios de 2027**. Único país con fecha conocida: pasar a `platformCollects` + alta ante la TAJ cuando entre en vigor. Ver §6.13 | Luis |
| ~~D-24~~ | ~~🇵🇷 Puerto Rico sin fila~~ **Cerrada 2026-08-11: fila propia con IVU 11,5% y umbral Wayfair de US$100.000 o 200 transacciones** | ✅ |
| ~~D-22~~ | ~~Territorios fuera del IVA de la UE cobrando mal~~ **RESUELTA 2026-08-11: 8 de 9.** GF·YT a cero, GP·MQ·RE al 8,5% (una sola alta SIEE), Canarias·Ceuta·Melilla vía `SUBDIVISION_TAX_OVERRIDES` leyendo la región que la geolocalización ya daba. Solo queda **Åland**, sin resolver su régimen | ✅ |
| **D-17** | 🇺🇸 Gravabilidad de los 11 servicios estado por estado (~30 gravan digitales, ~25 SaaS; FL y VA eximen). Cerrarlo ANTES de registrarse en cualquier estado | Fiscalista US |
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
