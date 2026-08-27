# Modelo fiscal de Vibra — IVA e impuestos indirectos (modelo INTERMEDIACIÓN)

> **Estado:** documento de diseño operativo. **Actualizado 2026-08-26 al MODELO DE INTERMEDIACIÓN.**
> Es la guía de referencia para construir la facturación y los impuestos.
>
> **⚠️ Tercer y definitivo cambio de modelo.** Este documento pasó por tres etapas: intermediación
> (hasta el 27-jul-2026), vendedor directo (28-jul al 25-ago-2026) y **de vuelta a intermediación**,
> ahora con confirmación de fiscalista. Todo párrafo que describa a Vibra como vendedora directa o al
> creador como su proveedor **está superado**.
>
> **Consecuencia útil:** las secciones §1 a §11 y los Anexos, escritos bajo el modelo intermediario
> original, **vuelven a ser pertinentes**. Se conservan y se revalidan, salvo las marcas puntuales.
>
> **Entidad:** Vibra On, LLC. **Procesadora:** Stripe. **Denominación:** USD.
> **Reparto:** 75% creador / 25% Vibra sobre el precio base, con el impuesto de la comisión por encima.
>
> Marco (referencia mexicana): LIVA (Cap. III BIS, arts. 1º-A BIS, 16, 18-B a 18-M, 24, 29) y su
> Reglamento (art. 58); LISR (arts. 113-A a 113-D y Título V, arts. 153, 156, 167); CFF (arts. 5º-A,
> 9º, 30-B); LIF 2026 (art. 25); RMF 2026; reforma DOF 07-11-2025; jurisprudencia del PJF.

---

## 0. MODELO VIGENTE: Vibra es INTERMEDIARIA

**El creador vende y presta al comprador. Vibra intermedia y cobra por cuenta del creador.**

Vibra opera la plataforma, publica el catálogo, procesa el cobro, entrega técnicamente, modera y da
soporte. Cobra el precio y los impuestos **en nombre y por cuenta del creador**, al amparo de un
**mandato de cobro** que éste otorga por separado, y retiene su comisión y las retenciones fiscales
obligatorias.

**Consecuencia contable (a confirmar con el contador):** el ingreso de Vibra es **su comisión del 25%**,
no el 100% del precio. El 75% del creador **nunca fue ingreso de Vibra**: transitó por sus sistemas por
cuenta ajena. Esto invierte la nota que traía la versión de vendedor directo, que proponía registrar el
100% como ingreso y el 75% como costo. **Ese asiento ya no aplica.**

### Dos cálculos INDEPENDIENTES (principio rector)

1. **Impuesto de la VENTA** → lo determina el **país del COMPRADOR**.
2. **Retenciones y comprobantes del PAGO al creador** → lo determinan la **residencia y el régimen del
   CREADOR**.

Se calculan por separado y solo se encuentran en el asiento del ledger. Mezclarlos es el error más caro
que se puede cometer aquí.

### 0.1 La matriz de las 4 combinaciones — ⭐ AUTORITATIVA

Ejemplo uniforme: **precio base 100**, **comisión de Vibra 25**.

| | Comprador MEXICANO | Comprador EXTRANJERO |
|---|---|---|
| **Creador MEXICANO** | Paga **116**<br>Retención IVA **8** (50%)<br>Retención ISR **2.50**<br>Comisión **25 + 4** de IVA<br>**Se deposita 76.50**<br>Tras enterar su IVA le quedan **72.50** | Paga **100** + impuesto de su país<br>Venta a **0%** de IVA mexicano<br>Retención IVA **0**<br>Retención ISR **2.50**<br>Comisión **25 + 4** de IVA<br>**Se deposita 68.50**<br>Los 4 le quedan **a favor** |
| **Creador EXTRANJERO** | Paga **116**<br>Retención IVA **16** (100%)<br>Sin ISR mexicano<br>Comisión **25**, sin IVA<br>**Se deposita 75.00** | Paga **100** + impuesto de su país<br>Sin IVA mexicano<br>Sin ISR mexicano<br>Comisión **25**, sin IVA<br>**Se deposita 75.00** |

**Reglas que se leen de la matriz:**

- **El ISR se calcula sobre los 100**, sin el IVA y antes de la comisión. No sobre 116 ni sobre 75.
- **La retención de IVA es un porcentaje del IVA cobrado**, así que cuando la venta va a 0% se anula
  sola. No hay que ramificar la fórmula.
- **La comisión de Vibra lleva su propio IVA cuando el creador es mexicano**, y va **por encima** del
  25%, nunca dentro. Si fuera dentro, la comisión efectiva caería a 21.55 y Vibra absorbería un impuesto
  que no puede acreditar.
- **El creador conserva su 75% íntegro** antes de sus propias retenciones, en los cuatro casos.

**Una sola fórmula sirve para los cuatro:**

```
neto = (base + ivaVenta) − (comisión + ivaComisión) − retIVA − retISR

  retIVA = tasaRetIVA × ivaVenta
  retISR = tasaRetISR × base
```

### 0.2 Exportación de servicios — CONFIRMADO

**Los once servicios se tratan como exportación de servicios a tasa 0% cuando el comprador está fuera de
México.** Confirmado con fiscalista el 2026-08-26.

Esto cierra el riesgo de doble imposición que quedaba abierto: la venta a comprador extranjero lleva el
impuesto del país del comprador y **ningún IVA mexicano**.

> ⚠️ **Pendiente operativo:** conservar por operación la evidencia que sustenta la exportación
> (ubicación del comprador y sus indicios, medio de pago, aprovechamiento). La tasa 0% se acredita con
> expediente, no con criterio.

> ⚠️ **Efecto secundario a vigilar:** el creador mexicano que vende sobre todo al extranjero paga IVA en
> la comisión y no traslada ninguno. Ese IVA queda como **acreditable o saldo a favor**: puede
> **acreditarlo contra IVA futuro** o **solicitar devolución**, a su elección y sin plazo forzoso. No
> pierde dinero; solo deja de tener contra qué descontarlo de inmediato. Conviene explicárselo en el
> producto para que no lo lea como una merma.

### 0.3 Los comprobantes, caso por caso

**La regla que gobierna:** hay **CFDI de retenciones siempre que exista una retención mexicana**, sea de
IVA o de ISR. Eso incluye al **creador extranjero** al que se le retiene IVA mexicano. Solo el caso
extranjero-extranjero queda fuera, porque ahí no hay retención alguna.

> ⚠️ **Corrige una simplificación anterior.** Este documento decía que al creador no mexicano se le
> entrega «solo un comprobante de pago». **Es incorrecto**: si Vibra le retiene IVA mexicano, también debe
> emitirle su CFDI de retenciones. El SAT contempla expresamente que ese CFDI tenga como receptor a un
> extranjero, mediante su número de identificación fiscal extranjero o el RFC genérico.

Base **$100**, comisión de Vibra **$25**, en los cuatro casos.

---

