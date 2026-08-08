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

## 7. Estado y pendientes

### Países

| Bloque | Países | Estado | Impuesto en el checkout |
|---|---|---|---|
| 🇲🇽 México | 1 | ✅ En producción | **Sí** — IVA 16% |
| 🇪🇺 Unión Europea | 27 | ✅ Activos (falta nº de OSS para `sk_live`) | **Sí** — el de cada país |
| 💳 Recauda la emisora | AR · CR · EC · PY · DO | ✅ Activos | No — lo suma el banco |
| ⬜ Sin régimen digital | BO · SV · GT · HN · NI · **PA** | ✅ Activos | No — no lo recauda nadie |
| ⬜ Resto de LatAm | CL · CO · PE · UY · BR | Sin ficha — **no cobrables** | — |
| ⬜ Resto del mundo | — | Sin ficha — **no cobrables** | — |

**Total cobrable: 39 países.** Un país sin fila en `COUNTRY_TAX_CONFIG` no es cobrable y el
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
| **D-09** | Los 5 de LatAm que faltan (CL · CO · PE · UY · BR): todos exigen alta previa | Luis + fiscalista internacional |
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