#### Caso 1 — Creador mexicano + comprador mexicano

**Documento 1 · CFDI de venta al comprador.** Emitido automáticamente con el **CSD del creador**.

| Campo | Valor |
|---|---|
| Emisor | Creador mexicano |
| Receptor | Comprador mexicano |
| Servicio | Uno de los 11 |
| Subtotal | $100 |
| IVA 16% | $16 |
| **Total** | **$116** |

**Documento 2 · CFDI de comisión.**

| Campo | Valor |
|---|---|
| Emisor | Vibra |
| Receptor | Creador mexicano |
| Comisión | $25 |
| IVA 16% | $4 |
| **Total** | **$29** |

**Documento 3 · CFDI de retenciones.**

| Concepto | Importe |
|---|---|
| Operación sin IVA | $100 |
| IVA trasladado | $16 |
| IVA retenido por Vibra | $8 |
| ISR retenido | $2.50 |
| Comisión sin IVA | $25 |

**Depósito al creador: $76.50.**

---

#### Caso 2 — Creador mexicano + comprador extranjero

**Documento 1 · CFDI de exportación.**

| Campo | Valor |
|---|---|
| Emisor | Creador mexicano |
| Receptor | Comprador extranjero · RFC genérico `XEXX010101000` |
| Subtotal | $100 |
| IVA mexicano | **$0**, tasa 0% |
| **Total del CFDI mexicano** | **$100** |

> El impuesto extranjero —por ejemplo $21 de España— **no va en el CFDI mexicano**. Aparece en el
> comprobante que exija el país del comprador. Confundirlos es declarar IVA mexicano que no existe.

**Documento 2 · CFDI de comisión.** Idéntico al del caso 1: $25 + $4 = **$29**.

**Documento 3 · CFDI de retenciones.**

| Concepto | Importe |
|---|---|
| Operación sin IVA | $100 |
| IVA trasladado mexicano | $0 |
| IVA retenido | $0 |
| ISR retenido | $2.50 |
| Comisión sin IVA | $25 |

**Depósito al creador: $68.50.** Los $4 de IVA de la comisión quedan como **IVA acreditable o saldo a
favor**: el creador puede acreditarlos contra IVA futuro **o** solicitar devolución. **No está obligado a
pedirlos de inmediato.**

---

#### Caso 3 — Creador extranjero + comprador mexicano

**Documento 1 · Comprobante de venta.** El creador extranjero **no puede emitir CFDI mexicano**. Se
entrega al comprador un comprobante electrónico de la operación, **no una factura timbrada con CSD**.

| Concepto | Importe |
|---|---|
| Servicio | $100 |
| IVA mexicano 16% | $16 |
| **Total pagado** | **$116** |

**Documento 2 · Comisión de Vibra**, si califica como exportación.

| Concepto | Importe |
|---|---|
| Comisión | $25 |
| IVA mexicano | **$0**, tasa 0% |
| **Total** | **$25** |

> Vibra documenta su exportación de servicios mediante **CFDI con receptor extranjero**.

**Documento 3 · CFDI de retenciones.** ⚠️ **Sí lo hay**, aunque el creador sea extranjero.

| Concepto | Importe |
|---|---|
| Operación sin IVA | $100 |
| IVA mexicano trasladado | $16 |
| IVA retenido por Vibra | **$16** (100%) |
| ISR mexicano | $0 |
| Comisión | $25 |

**Depósito al creador: $75.**

---

#### Caso 4 — Creador extranjero + comprador extranjero

**Documento 1 · Comprobante de venta.** No existe CFDI mexicano. Se genera el comprobante que exija el
país del comprador.

| Concepto | Importe |
|---|---|
| Servicio | $100 |
| Impuesto del país (ej. España) | $21 |
| **Total pagado** | **$121** |

**Documento 2 · Comisión de Vibra**, si califica como exportación: $25 con IVA mexicano al 0%.

**Documento 3 · Liquidación al creador.** ⚠️ **No es CFDI de retenciones**, porque no hay retención
mexicana. Es un **comprobante de liquidación** o *payout statement*.

| Concepto | Importe |
|---|---|
| Venta sin impuesto | $100 |
| Comisión Vibra | −$25 |
| ISR mexicano | $0 |
| IVA mexicano retenido | $0 |
| **Depósito** | **$75** |

---

#### Resumen de qué se emite

| Caso | Venta | Comisión | Tercer documento |
|---|---|---|---|
| 1 · MX → MX | CFDI con CSD del creador | CFDI, $25 + $4 | **CFDI de retenciones** |
| 2 · MX → extranjero | CFDI de exportación 0% | CFDI, $25 + $4 | **CFDI de retenciones** |
| 3 · Extranjero → MX | Comprobante electrónico | CFDI receptor extranjero, 0% | **CFDI de retenciones** |
| 4 · Extranjero → extranjero | Comprobante del país | CFDI receptor extranjero, 0% | Liquidación, **no CFDI** |

**Sello digital.** Solo el caso 1 y el 2 lo requieren: el **creador mexicano entrega su CSD vigente** al
completar su alta de cobro. Se custodia en el proveedor de facturación, nunca en la plataforma.

> ⚠️ **El sello se necesita desde la primera venta, no antes del primer retiro.** Sin él no se puede
> emitir el Documento 1, y la obligación de facturar nace con la venta.

> ⚠️ **Nota de arquitectura.** La infraestructura de carga del sello ya existe
> (`backend/src/facturacion/uploadCreatorCsd.ts`), pero fue construida para el modelo de vendedor
> directo, donde servía para que el **creador facturara a Vibra** su 75%. **Cambia de propósito**: ahora
> sirve para emitir el Documento 1 por cuenta del creador. La factura del creador a Vibra **desaparece**.

> ⚠️ **La factura global deja de ser opcional.** Bajo vendedor directo, lo que el comprador no pidiera se
> resolvía fuera del sistema y era problema de un solo contribuyente. Bajo intermediación **cada creador
> tiene su propia obligación** de facturar todas sus ventas, incluida la global al público en general.


### 0.4 Tasas de retención (ejercicio 2026)

| Situación del creador | ISR | IVA |
|---|---|---|
| Mexicano, persona física, con RFC | 2.5% | 50% del IVA cobrado |
| Mexicano, persona moral, con RFC | 2.5% | 50% del IVA cobrado |
| Mexicano **sin RFC** | **20%** | **100%** |
| Mexicano que **cobra en cuenta bancaria fuera de México** | 2.5% | **100%** |
| Extranjero, servicio prestado fuera | 0% | **100%** |
| Extranjero, pago tratado como **regalía** | **25%** (≈10% con tratado y constancia) | **100%** |

> 🚨 **El 2.5% NO está en el artículo 113-A**, cuyo texto base sigue diciendo 1%. Viene de la **Ley de
> Ingresos, de vigencia ANUAL**. Debe ser un parámetro configurable por ejercicio, nunca una constante en
> el código, y hay que revisar la LIF 2027 antes de que entre en vigor.

> 🚨 **El país de la cuenta de destino es un dato fiscal.** Dispara por sí solo la retención del 100%.
> Depende de dónde cobra **el creador**, no de dónde tiene Vibra sus cuentas. Debe reevaluarse cada vez
> que el creador cambie de cuenta.

### 0.5 Los once servicios

Todos reciben el **mismo tratamiento de intermediación** y pueden ir con el mismo contrato marco. Tres
grupos necesitan una condición especial:

1. **Apoyos** (perfil, comunidad, en vivo) — **nunca llamarlos donativos**. Son contraprestación por el
   reconocimiento, la visibilidad o el acceso. Debe declararse qué recibe el comprador a cambio.
2. **Contenido grabado y publicación de pago** — requieren **anexo de licencia de acceso** con aceptación
   específica: personal, revocable, sin descarga ni redistribución. Es lo que los separa de la regalía.
3. **Súper comentario** — destacar el mensaje es una función de la plataforma, no del creador. El
   contrato debe definir que lo que se adquiere es la **atención del creador** y que el destacado es el
   medio técnico.

### 0.6 Decisiones pendientes

| Tema | Estado |
|---|---|
| Exportación 0% para los 11 servicios vendidos al fan | ✅ Confirmado 2026-08-26 |
| 🔴 **Exportación 0% de la COMISIÓN de Vibra al creador extranjero** | ⬜ **Confirmar por separado con el contador.** Es **otra operación**, distinta de la venta: que los 11 servicios califiquen como exportación **no basta** para que la intermediación de Vibra también lo haga. Si no califica, la comisión al creador extranjero lleva 16% y ese impuesto lo absorbe Vibra, porque el creador extranjero no lo acredita. Ver §5. |
| Numeración exacta de la regla de emisión por cuenta de terceros | ⬜ Confirmar antes de citarla en contrato |
| Residencia fiscal de la LLC y doble residencia | ⬜ Decide si la comisión del caso extranjero-extranjero paga ISR mexicano |
| Videollamadas 1-a-1 con creador extranjero | ⬜ ¿Régimen de plataformas o importación de servicios? |
| Altas de IVA fuera de México | ⬜ Vibra es proveedor considerado en varias jurisdicciones |
| Contabilidad: ingreso = comisión, no el 100% | ⬜ Confirmar asiento con contador |
| ✅ **Cuándo se aplica la retención al saldo** | **DECIDIDO (Luis, 2026-08-26): al RETIRAR, no al vender.** En la wallet el creador sigue viendo su 75% íntegro; los descuentos aparecen desglosados al pulsar «Retirar». Es lo que dice la ley al pie de la letra —la retención ocurre cuando se paga, no cuando se vende— y evita que el saldo baje sin explicación. |
| ✅ **Quién emite la factura global** | **DECIDIDO (Luis, 2026-08-26): la emite VIBRA por cuenta del creador**, con el sello digital que él sube. La alternativa —que cada creador emitiera la suya cada mes— no escala y deja expuesto a quien se olvide. **Corolario: el sello se necesita desde la primera venta**, no antes del primer retiro. |
| 🔴 **Claves del SAT (tres)** | ⬜ **Pendiente de contador.** (1) clave de producto de la COMISIÓN de Vibra, hoy `80141600`; (2) clave de RETENCIÓN del régimen de plataformas, hoy `14`; (3) clave de producto de la VENTA al comprador, hoy `81112100`, marcada como «defendible para arrancar» desde julio y nunca confirmada. Las tres están en el código con marcador 🔁 FISCALISTA. |
| 🚧 **Dónde elige el creador el país de su cuenta de cobro** | ⬜ El backend ya lo guarda (`setCreatorPayoutAccountCountry`) y el motor ya lo aplica —fuera de México sube la retención al 100%—, pero **no hay sitio en la interfaz donde elegirlo**. Va con el alta de Stripe, que es donde el creador da sus datos de depósito. Mientras no exista, el campo queda vacío y el motor asume México. |

---

> **Nota sobre lo que sigue.** Las secciones §1 a §11 y los Anexos se escribieron bajo el modelo
> intermediario original y **vuelven a regir**, con dos salvedades: la §5 quedó marcada como obsoleta
> cuando no había comisión sino margen — **vuelve a ser válida**, ahora sí hay comisión y lleva IVA —, y
> las referencias a servicios bloqueados ya no aplican: **los once están activos**.

---

## 1. La regla de oro del IVA (respuesta directa a "¿cuándo cobro 16%?")

> ### 🔑 El IVA de 16% lo determina, en la práctica, **DÓNDE ESTÁ EL COMPRADOR**, no el creador.
>
> - **Comprador en México → se cobra IVA 16%** (sin importar si el creador es mexicano o extranjero).
> - **Comprador en el extranjero → NO se le cobra 16%**; se le cobra el impuesto de **su** país (§0.2). La venta de Vibra queda a **0% de exportación**.

♻️ **Revisado el 2026-08-26.** Este párrafo pasó por dos correcciones. Bajo el modelo intermediario
original decía que con creador y comprador extranjeros la operación quedaba **"fuera de objeto"**; el
2026-08-07 se corrigió a **0% de exportación** porque bajo vendedor directo la vendedora era Vibra,
residente en México, y el **Art. 16 LIVA** situaba el servicio en territorio nacional siempre.

**Con el regreso a intermediación la lectura vuelve a partirse en dos**, y conviene tenerlo claro:

- **Creador mexicano + comprador extranjero** → la venta es del creador, residente en México: **0% por
  exportación**, confirmado por fiscalista para los 11 servicios (§0.2). A 0% se acredita el IVA de
  insumos, que es justo lo que genera el saldo a favor del creador.
- **Creador extranjero + comprador extranjero** → ni el vendedor ni el comprador están en México:
  **fuera del objeto del IVA mexicano**. No es 0%, es que no hay hecho imponible.

La **comisión de Vibra** sigue su propia suerte: exportación de mediación cuando el creador es
extranjero, 16% cuando es mexicano (§5).

La residencia del creador **no cambia si al comprador se le cobra 16% o no**; cambia otras tres cosas: (a) cómo se documenta y retiene el **pago al creador** (D-06), (b) el **ISR** (113-A si es mexicano vs. Título V si es extranjero), y (c) si la compra del insumo por parte de Vibra es doméstica o una **importación de servicios**.

> **⚠️ Honestidad sobre el 0% de exportación (comprador extranjero, creador MX):** la "regla de oro" describe el tratamiento *pretendido*, pero el 0% **no es automático**. El Art. 58 del Reglamento de la LIVA exige que el servicio sea **contratado y pagado por un residente en el extranjero, con pago proveniente de cuentas en el extranjero**. En el modelo agregador el fan paga a la cuenta mexicana de Vibra → **el flujo real de fondos puede romper el requisito** y exponer la operación a reclasificación a 16%. Ver §5 y §6. Esto debe cerrarse con fiscalista.

---

## 2. Lo que cambió en 2026 (novedades que reconfiguran el tablero)

Paquete Económico 2026, publicado en el **DOF el 7 de noviembre de 2025** (vigor 1-ene-2026, salvo lo indicado):

1. **ISR de plataformas: 1% → 2.5%** para PF que prestan servicios / enajenan bienes (fracción III). **Matiz crítico:** el aumento se instrumentó vía **LIF 2026, Art. 25, fracción VI** (norma de **vigencia anual**), **no** como reforma permanente al 113-A LISR — cuyo texto base **sigue diciendo 1%**. Hay que confirmar su prórroga en la LIF 2027. Las tasas de transporte/entrega (2.1%) y hospedaje (4%) **no cambiaron**.

2. **IVA — Art. 18-J reformado:** se **amplió expresamente la obligación de retener el 100% del IVA a las plataformas residentes en México** (antes el 18-J estaba redactado para intermediarios extranjeros, y una plataforma mexicana como Vibra quedaba en zona gris). Aplica cuando el residente en el extranjero **enajene bienes, preste servicios o conceda uso o goce temporal en territorio nacional** a través de la plataforma. **Este cambio es directamente favorable a Vibra: le da base legal clara para retener el 100% del IVA del creador extranjero.**

3. **CFF Art. 30-B (nuevo):** obliga a las plataformas a permitir al SAT **acceso permanente, en línea y en tiempo real** a la información. **Entrada en vigor diferida: 1 de abril de 2026.**

4. **Responsabilidad solidaria** de la plataforma por retenciones no efectuadas o mal determinadas, y **bloqueo temporal** del servicio digital por incumplimiento (reforma CFF). Riesgo directo de Vibra.

> **A validar con fiscalista:** el texto verbatim del 18-J reformado y del articulado de bloqueo/solidaridad debe cotejarse contra el **DOF 07-11-2025** — el PDF consolidado de diputados.gob.mx aún no incorpora la reforma 2026 y las fuentes secundarias coinciden en el contenido pero no siempre en el numeral exacto.

---

## 3. Cómo saber "dónde está el comprador" — los 4 indicios del Art. 18-C

Para clasificar cada transacción (y decidir el 16%), la ley (LIVA Art. 18-C) presume que el receptor está en México cuando se cumple **al menos uno** de estos cuatro indicios. **Criterio prudente operativo: exigir ≥2 coincidencias hacia México** cuando haya señales contradictorias, y conservarlos como respaldo documental.

| # | Indicio (Art. 18-C) | Dato que Vibra puede capturar |
|---|---|---|
| I | **Domicilio** manifestado por el receptor | Domicilio de perfil / facturación |
| II | **Medio de pago** vía intermediario en territorio nacional | Tarjeta/banco emisor mexicano (BIN) en Stripe |
| III | **Dirección IP** en rango asignado a México | Geo por IP (`registrar-compra-geo`) |
| IV | **Código telefónico de país** = +52 | Teléfono del registro |

**Acción de producto:** persistir y **conservar los 4 datos por transacción** como evidencia fiscal de la clasificación de IVA.

---

## 4. LA MATRIZ OPERATIVA — detalle legal por combinación

> 🔗 **La tabla vive en §0.1** (matriz única y autoritativa). Aquí queda solo el **razonamiento
> legal** de cada combinación, que sigue siendo válido como referencia del detalle fiscal
> mexicano. La "Tabla maestra" que estaba en esta sección se eliminó el 2026-08-07 por
> duplicar §0.1 con la convención de siglas invertida.

La plataforma (Vibra) es residente en México en las cuatro combinaciones.

**Creador MX · Comprador MX (caso base, sin zona gris).** 16% de IVA; Vibra retiene **50%** del IVA trasladado al creador PF con RFC (**100%** si no da RFC) y lo entera. ISR **2.5%** sobre el ingreso sin IVA (**20%** sin RFC). Si el creador PF factura ≤ $300,000/año puede optar por **pago definitivo** (113-B) y la retención agota su ISR. **RESICO no aplica** a lo cobrado por la plataforma: manda el 113-A.

**Creador EX · Comprador MX (creador extranjero, fan mexicano).** El fan **sí paga 16%** (LIVA Art. 16 §4 remite al Cap. III BIS: el servicio se presta en territorio nacional porque el receptor está en México). Vibra retiene el **100%** del IVA (18-J-II-a §2, ampliado por la reforma 2026 a plataformas mexicanas) y lo entera el día 17. **El creador extranjero NO necesita inscribirse en el RFC ni facturar** si Vibra retiene el 100% (Art. 18-D último párrafo) — es la ruta limpia del agregador. **El ISR es la zona gris grande** (ver §7): por defecto no se retiene, salvo que el servicio se caracterice como regalía.

**Creador MX · Comprador EX (creador mexicano, comprador extranjero).** Tasa **0%** de exportación (Art. 29 LIVA), con ventaja de que el creador **recupera su IVA acreditable**. **PERO no es automática:** además de documentar el aprovechamiento efectivo en el extranjero (tesis **2031805**), el Art. 58 RLIVA exige **pago proveniente de cuentas en el extranjero** — requisito que el flujo agregador (fan paga a cuenta MX de Vibra) puede **romper**. **Si el 0% no procede, el fallback es 16%** (servicio prestado por residente mexicano, gravado por Art. 14/16). El **ISR sí corre** normal (2.5%/20%): la retención del 113-A no depende de dónde está el comprador, sino de que el ingreso lo obtenga un residente mexicano vía plataforma.

**Creador EX · Comprador EX (ambos extranjeros).** ⚠️ **Párrafo corregido el 2026-08-07.** Bajo el modelo ANTERIOR de intermediario se concluía que "no hay hecho imponible mexicano" porque el vendedor era el creador extranjero. **Bajo vendedor directo esa conclusión es incorrecta:** el vendedor es Vibra, residente en México, y el **Art. 16 LIVA** sitúa el servicio en territorio nacional cuando lo realiza un residente. La operación **sí está dentro del objeto** del IVA mexicano y se resuelve a **tasa 0% por exportación** (Art. 29-IV), no como ausencia de gravamen — distinción que importa porque a 0% Vibra **acredita su IVA de insumos**. Es además la fila **más defendible** para el 0%: el comprador está fuera, así que el aprovechamiento en el extranjero es claro. Para ISR, el creador extranjero no tiene fuente de riqueza en MX (matiz regalía en §7). Ver la matriz de **§0.1**.

---

## 5. La comisión de Vibra se grava aparte — ✅ VUELVE A REGIR (2026-08-26)

> ♻️ **Léase así:** esta sección se anuló el 2026-08-07 al pasar a vendedor directo, donde el 25%
> dejaba de ser comisión y pasaba a ser margen. **Con el regreso a intermediación vuelve a regir en su
> sentido original**, y todo lo tachado abajo vuelve a ser válido. Lo que sigue siendo cierto:
>
> - Vibra presta un **servicio propio de mediación**, distinto del servicio del creador, que **causa su
>   propio IVA**.
> - **Creador mexicano** → la comisión lleva **16%**, por encima del 25% y acreditable para él.
> - **Creador extranjero** → exportación de mediación, sin IVA mexicano.
> - Volver a intermediar **recupera el inciso d) "comisiones y mediaciones"** del Art. 29-IV, que es el
>   encaje más limpio para el 0%. Bajo vendedor directo había que forzarlo hacia g) o i).

> ⚠️ Lo escrito debajo de esta nota describe la anulación de agosto y **ya no aplica**. Se conserva
> como historia del cambio.

> 🗑️ **Sección eliminada el 2026-08-07 por pertenecer al modelo anterior.**
>
> Decía que la comisión de Vibra era **un servicio propio de mediación** (LIVA Art. 14-IV) que
> causaba **su propio IVA separado** del servicio del creador, y apoyaba su 0% de exportación en
> el **inciso d) "comisiones y mediaciones"** del Art. 29-IV.
>
> **Bajo vendedor directo eso ya no existe.** Vibra no intermedia: **vende**. No hay dos servicios
> (el del creador + la comisión), hay **uno solo** — la venta de Vibra al comprador. El 25% dejó
> de ser una comisión gravada aparte y pasó a ser **margen** (100% del precio base es ingreso
> bruto de Vibra; el 75% del creador es costo). Ver §0 y `docs/modelo-financiero.md`.
>
> **La consecuencia práctica es la que recoge D-08:** al dejar de vender mediación, Vibra **salió
> del inciso d)** — que era el encaje limpio para el 0% de exportación — y ahora debe sostenerlo
> en **g) filmación o grabación** o **i) tecnologías de la información**.

**Lo único de esta sección que sigue vigente** es la advertencia jurisprudencial, que ahora aplica
a la **venta** de Vibra y no a su comisión:

> La **jurisprudencia registro 2031805** (Pleno Regional Centro-Norte, publicada 27-feb-2026,
> **de aplicación obligatoria**) exige probar el **aprovechamiento EFECTIVO en el extranjero** y
> **prohíbe extender el 0% por analogía** a servicios cuyos efectos se materializan en territorio
> nacional. Sumado al **Art. 58 RLIVA** (pago desde cuenta en el extranjero), que el flujo real
> —dinero cayendo en la cuenta MX de Vibra— no satisface de origen.
>
> **Postura conservadora:** 16% por defecto y 0% solo con expediente robusto. Validar con fiscalista.

---

## 6. Los 11 servicios, clasificados (y el tratamiento de las propinas)

Bajo vendedor directo, los 11 son **ventas de Vibra al comprador**; el creador es el proveedor del insumo. La matriz de **§0.1** aplica a los 11 por igual (manda dónde está el comprador para el impuesto de la venta, y la residencia del creador para el pago al proveedor). Lo que cambia entre ellos es su **naturaleza jurídica** (contenido vs. servicio personal vs. "propina"), relevante para dos cosas: el **ISR del creador extranjero** (§7) y, sobre todo, **a qué inciso del Art. 29-IV se amarra el 0% de exportación** de cada uno (**D-08** — columna pendiente de esta misma tabla).

> ⚠️ La referencia al régimen **18-J / 113-A** que encabezaba esta sección describía el modelo de
> intermediario. Se conserva el análisis por servicio porque la **naturaleza jurídica** de cada uno
> no cambia con el modelo, pero el encuadre general es el de **§0.1**.

| # | Servicio (enum) | Naturaleza fiscal | ¿"Servicio digital" 18-B (automatizado)? | IVA (comprador MX) | Riesgo ISR-extranjero (§7) |
|---|---|---|---|---|---|
| 1 | `live_ticket` | Acceso a evento/contenido | Sí (si es acceso a transmisión) | 16% | Medio (¿regalía?) |
| 2 | `premium_post` | Acceso a contenido multimedia | Sí, 18-B-I | 16% | **Alto** (contenido → regalía) |
| 3 | `vod_ticket` | Acceso a video/VOD grabado | Sí, 18-B-I | 16% | **Alto** (obra grabada → regalía) |
| 4 | `subscription` | Club/membresía recurrente | Sí, 18-B-I y III | 16% | Medio |
| 5 | `supercomment` | Feature pagada (comentario destacado) | Sí, 18-B-I/II | 16% | Bajo (contraprestación) |
| 6 | `exclusive_session` (1-a-1) | Servicio personal intermediado | **No** (intervención humana sustancial)* | 16% | Bajo (servicio personal Art. 156) |
| 7 | `live_session` ("tiempo contigo") | Servicio personal intermediado | **No** (intervención humana)* | 16% | Bajo (servicio personal) |
| 8 | `greeting` (saludo / meet & greet) | Servicio personal intermediado | **No** (intervención humana)* | 16% | Bajo (servicio personal) |
| 9 | `live_donation` | **Propina — §6.1** | Sí (contraprestación) | 16% | Bajo |
| 10 | `advice` (consejo) | **Propina/servicio — §6.1** | Sí (contraprestación) | 16% | Bajo |
| 11 | `profile_donation` | **Propina — §6.1** | Sí (contraprestación) | 16% | Bajo |

\* **Servicios 6–8 (videollamada 1-a-1):** tienen intervención humana sustancial, así que **no** son "servicio digital fundamentalmente automatizado" del 18-B. Bajo el texto pre-2026 caerían en **importación de servicios (Art. 24-V)** con IVA autoliquidado por el comprador — inviable en B2C. La **redacción amplia de la reforma 2026** ("preste servicios" en general) parece traerlos de vuelta a la retención del 100% por la plataforma. **Punto a confirmar con el texto DOF del 18-J.** Para ISR-extranjero, en cambio, ser servicio personal *les conviene* (Art. 156 → 0% si se ejecuta desde el extranjero, vs. regalía).

Para el **ISR de creador mexicano**, los 11 caen en la **fracción III del Art. 113-A** → **2.5% (2026)**. Ninguno es transporte (2.1%) ni hospedaje (4%).

### 6.1 Propinas y "donaciones" (`live_donation`, `advice`, `profile_donation`, en parte `supercomment`)

Aunque las llames "donación" o "consejo/tip", **fiscalmente NO son donativos.** Un donativo es a título gratuito y sin nada a cambio; aquí el fan paga **para premiar/recibir contenido o la experiencia del creador** (contraprestación económica). El régimen de servicios digitales grava precisamente "cuando se cobre una contraprestación" (Art. 18-B, primer párrafo).

- **IVA:** gravadas al **16%** (comprador en MX). No clasificarlas como donativos exentos.
- **ISR:** para el creador es **ingreso acumulable** por su actividad, no un donativo exento del Art. 93 LISR. Vibra **retiene** igual que en los demás servicios.

**Postura recomendada (conservadora y defendible): tratar los 11 servicios —incluidas propinas— como contraprestaciones gravadas.** Es la lectura de menor riesgo de auditoría; los montos de propina son pequeños y no vale el riesgo fiscal de tratarlos como donativos. Confirmar con fiscalista.

---

## 7. ISR del creador EXTRANJERO — el punto de mayor incertidumbre (Título V)

**Asimetría central que hay que documentar por escrito:** para un mismo cobro EX–MX, **el IVA sí se causa y Vibra lo retiene al 100%**, pero **el ISR generalmente NO se retiene**. La razón es estructural: el régimen de retención de ISR vía plataformas (113-A) es **solo para residentes en México**; la LISR **no tiene un régimen espejo** para prestadores de servicios digitales extranjeros. Para el creador extranjero manda **fuente de riqueza** (Título V), y el desenlace depende de **cómo se caracterice** lo que entrega:

### Árbol de decisión (ISR creador extranjero)

```
Creador RESIDENTE EN EL EXTRANJERO cobra vía Vibra (pagador residente en México)

P1. ¿Qué entrega jurídicamente el creador?

(A) LICENCIA / USO DE OBRA o DERECHO DE AUTOR
    (premium_post, vod_ticket, contenido grabado, uso de marca, publicidad)
      → REGALÍA — Art. 167 LISR
        Fuente en México: SÍ (basta que Vibra sea pagador residente).
        Tasa ley interna: 25% (derechos de autor, fr. II) / 35% (marcas, publicidad).
        ¿Tratado + constancia de residencia (Art. 4)? → típicamente 10%.
        ► SÍ SE RETIENE ISR.

(B) SERVICIO PERSONAL (exclusive_session, live_session, greeting, advice) — Art. 156
      ¿Dónde se PRESTA el servicio?
        • Íntegramente desde el extranjero → SIN fuente MX → 0% (no se retiene).
        • Parte/todo en México (presencia física) → 25% sobre bruto sin deducción.
      (El consumidor/beneficiario en México NO crea fuente por sí solo.)

(C) ACTIVIDAD EMPRESARIAL (el creador opera como negocio)
      ¿Establecimiento permanente en México?
        • NO + tratado (Art. 7 OCDE, beneficios empresariales) → 0% en México.
        • NO + sin tratado → Título V no retiene beneficios sin EP → típicamente 0%.
        • SÍ (EP) → tributa como residente por el ingreso atribuible.

EN TODOS LOS CASOS: el IVA (16%, Art. 18-B/18-J) se causa y Vibra lo retiene al 100%,
con independencia del resultado de ISR.  ⇒ Asimetría: IVA sí, ISR frecuentemente no.
```

**El punto de exposición:** que el SAT **arrastre el contenido digital (rama B/C) hacia regalía (rama A)**. `vod_ticket` y `premium_post` (acceso a obra grabada) son los de **mayor riesgo** de leerse como licencia de derecho de autor → retención 25%. Las sesiones 1-a-1 en vivo son las de **menor riesgo** (servicio personalísimo).

**Regla operativa:** sin **constancia de residencia fiscal** del creador extranjero en poder de Vibra (Art. 4 LISR), no se puede aplicar tasa de tratado → aplicaría la de ley interna (25%/35%) si hay retención. El onboarding fiscal debe capturarla por creador y país.

---

## 8. Tasas y porcentajes vigentes (2026) — referencia rápida

| Concepto | Valor 2026 | Fundamento |
|---|---|---|
| IVA tasa general | **16%** | LIVA Art. 1 |
| IVA exportación de servicios | **0%** | LIVA Art. 29 (+ Art. 58 RLIVA para "aprovechamiento en el extranjero") |
| **Retención IVA** — creador PF con RFC | **50%** del IVA trasladado | LIVA 18-J-II-a) §1 |
| **Retención IVA** — creador PF sin RFC | **100%** | LIVA 18-J-II-a) |
| **Retención IVA** — creador extranjero / depósito en cuenta en el extranjero | **100%** | 18-J-II-a) §2 (ampliado a plataformas MX, reforma 1-ene-2026) |
| **Retención ISR** — creador PF con RFC (servicios, fr. III) | **2.5%** (era 1%) — vía LIF, no reforma permanente | **LIF 2026 Art. 25-VI** → LISR 113-A fr. III |
| Retención ISR — transporte/entrega (fr. I) | **2.1%** (sin cambio) | LISR 113-A-I |
| Retención ISR — hospedaje (fr. II) | **4%** (sin cambio) | LISR 113-A-II |
| Retención ISR — creador PF **sin RFC** | **20%** | LISR 113-C-IV / LIF 2026 Art. 25-VI |
| Retención ISR — creador extranjero, **servicio personal** con fuente en MX | **25%** sin deducción (salvo tratado) | LISR 156 |
| Retención ISR — creador extranjero, **regalía** (derechos de autor) | **25%** (35% marcas/publicidad); ~10% con tratado | LISR 167-II / 152 |
| Umbral pago definitivo PF | **$300,000/año** | LISR 113-B |
| Acceso SAT en línea y tiempo real | Obligatorio desde **1-abr-2026** | CFF 30-B (DOF 07-11-2025) |

---

## 9. Obligaciones operativas de Vibra como retenedora (checklist)

1. **Inscribirse en el RFC como retenedora** de IVA e ISR (18-J-II-d / 113-C).
2. **Publicar precios con IVA** o con la leyenda **"IVA incluido"** (18-J-I). En B2C, lo natural es "IVA incluido".
3. **Capturar y validar el RFC** de cada creador MX en el onboarding fiscal (sin RFC: ISR 2.5%→20% e IVA 50%→100%). Va junto al KYC, que hoy opera a través de la procesadora.
4. **Determinar residencia fiscal** del creador (MX vs. extranjero) en el onboarding → define régimen (113-A vs. Título V) y % de retención de IVA (50% vs. 100%).
5. **Retener** IVA (50%/100%) e ISR (2.5%/20% a creadores MX; 0%/25%/35% a extranjeros según §7) al cobrar por cuenta del creador.
6. **Enterar** las retenciones al SAT **a más tardar el día 17** del mes siguiente.
7. **Expedir CFDI de Retenciones** (complemento "Servicios Plataformas Tecnológicas") **dentro de 5 días** del mes siguiente, al creador.
8. **Para creador extranjero (EX–MX):** emitir el **comprobante 18-D-V** al comprador que lo solicite (IVA por separado, a nombre propio o del creador).
9. **Informar al SAT** los datos de cada creador (nombre, RFC/ID, CURP, domicilio, CLABE, monto de operaciones) en los plazos de las RMF.
10. **Capturar y conservar los 4 indicios del Art. 18-C** por transacción como evidencia de la clasificación de IVA.
11. **Habilitar el acceso del SAT en línea/tiempo real** (CFF 30-B) antes del **1-abr-2026** y considerar la **responsabilidad solidaria** por retenciones no efectuadas.

---

## 10. Datos fiscales a capturar (onboarding) — para construir la lógica del sistema

**Del creador (define régimen, % de retención y CFDI):**
- Residencia fiscal: **MX / extranjero** (+ país).
- Si MX: **RFC**, CURP, régimen fiscal, domicilio fiscal, CLABE, constancia de situación fiscal.
- Si extranjero: identificación fiscal del país, **constancia de residencia fiscal** (para aplicar tratado y evitar 25%/35% por defecto), cuenta de depósito (**MX vs. extranjero** — define supuesto de retención al 100%), y **caracterización del servicio** (contenido/obra → posible regalía vs. servicio personal — ver §7).

**Del comprador (define el 16% y respalda la clasificación):**
- Los **4 indicios del Art. 18-C** por transacción (domicilio, medio de pago/banco emisor, IP, código telefónico).
- Solo si pide factura: RFC, uso de CFDI, régimen.

**Por transacción (para el ledger/wallet):**
- **Residencia del comprador** y **residencia del creador** (las dos, por separado — determinan cosas distintas).
- **Impuesto cobrado al comprador:** país, nombre del impuesto, tasa y monto (snapshot inmutable, §0.4).
- **IVA mexicano de la venta de Vibra:** 16% o 0% de exportación, y **el inciso del Art. 29-IV** en que se apoya el 0% (D-08).
- **Base sin impuesto** (sobre la que corre el reparto 75/25) y **margen de Vibra**.
- **Pago al creador:** retenciones aplicadas (D-06) y referencia a sus comprobantes.
- Los **4 indicios del Art. 18-C** como evidencia de la ubicación del comprador.

> Ya **no** se registra "comisión de Vibra y su IVA": bajo vendedor directo el 25% es margen, no un servicio de mediación gravado aparte (§5).

---

## 11. Lo que DEBES cerrar con un fiscalista antes de producción

1. **Texto verbatim del Art. 18-J reformado (DOF 07-11-2025):** confirmar que (a) incorpora a plataformas **residentes en México** como retenedoras del 100% y (b) la redacción amplia ("preste servicios") cubre las **videollamadas 1-a-1** (servicios 6–8), o si estas caen en importación (Art. 24-V).
2. **ISR del creador extranjero (§7):** clasificar los 11 servicios en regalía (Art. 167) vs. servicio personal (Art. 156) vs. beneficio empresarial; `vod_ticket`/`premium_post` son el mayor riesgo de regalía (25%). Idealmente, **dictamen formal o consulta al SAT (Art. 34 CFF)**.
3. **Comisión de Vibra a creador extranjero + fan mexicano (§5):** ¿16% obligado o 0% defendible? Y cómo satisfacer el requisito de **pago desde cuenta en el extranjero** (Art. 58 RLIVA) dentro del modelo agregador.
4. **0% de exportación en MX–EX (fila 3, §4):** misma tensión del Art. 58 RLIVA con el flujo agregador; confirmar si procede el 0% o el fallback es 16%.
5. **Propinas/"donaciones" (§6.1):** confirmar la postura conservadora (gravadas + retención).
6. **Naturaleza del "comprobante" 18-D-V vs. CFDI acreditable:** confirmar que no genera acreditamiento para compradores contribuyentes (impacto en nicho B2B, si existiera).
7. **Naturaleza LIF del 2.5%:** es vigencia anual (no reforma permanente al 113-A); vigilar la LIF 2027.

---

## Anexo A — Estado de integración en el sistema (2026-07-27)

Se empezó a integrar el cobro de IVA en la UI. Decisiones de producto aplicadas:
**el IVA se SUMA sobre el precio base del creador** (el creador recibe siempre sobre la
base) y **se cobra según la ubicación del comprador al comprar** (IP + método de pago),
sin excepción de turista.

**Hecho (Fase 0 + 1 — infraestructura y visualización):**
- `lib/tax/config.ts` — tabla de tasas por país. **Solo MX = IVA 16%** está activo; los otros 16 países quedan sin impuesto hasta configurarse uno por uno.
- `lib/tax/useBuyerCountry.ts` — señal del país del comprador (cookie `vibra_country`).
- `middleware.ts` — fija/**refresca** `vibra_country` por IP (rastrea ubicación actual, no preferencia; por eso el turista en MX paga IVA).
- `lib/currency/usePriceFormat.ts` — `formatWithTax()` devuelve Subtotal / IVA / Total.
- `components/payments/ServicePaymentModal.tsx` — desglose Subtotal / IVA / Total en el panel de pago.
- `components/payments/TaxNote.tsx` — nota "+ impuestos" bajo los precios mostrados. Conectada en: tarjetas de experiencias (`CreatorExperiencesSection`), precio de ticket de live (`LiveViewerModal`) y precio de suscripción a comunidad (`groups/[groupId]/page`). El resto de compras pasan por el panel de pago, que ya muestra el desglose completo.

**Hecho (Fase 3a — cobro del IVA en el BACKEND, verificado con type-check):**
- El **cobro del IVA vive en el backend** (`backend/src/payments/serviceCharge.ts` → `chargeServiceIntent`): recibe la BASE, le suma el IVA según el país del comprador y cobra el total. El cliente ya **no** multiplica (revertido). Config en `backend/src/tax/config.ts`.
- El intent guarda el **desglose fiscal** (`baseAmount`, `taxCountry`, `taxRate`, `taxAmount`, `chargedAmount`) como registro.
- **Las ganancias del creador NO cambian:** el ledger las calcula sobre la **base** (desde los docs de dominio), no sobre lo cobrado. El IVA es de Vibra hacia el SAT. Suscripción (Preapproval): cobra base+IVA mensual pero registra la ganancia sobre la base.
- El país fiscal lo manda el cliente (`card.taxCountry`, por IP) en las 9 vías de pago (8 vía `chargeServiceIntent` + suscripción).

**⚠️ Marcadores `🔁 STRIPE-MIGRATION` (lo que falta / debe rehacerse al integrar Stripe):**
- **Determinación fiscal autoritativa en backend:** hoy el país viene del cliente (IP). Con Stripe debe determinarlo el servidor (IP del request + país de la tarjeta por BIN de Stripe) y conservar los **indicios 18-C**.
- **Split de retención + CFDI:** calcular la retención (50%/100% IVA, ISR 2.5%/20%) y emitir el **CFDI de retención**. Requiere capturar RFC/residencia del creador (Fase 3b-2/3b-3/3b-4, con fiscalista y proveedor de timbrado PAC).

**Hecho (Fase 3b-1 — "IVA cobrado" en el Wallet, verificado con type-check):**
- El IVA se propaga del `paymentIntent` al ledger: `reconcile.materializeFromIntent` copia `taxCountry`/`taxAmount` al doc de dominio → los triggers lo pasan a `recordEarning` → se guarda por venta y se acumula en `walletSummary.lifetimeTaxCollected` (suma al ganar, resta al reembolsar). Suscripción: se pasa el IVA de cada cobro mensual.
- El Wallet (finanzas) muestra "**IVA cobrado (va al SAT)**" como línea de transparencia (solo si hubo ventas con impuesto). NO suma a ganancias ni al saldo retirable. i18n en es/en/pt-BR.
- **Las ganancias siguen sobre la base** (el IVA nunca infla el neto del creador).

**Propinas/donaciones (decidido 2026-07-27):** se les **suma IVA igual que todo** (son contraprestación gravada, §6.1). El modo donación del panel de pago muestra el desglose Subtotal / IVA / Total sobre el monto que elige el fan, y el cobro se multiplica por (1+tasa). Con esto, la feature "+impuestos" (visualización + cobro coherente) queda **completa**; lo que resta es la determinación autoritativa en backend (Fase 2/Stripe) y el desglose del Wallet (Fase 3).

---

## Anexo B — Operativa de facturación cuando el comprador no pide factura

> 🔗 **La tabla vive en §0.1** (matriz única y autoritativa).
>
> ♻️ **Actualizado 2026-08-26.** Manda el **esquema de tres comprobantes de §0.3**: Vibra emite la
> factura de venta **por cuenta del creador**, con el sello digital de éste; le factura su comisión; y
> le entrega la constancia de retenciones. **La factura del creador a Vibra ya no existe** — era una
> pieza del modelo de vendedor directo, donde el creador era proveedor.

**Cuando el comprador NO pide factura:**
- Al comprador se le da un **comprobante de pago** (no fiscal). Y ya.
- Las **retenciones y el CFDI de retención al creador se hacen IGUAL** — no dependen de que el comprador pida factura.
- 🔴 La **factura global mensual** (ventas a público en general no facturadas) **deja de ser opcional**.
  Bajo intermediación cada creador tiene su propia obligación de facturar todas sus ventas. Si Vibra no
  la emite por su cuenta, cada creador debe presentar la suya cada mes — eso no escala. **Corolario: el
  sello digital se necesita desde el primer mes de ventas, no solo antes del primer retiro.**

**Regla en una frase:** el IVA lo retiene y declara **Vibra** donde aplica (100% si el creador es extranjero, 50% si es mexicano); el creador mexicano solo carga con el 50% restante del IVA y su ISR ya neteado.

---

## Fuentes

**Leyes y reglamento (texto vigente, Cámara de Diputados):**
- LIVA: http://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf · historial: https://www.diputados.gob.mx/LeyesBiblio/ref/liva.htm
- Reglamento de la LIVA (Art. 58 — exportación de servicios): http://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf
- LISR: https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- CFF (reforma 62, Art. 30-B, DOF 07-nov-2025): https://www.diputados.gob.mx/LeyesBiblio/ref/cff/CFF_ref62_07nov25.pdf

**SAT:**
- Art. 18-B LIVA (PDF SAT): https://www.sat.gob.mx/minisitio/EstimulosFiscalesFronteraNorteSur/region_fronteriza_sur_iva/documentos/Articulo_18BLIVA.pdf
- Art. 14 LIVA: https://sat.gob.mx/articulo/00122/articulo-14 · Art. 29 LIVA: https://www.sat.gob.mx/articulo/80321/articulo-29
- Disposiciones fiscales para Plataformas de Intermediación: http://omawww.sat.gob.mx/plataformastecnologicas/Paginas/PlataformasTecnologicas_Intermediacion/documentos/DisposicionesFiscales_intermediacion.pdf
- Retención a residentes extranjeros que prestan servicios digitales (comunicado): https://www.gob.mx/sat/prensa/inicio-de-vigencia-de-normatividad-respecto-de-la-retencion-de-impuestos-por-residentes-en-el-extranjero-que-prestan-servicios-digitales-sin-establecimiento-en-mexico-015-2020?idiom=es

**DOF / RMF / reforma 2026:**
- Reforma fiscal 2026 (LIF, CFF, LIEPS): DOF 07-11-2025 — https://www.dof.gob.mx/nota_detalle.php?codigo=5772359&fecha=07/11/2025
- RMF 2026: https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/RMF_2026-DOF-28122025.pdf

**Análisis profesional y jurisprudencia:**
- EY — Paquete Económico 2026, ISR e IVA plataformas: https://www.ey.com/es_mx/technical/tax/boletines-fiscales/propuestas-isr-e-iva-sector-plataformas-digitales
- Holland & Knight — Reforma fiscal 2026: https://www.hklaw.com/en/insights/publications/2025/11/reforma-fiscal-para-2026-en-mexico
- IDC — Retenciones a personas morales por plataformas 2026: https://idconline.mx/fiscal-contable/2025/10/10/retenciones-a-personas-morales-por-plataformas-digitales-2026
- IDC — Consecuencia en IVA de no alinearse (Art. 18-I / importación): https://idconline.mx/fiscal-contable/2020/06/01/consecuencia-en-iva-de-que-los-extranjeros-no-se-alineen-con-la-economia-digital
- Basham / Lexology — Retención IVA 100% y cuentas en el extranjero: https://www.lexology.com/library/detail.aspx?g=577b0819-de2a-4a0f-b6de-540109fe405b
- Sovos — SAT amplía "servicio digital de intermediación" (Criterio 40/IVA/N): https://sovos.com/mx/cambios-regulatorios/iva/el-sat-amplia-la-definicion-de-servicio-digital-de-intermediacion/
- KPMG — Exportación de servicios a tasa 0%: https://kpmg.com/mx/es/tendencias/2024/02/ao-exportacion-de-servicios-sujeta-a-la-tasa-0-de-iva.html
- IDC — Tasa 0% en comisiones / jurisprudencia 2031805: https://idconline.mx/fiscal-contable/2026/03/23/tasa-0-de-iva-en-comisiones-aprovechamiento-en-el-extranjero
- Baker Tilly — ISR plataformas digitales: https://www.bakertilly.mx/opinion/puntos-finos-r%C3%A9gimen-tributario-del-isr-para-los-servicios-de-plataformas-digitales-en-m%C3%A9xico
- SDV Asesores (compendio articulado): LIVA 29 https://sdv.com.mx/compendio/ley-iva/articulo-29/ · LISR 113-A https://sdv.com.mx/compendio/ley-isr/articulo-113-a/ · LISR 156 https://sdv.com.mx/compendio/ley-isr/articulo-156/ · LISR 167 https://sdv.com.mx/compendio/ley-isr/articulo-167/

---

*Nota metodológica: las tasas 2026 se verificaron cruzando ≥2 fuentes independientes por punto (DOF, despachos Big Four y publicaciones especializadas), porque los PDF binarios de diputados.gob.mx no permiten extracción automática limpia y aún no incorporan la reforma 2026. Para un dictamen formal, la cita definitiva es el DOF 07-11-2025 y el PDF vigente de la Cámara de Diputados. Confirmar la redacción consolidada del 18-J reformado, del 113-A + LIF 2026 Art. 25-VI, y del CFF 30-B antes de redactar cláusulas o configurar el sistema.*
