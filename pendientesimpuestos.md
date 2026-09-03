# Pendientes de impuestos — plan de ejecución

> Lista viva de lo que falta para que Vibra pueda **timbrar de verdad**. Se trabaja **en orden**:
> cada paso está donde está porque desbloquea al siguiente, no por importancia.
>
> Creado el 2026-09-02. Estado de lo ya construido: `docs/facturacion-pendientes.md`.
> Modelo fiscal y decisiones: `docs/legal/fiscal-iva-isr-plataforma.md`.
>
> 🚧 **Nada de esto timbra todavía.** `const TIMBRAR = false` en
> `backend/src/facturacion/runCreatorMonthlyDocs.ts:48`. El proceso mensual calcula, acumula y
> registra, pero no emite. Timbrar es irreversible —cancelar un CFDI es un trámite, no un
> borrado—, así que el interruptor se enciende **solo cuando el grupo A esté completo**.

---

## Por qué este orden

```
A0  moneda del CFDI  ──┬──> A2  la global marca ventas ──> A3  candado del doble timbrado
   (sin esto los       │                               └──> B5  cola de facturas pendientes
    importes salen     │                                        └──> A1  cadencia de 24 h
    mal)               │                               └──> B7  cancelación motivo 04
                       └──> A5  constancia desde los retiros ── contador

A4  clave de retención ── contador ──> bloquea TIMBRAR por su cuenta

B6, B8, E   independientes, se pueden hacer en cualquier hueco
C           fuera de código, en paralelo, con el contador
D           al final, cuando A esté cerrado
```

Dos razones concretas para no alterarlo:

1. **A3 lee lo que escribe A2.** El candado que impide facturar dos veces la misma venta necesita
   la marca que hoy la global no pone. Al revés no funciona.
2. **A1 va después de B5.** Acortar el ciclo de la global a 24 horas *multiplica* la frecuencia
   con la que un creador sin sello se queda sin documentar el periodo. La cola es lo que
   convierte eso en algo recuperable.

---

# GRUPO A — Bloquean encender `TIMBRAR`

## A0 · Los CFDI llevan importes en USD etiquetados como MXN ✅ HECHO (2026-09-02)

**Encontrado el 2026-09-02, al redactar este documento. No estaba en ninguna lista.**

El ledger es USD desde el corte a Vibra On, LLC (`SETTLEMENT_CURRENCY = "USD"`), así que
`grossAmount`, `acc.base` y `acc.comision` son **dólares**. Los tres emisores del proceso
mensual los mandan a Facturapi declarando pesos:

| Dónde | Qué manda |
|---|---|
| `globalInvoice.ts:161` | `currency: "MXN"` con `price: t.base` en USD |
| `creatorMonthlyDocs.ts:216` (comisión) | `currency: "MXN"` con `price: acc.comision` en USD |
| `creatorMonthlyDocs.ts` (retenciones) | `total_base: acc.base` sin moneda, Facturapi asume MXN |

Una global de 100 USD de ventas se timbraría como **$100 MXN**. El importe es lo único que el SAT
no perdona.

### La decisión (2026-09-02): moneda distinta por comprobante

CFDI 4.0 admite `Moneda` + `TipoCambio`, y el tipo de cambio es el **FIX de Banxico publicado en
el DOF el día hábil anterior** a la fecha del comprobante (Art. 20 CFF). Es legal facturar en
dólares. Pero no conviene igual en los tres:

| Comprobante | Moneda | Fecha y tipo de cambio |
|---|---|---|
| **Venta al comprador** | **MXN** | Los **pesos realmente cobrados** (`presentmentAmount`). Sin conversión. |
| **Comisión de Vibra** | **MXN** | Suma de la comisión en pesos de cada venta, con el tipo de cambio congelado de esa venta. ⚠️ Corregido: se había dicho «USD con `TipoCambio`», ver abajo. |
| **Constancia de retenciones** | **MXN** | Al tipo de cambio **del retiro**. Ver §A5. |

**Por qué la venta va en pesos y no en dólares con tipo de cambio:** el comprador mexicano **pagó
en pesos**. Facturar en USD declararía una denominación que la operación nunca tuvo, y un importe
en pesos *calculado* que no coincide con el que le cargaron a la tarjeta.

Y el argumento que lo cierra: **la global agrupa ventas de días distintos**, y un CFDI lleva **un
solo** `TipoCambio`. Una global semanal en dólares aplicaría una única tasa a ventas hechas a
tasas diferentes — mal por definición. Sumando los pesos reales de cada venta, el problema no
existe.

**⚠️ De dónde salen los pesos reales — corregido el 2026-09-02.** `generateBuyerInvoice` *parece*
usarlos, pero **no lo hace**: su rama `intent.settlementCurrency === "MXN"`
(`generateBuyerInvoice.ts:187`) **nunca se cumple**, porque `settlementCurrency` es **siempre
`"USD"`** (`composeCharge.ts:134`). Es código muerto de cuando la denominación era en pesos. Hoy
toda factura del comprador cae al respaldo y convierte con la tabla `config/exchangeRates`.

Los pesos realmente cobrados están en otro campo del `paymentIntents/{id}`:
**`presentmentAmount` + `presentmentCurrency`**, que es lo que se le cargó a la tarjeta.

- **Usar:** `presentmentAmount` cuando `presentmentCurrency === "MXN"`; si no, convertir.
- 🚨 **Trampa:** si el comprador pagó parte con **saldo a favor**, el `presentment` es el del
  **remanente** cobrado a la tarjeta, no el precio completo. El CFDI tiene que cubrir la venta
  entera, crédito incluido. Ver `reserveCreditAndSplit`.

### Cómo se obtienen los pesos: se despejan del cobro real

Nada de tablas. El tipo de cambio verdadero de cada operación está implícito en lo que se cobró:

```
tipoCambio = presentmentAmount / (settlementAmount − creditApplied)
totalMxn   = importeFiscalUsd × tipoCambio
```

Es la tasa **que de hecho se le aplicó a ese comprador ese día**. Resuelve sola el saldo a favor:
`presentmentAmount` cubre el remanente, dividir entre el remanente da la tasa, y la tasa se aplica
a la venta completa.

Dos casos aparte: **pago 100% con saldo** (no hubo cobro, no hay `presentment`) cae a
`config/exchangeRates` congelada del día, marcado `fuente: "tabla"`; y **comprador no mexicano**,
que va a exportación 0% y no lleva CFDI.

**Se congela EN LA VENTA, una sola vez**, en el asiento del ledger y su espejo en `purchases`:
`fiscalMxn: { total, base, iva, tipoCambio, fuente, congeladoEn }`. No se recalcula jamás — un
CFDI reexpedido en 2028 tiene que dar el mismo número.

### ⚠️ Por qué la comisión ya NO va en USD con `TipoCambio`

Corregido el 2026-09-02: **no tenemos fuente del FIX de Banxico.** `config/exchangeRates` sale de
una API pública gratuita congelada a diario (`backend/src/exchangeRates.ts`), **no del DOF**. Poner
un `TipoCambio` en un CFDI con una tasa que no es la oficial es peor que no ponerlo. Emitir en
pesos con la tasa **real del cobro** sí es defendible, y deja los tres documentos bajo una sola
regla.

### El tipo de cambio del retiro NO afecta a la venta

Pregunta de Luis (2026-09-02): *«el dinero no se envía ese mismo día y podría llegar con otro tipo
de cambio».* **No toca el CFDI de la venta.** El IVA se causa cuando la contraprestación se cobra
**efectivamente** (LIVA art. 1-B), y se cobró el día que pagó el comprador; bajo intermediación
Vibra cobra *por cuenta del creador*, así que fiscalmente el creador cobró ese día. Lo que pase
después con ese dinero no cambia el impuesto de la venta: la diferencia de cambio entre la venta y
el retiro es una **ganancia o pérdida cambiaria**, resultado contable, no un impuesto que
recalcular.

⚠️ Y atar el CFDI al retiro sería peor: un creador que no retira en seis meses dejaría seis meses
de ventas sin facturar, incumpliendo el plazo de 24 horas de §A1.

**Donde sí importa el tipo de cambio del retiro es en la constancia de retenciones — §A5.**

### ❌ Descartado: emitir la global al aceptar el retiro

Propuesta de Luis (2026-09-02): esperar al retiro y emitir ahí la global de lo no facturado, con
los montos exactos en pesos de ese día. **Descartado**, y conviene dejar por qué para no volver a
discutirlo.

**La confusión de origen:** la factura global documenta las **VENTAS a los compradores**, no el
pago al creador. Su receptor es `PÚBLICO EN GENERAL` (`XAXX010101000`) y su importe es lo que
pagaron los compradores —`grossAmount` + `taxAmount` de cada compra—, **no el 75% del creador ni
lo que le cae al banco**. La incertidumbre del tipo de cambio del retiro es otro número, y no
aparece en ese CFDI. El que sí aparece se conoce exacto el día de cada venta.

Cuatro razones para no atarla al retiro:

1. **El plazo de 24 h.** Un creador que retira cada tres meses deja tres meses sin facturar, y uno
   que nunca junta los 300 USD del mínimo **no facturaría jamás**. Incumplimiento estructural.
2. **La obligación es del creador porque vendió**, no porque cobre. Que el dinero espere en la
   wallet no la suspende.
3. **Un retiro agrupa ventas de muchos días.** Fechar el CFDI el día del retiro haría que
   `periodicity` y `months` mientan sobre cuándo ocurrieron las operaciones.
4. **Los retiros se rechazan.** Habría que cancelar un CFDI —un trámite, no un borrado— porque un
   flujo operativo falló. Un documento fiscal no puede quedar rehén de eso.

**Lo que sí se ata al retiro es la constancia de retenciones (§A5)**, y parcialmente el IVA de la
comisión (§C8).

- **Hacer:** que los tres emisores apliquen la tabla de arriba, cada uno con su fuente.
- **Ojo:** la conversión debe quedar guardada por documento, no recalcularse al vuelo. Un CFDI
  reexpedido meses después tiene que dar el mismo número.
- **Desbloquea:** todo lo demás. Sin importes correctos, ordenar bien qué se factura no sirve.

### ✅ Cómo quedó (2026-09-02)

| Pieza | Dónde |
|---|---|
| El despeje del tipo de cambio, con su banda de cordura y el cuadre base+IVA=total | 🆕 `backend/src/facturacion/importeFiscal.ts` |
| Congelado en la venta (`fiscalMxn`), solo comprador mexicano, sin poder tumbar el cobro | `backend/src/wallet/ledger.ts` |
| Espejado a la compra del comprador, que es de donde se factura | `backend/src/wallet/buyerPurchases.ts` |
| La factura del comprador lee lo congelado; se retiró la rama muerta | `backend/src/facturacion/generateBuyerInvoice.ts` |
| La global **suma pesos** y excluye lo no congelado, contándolo aparte | `backend/src/facturacion/globalInvoice.ts` |
| CFDI de comisión en pesos, y se niega a timbrar si al mes le faltan ventas | `backend/src/facturacion/creatorMonthlyDocs.ts` |
| Backfill de las ventas anteriores | 🆕 `scripts/backfill-importe-fiscal.ts` |
| 14 pruebas: saldo a favor, cuadre de centavos, tasa imposible, basura de Firestore | 🆕 `backend/test/importeFiscal.pure.test.ts` |

🚧 **La constancia de retenciones quedó BLOQUEADA a propósito.** `emitirCfdiRetenciones` lanza en
vez de emitir, porque sus importes salen de las ventas del mes y la retención ocurre en el retiro
(§A5). Con `TIMBRAR` en falso no se ejecuta nunca; el bloqueo está para que encender el interruptor
no la emita mal. La bandera es `CONSTANCIA_BLOQUEADA`, anotada como `boolean` y no como literal
para que TypeScript siga comprobando el cuerpo que se va a reactivar.

✅ **Desplegado el 2026-09-02.**

⚠️ **Pendiente operativo:** correr el backfill (`scripts/backfill-importe-fiscal.ts`, primero con
`--dry`). Hasta entonces las ventas anteriores al 2026-09-02 no entran en la factura global, y el
proceso mensual las cuenta en `ventasSinPesos`.

---

## A1 · La global incumple el plazo de 24 horas 🔴

El cron corre el **día 5 sobre el mes anterior** (`runCreatorMonthlyDocs.ts:194`,
`schedule: "0 9 5 * *"`). La RMF 2026, regla **2.7.1.21**, exige el CFDI global **dentro de las 24
horas siguientes al cierre de las operaciones**. Son unos 35 días de retraso: **incumple el día
que se encienda `TIMBRAR`.**

- **Hacer:** reprogramar. Ya investigado: la periodicidad **quincenal** es válida (clave `03` de
  `c_Periodicidad`, Anexo 20), pero no resuelve el plazo. Lo que lo resuelve es **diaria**
  (clave `01`) o **semanal** (clave `02`) emitida dentro de las 24 h del cierre.
- **Ojo:** el cuerpo de la global lleva hoy `periodicity: "04"` (mensual) y un campo `months`.
  Cambiar la cadencia obliga a cambiar la clave **y** lo que se manda en `months`, y a que
  `rangoDelPeriodo` y la idempotencia `{creatorId}_{periodo}_{tipo}` dejen de razonar en meses.
- **Va después de A2, A3 y B5.** Acelerar el ciclo antes de tener la marca y la cola multiplica
  el daño en vez de reducirlo.

---

## A2 · La global no marca las ventas que cubrió ✅ HECHO (2026-09-02)

`globalInvoice.ts` lee las ventas sin facturar y las agrupa, pero **no escribe nada de vuelta**.
Verificado: no hay un solo `set`, `update` ni `batch` en el archivo. Terminada la emisión, ninguna
venta sabe que ya está documentada.

- **Hacer:** al emitir, marcar cada compra con el folio o UUID de la global que la cubrió.
- **Ojo:** la marca tiene que escribirse en la **misma operación** que el registro del documento,
  o un fallo a la mitad deja ventas marcadas sin factura, o al revés.
- **Desbloquea:** A3 y B7. Sin saber qué global cubrió una venta, no se puede ni impedir la doble
  factura ni cancelar con motivo 04.

### ✅ Cómo quedó: reserva en dos fases

Timbrar y marcar **no pueden ser atómicos** —el timbrado es una llamada a Facturapi y las marcas
son cientos de documentos, muy por encima del límite de una transacción—, así que hay que elegir
qué se rompe si falla a la mitad. Las dos opciones ingenuas son malas:

| Orden | Qué pasa si falla a la mitad |
|---|---|
| Timbrar → marcar | Las no marcadas entran en la global siguiente, pero la primera **ya las incluyó** ⇒ **timbradas dos veces** |
| Marcar → timbrar | Si el timbrado falla, quedan marcadas y no vuelven a entrar en ninguna global ⇒ **nunca documentadas** |

La salida son tres pasos: **reservar → timbrar → confirmar**. La venta se aparta con estado
`emitiendo` antes de timbrar, y `ventasSinFacturarDelMes` la excluye desde ese momento. Lo que se
rompa en medio deja ventas atascadas en `emitiendo`, que **no se timbran dos veces** y salen
contadas en el informe (`ventasAtascadas`) para revisarlas a mano. Es el estado feo pero seguro.

La marca guarda `periodo`, `estado`, `facturapiId` y `uuid` — que es justo lo que §B7 necesita
para cancelar con motivo 04.

### 🚨 Y una trampa que estaba al lado: `yaEmitido` mentía

`registrarDocumento` se llamaba **también con `TIMBRAR` apagado**, con `facturapiId: null`, y
`yaEmitido` solo miraba si el registro existía. Cada pasada en falso daba el mes por hecho, así
que **el día que se encendiera el interruptor, todos los meses ya «procesados» se habrían saltado
para siempre** — meses enteros de ventas sin documentar y sin forma de notarlo.

Ahora el registro guarda `timbrado` y `yaEmitido` significa *timbrado*, no *registrado*. El
comprobante de liquidación es la excepción: no es un CFDI, y para él existir sí es haberse
emitido. Con `TIMBRAR` apagado la global ya no registra ni marca nada; solo cuenta en
`globalesSimuladas`.

### 🚨 Faltaban los índices de `purchases`

`firestore.indexes.json` **no tenía ni uno** para `purchases`, y `ventasSinFacturarDelMes` hace
una consulta de grupo de colecciones con `creatorId ==` más rango de `occurredAt`. Habría fallado
en producción con `FAILED_PRECONDITION`, tragado por el `try/catch` por creador y contado como un
error genérico. Añadidos los dos que hacen falta y desplegados.

| Pieza | Dónde |
|---|---|
| Reserva, confirmación y recuento de atascadas | `backend/src/facturacion/globalInvoice.ts` |
| Las tres fases en su orden, y el ramal de `TIMBRAR` apagado | `backend/src/facturacion/runCreatorMonthlyDocs.ts` |
| `timbrado` en el registro y el nuevo significado de `yaEmitido` | `backend/src/facturacion/creatorMonthlyDocs.ts` |
| Dos índices de `purchases` | `firestore.indexes.json` |
| 8 pruebas de emulador | 🆕 `backend/test-emulator/globalInvoice.emulator.test.ts` |

✅ **Desplegado el 2026-09-02** (funciones e índices).

---

## A3 · Se puede facturar dos veces la misma venta ✅ HECHO (2026-09-02)

`generateBuyerInvoice` solo rechaza si `p.invoiced === true` (línea 168), y esa marca la pone
únicamente la factura nominativa. Como la global no marca nada (A2), un comprador que pide su
factura después de que la global ya la incluyó **la obtiene**: la misma venta timbrada dos veces,
con el sello del creador en ambas.

- **Hacer:** que `generateBuyerInvoice` se niegue si la venta ya está en una global, con un
  mensaje que dirija al procedimiento del motivo 04 (B7) en vez de a un error mudo.
- **Depende de:** A2.

### ✅ Cómo quedó: exclusión mutua, no solo un candado

El candado a secas no bastaba. Los **dos** caminos timbraban primero y marcaban después, así que
entre la comprobación y el timbrado quedaba un hueco de varias llamadas de red —alta del cliente
en Facturapi, lectura del perfil fiscal— por el que la misma venta podía colarse en los dos
comprobantes. Cerrar solo el lado del comprador habría dejado esa carrera abierta.

La regla es una sola y vive en un solo sitio, `compraLibre`: **una compra la documenta un
comprobante y solo uno**. Libre es no tener nominativa, ni una en curso, ni estar apartada por una
global —incluido el estado `emitiendo`, porque de una reserva a medias no se sabe si llegó a
timbrarse—. Los dos caminos preguntan lo mismo, y los dos **apartan en transacción, releyendo**,
antes de timbrar.

| Camino | Si al reservar ya no está libre |
|---|---|
| Factura global | La **salta en silencio** y sigue. El comprador ya tiene su factura, que es el resultado correcto |
| `generateBuyerInvoice` | Abandona **ese creador** y devuelve `ya_en_global`. Los demás creadores de la misma petición se timbran igual |

🚨 **El importe de la global se calcula sobre lo que se apartó, no sobre lo que se leyó.** Si se
quedara con el total de la consulta inicial, cobraría por una venta que acaba de irse a una
nominativa. Y la confirmación marca solo las reservadas, no las leídas.

🚨 **La reserva se suelta si el timbrado falla.** Sin eso, un fallo dejaría la compra apartada para
siempre — ni el comprador podría reintentar ni la global la recogería, y nadie lo notaría hasta que
alguien reclamara su factura meses después.

**En la interfaz**, `ya_en_global` tiene su propio mensaje. Antes caía en el genérico y le decía al
comprador que al creador le faltaban sus datos fiscales, mandándolo a esperar algo que nunca iba a
pasar.

| Pieza | Dónde |
|---|---|
| `compraLibre` y la reserva transaccional de la global | `backend/src/facturacion/globalInvoice.ts` |
| El candado, la reserva y la liberación del lado del comprador | `backend/src/facturacion/generateBuyerInvoice.ts` |
| El importe sobre lo apartado y la confirmación de lo apartado | `backend/src/facturacion/runCreatorMonthlyDocs.ts` |
| El motivo `ya_en_global` con mensaje propio | `lib/facturacion/buyerFiscal.ts`, `BuyerInvoicePanel.tsx` |
| 5 pruebas más de emulador (13 en total) | `backend/test-emulator/globalInvoice.emulator.test.ts` |

---

## A4 · La clave de retención es la equivocada 🔴 — *contador*

El código manda `key: "14"` (`creatorMonthlyDocs.ts:264`), que en `c_ClaveRetenc` es **«dividendos
o utilidades distribuidas»**. Vibra no reparte dividendos: retiene ISR e IVA por vender a través
de la plataforma.

La del complemento *Servicios Plataformas Tecnológicas* es la **`26`**, pero **no se cambia sola**:
con ella el SAT espera el complemento entero (`Periodicidad`, `NumServ`, `TipoDeServ`,
`MontToServSIva`), que hoy no se manda. Cambiar solo la clave produce un CFDI que no timbra, o
peor, uno que timbra mal.

Y antes hay una pregunta de fondo: ese complemento está redactado para transporte, comida,
hospedaje y comercio de bienes, no para servicios de creadores.

- **Hacer:** pregunta al contador y, según la respuesta, mandar el complemento completo.
- **Independiente del resto del grupo A**, pero bloquea `TIMBRAR` por su cuenta.

---

## A5 · La constancia de retenciones se arma desde las VENTAS, no desde los RETIROS 🔴

**Encontrado el 2026-09-02, verificando la pregunta del tipo de cambio. No estaba en ninguna lista.**

El diseño acordado el 2026-08-26 es que **la retención se aplica AL RETIRAR, no al vender**. Y el
código lo cumple:

| Momento | Qué pasa | Dónde |
|---|---|---|
| Venta | Se acredita el **75% íntegro**. ISR, IVA e IVA de comisión solo se **acumulan como pendientes** | `ledger.ts:683-685` (`pendingRetainedIsr`, `pendingRetainedIva`, `pendingCommissionVat`) |
| Retiro | Ahí sí se **retienen de verdad**, y ahí se guarda el `tipoCambio` real de la operación | `wallet/withdrawals.ts` |
| Constancia | ❌ Se arma con **los asientos del MES DE VENTA** (`status === "earned"`) | `creatorMonthlyDocs.ts:163` + `acumularMes` |

La constancia de septiembre diría «te retuve X» por las ventas de septiembre **aunque el creador
no haya retirado nada y su dinero siga íntegro en su wallet**. Documentaría una retención que
todavía no ocurrió.

Y hay una pregunta legal detrás: el **art. 113-A** habla de retener sobre los **pagos** que la
plataforma efectúa. Si el pago al creador no ha ocurrido, cuesta sostener que haya retención que
declarar y enterar.

- **Hacer:** construir la constancia desde **los retiros del periodo**, no desde las ventas. El
  retiro ya guarda `tipoCambio` y `acreditado`, así que el importe en pesos sale exacto y sin
  estimar — es justo el dato que falta hoy.
- **Ojo:** el importe de la retención se **congela en la venta** (`a.retenciones` de cada asiento)
  y se consume en el retiro. Al rehacerlo hay que decidir si la constancia usa el importe
  congelado o lo recalcula, y **no puede desalinearse de lo que se le descontó al creador**.
- **Ojo 2:** el **IVA de la comisión** viaja en el mismo saco de pendientes y se cobra también al
  retirar, así que el CFDI de comisión hereda parte de esta pregunta. La comisión base (el 25%) sí
  se toma en la venta, y esa parte no se discute.
### La solución elegida (2026-09-02): tipo de cambio del RETIRO

Cuando el dinero sale, los pesos no cuadran con los del CFDI de la venta, porque entre una fecha y
otra se movió el tipo de cambio. **No hay nada que corregir**: son dos números sobre cosas
distintas —el CFDI dice qué se vendió, el retiro qué recibió el creador— y la diferencia es una
**ganancia o pérdida cambiaria**, resultado contable. No obliga a nota de crédito ni a reexpedir.

Donde sí hay que elegir es en la retención, que se calcula sobre un saldo en dólares pero se
entera al SAT **en pesos**:

| Opción | Consecuencia |
|---|---|
| Pesos del **día de la venta** | Cuadra con el CFDI, pero enteramos pesos que no corresponden al dinero que de verdad se movió |
| ✅ Pesos del **día del retiro** | Cuadra con lo que se le descontó al creador y con lo que salió del banco, no con el CFDI de la venta |

**Elegida la segunda:** la retención existe porque hay un pago, así que se mide con el tipo de
cambio de ese pago — que el retiro ya guarda (`tipoCambio`, `acreditado`). La diferencia contra el
CFDI de la venta **es** la ganancia o pérdida cambiaria, y se explica sola.

⚠️ Sujeta a confirmación del contador en **C8**. Si respondiera que la retención se causa al
vender, se invierte la elección y la constancia se queda donde está hoy.

- **Depende de:** A0 (la convención de moneda) y de una respuesta del **contador** sobre cuándo se
  causa la retención.
- **Bloquea `TIMBRAR`.** Una constancia de retenciones mal fechada es un documento que el creador
  usa para acreditar, y el SAT cruza contra la declaración informativa.

---

# GRUPO B — Para que la global salga correcta

## B5 · Cola de facturas pendientes 🟡

Si el creador no tiene sello vigente, la petición de factura del comprador **se pierde**. No
existe nada parecido a una cola en el repo.

- **Hacer:** guardar la petición (solo la referencia a su `billingProfile` y las compras, sin
  duplicar sus datos fiscales) y emitirla sola con un trigger cuando `csdStatus` pase a `valid`.
- **Y esto es lo que MANTIENE CORRECTA LA GLOBAL:** esa venta se marca «factura solicitada» y la
  global **la excluye**, en vez de incluirla y tener que cancelarla luego con motivo 04.
- **Depende de:** A2, porque la exclusión se apoya en el mismo campo.
- **Desbloquea:** A1.

## B6 · Facturar desde «Ver detalles» más la notificación 🟡

Hoy solo se factura desde el modo selección de `BuyerInvoicePanel` en `/experiencias → Entregados
→ Todo`. Falta el botón desde **«Ver detalles»** de una compra concreta, y la **notificación de
pago exitoso** que lleve ahí.

Es experiencia de usuario, pero tiene efecto fiscal: cuanta más gente pide su factura **a tiempo**,
menos casos del procedimiento de tres pasos del motivo 04. Independiente, cabe en cualquier hueco.

## B7 · Cancelación motivo 04 🟡

Cuando alguien pide su factura nominativa de una operación **ya incluida en una global**, el
procedimiento del SAT son tres pasos: cancelar con motivo **04** («operación nominativa
relacionada en una factura global»), **reexpedir la global sin esa operación**, y emitir la
nominativa. El segundo paso necesita el sello del creador.

- **Hacer:** como excepción **manual** desde administración, no automática. Cancelar y reexpedir
  no es algo que deba dispararse solo.
- **Depende de:** A2.
- **Comparte máquina con el Bloque 6** (notas de crédito por reembolso de una compra ya
  facturada). Conviene hacerlos juntos.

## B8 · Recibo para comprador extranjero ⬜

`generateBuyerInvoice` es MXN-only y el CFDI es solo mexicano. El comprador extranjero se queda
hoy **sin ningún comprobante**. Falta el recibo, o comprobante de pago, con el monto en su moneda.

El equivalente del lado del creador **ya está resuelto**: `comprobanteLiquidacion.ts` genera el
comprobante de liquidación del creador extranjero, y a propósito se emite esté o no encendido el
timbrado, porque no depende de ninguna clave del SAT. Es el patrón a seguir.

Independiente de todo lo demás.

---

# GRUPO C — Preguntas abiertas del contador 🟠

Fuera de código. Se pueden mover en paralelo a A y B. Fuente: `docs/legal/fiscal-iva-isr-plataforma.md` §0.6.

| # | Pregunta | Por qué importa |
|---|---|---|
| C1 | **Exportación 0% de la COMISIÓN** de Vibra al creador extranjero | Es **otra operación**, distinta de la venta. Que los 11 servicios califiquen como exportación **no basta**. Si no califica, la comisión lleva 16% y **lo absorbe Vibra**, porque el creador extranjero no lo acredita. |
| C2 | Numeración exacta de la regla de **emisión por cuenta de terceros** | Se va a citar en el contrato marco |
| C3 | **Residencia fiscal de la LLC** y doble residencia | Decide si la comisión del caso extranjero-extranjero paga ISR mexicano |
| C4 | **Videollamadas 1-a-1** con creador extranjero | ¿Régimen de plataformas o importación de servicios? |
| C5 | **Altas de IVA fuera de México** | Vibra es proveedor considerado en varias jurisdicciones |
| C6 | Contabilidad: **ingreso = comisión**, no el 100% | Confirmar el asiento |
| C7 | La clave `90131500` está en la familia de **espectáculos públicos** | En México llevan impuestos **estatales**. Una transmisión por internet no es un espectáculo presencial, pero hay que confirmarlo. |
| C8 | **¿Cuándo se causa la retención del art. 113-A: al vender o al pagarle al creador?** | Decide si la constancia se arma desde las ventas o desde los retiros, y con qué tipo de cambio. Ver §A5, donde ya está elegida la opción del retiro a la espera de su confirmación. |
| C9 | **El comprador mexicano paga a Vibra un cargo de servicio (0.40 USD + 2% FX) y hoy no recibe ningún comprobante por él** | Encontrado el 2026-09-02. El CFDI del creador cubre **su precio**, no ese cargo, que según `impuestos.md` §1-2 es contraprestación de **Vibra** al comprador. ¿Hace falta un comprobante aparte? No bloquea §A0. |

---

# GRUPO D — Cutover a producción ⬜

**Al final, y solo con el grupo A cerrado.** Hoy todo es `sk_test`.

- Cambiar a `sk_live` (`FACTURAPI_LIVE_KEY`). ⚠️ **El RFC solo valida de verdad con llave LIVE**:
  en `sk_test` casi todo pasa.
- Subir el **CSD real de Vibra**; hoy usa el RFC de prueba `EIRG710515LI9`.
- Usar `apikeys/live` para las organizaciones de los creadores. Facturapi solo entrega la live al
  renovar (`facturapiOrganizations.ts:108`).

🧪 Para probar antes hay **CSD de prueba del SAT**, públicos. Cinco RFC, contraseña de la llave
`12345678a` en todos; el más usado, `EKU9003173C9`. ⚠️ El RFC de los datos fiscales tiene que
coincidir con el del sello, Facturapi lo valida al subirlo.

---

# GRUPO E — Menor ⚪

## E1 · Dónde elige el creador el país de su cuenta de cobro

`setCreatorPayoutAccountCountry` existe (`lib/facturacion/creatorFiscal.ts:96`) y el backend lo
guarda, pero **nadie lo llama desde la interfaz**. El motor ya lo aplica —fuera de México la
retención de IVA sube al 100%—, así que el dato importa.

**Mitigado hoy:** el cuestionario de alta de cobro cae al **país del documento del KYC**
(`payoutAccountQuestionnaire.ts:115`), que en la práctica acierta. Queda para cuando el alta de
cobro tenga pantalla propia.

---

# Tabla de estado

| # | Pendiente | Grupo | Depende de | Estado |
|---|---|---|---|---|
| A0 | Moneda del CFDI, USD etiquetado MXN | A | — | ✅ **Hecho** |
| A2 | La global marca las ventas | A | A0 | ✅ **Hecho** |
| A3 | Candado del doble timbrado | A | A2 | ✅ **Hecho** |
| A5 | Constancia desde los retiros, no las ventas | A | A0 + C8 | 🔴 Abierto |
| B5 | Cola de facturas pendientes | B | A2 | 🔴 **Siguiente** |
| A1 | Cadencia de 24 h | A | A2, A3, B5 | 🔴 Abierto |
| B7 | Cancelación motivo 04 | B | A2 | 🔴 Abierto |
| B6 | Botón «Ver detalles» más notificación | B | — | 🟡 Abierto |
| B8 | Recibo internacional | B | — | ⬜ Abierto |
| A4 | Clave de retención | A | Contador | 🔴 Abierto |
| C1–C9 | Preguntas del contador | C | Contador | 🟠 Fuera de código |
| E1 | País de cobro en la interfaz | E | — | ⚪ Mitigado |
| D | Cutover a producción | D | Grupo A y contador | ⬜ Al final |
| — | **Encender `TIMBRAR`** | — | **A0, A1, A2, A3, A4, A5** | 🚧 Apagado |

> Regla del proyecto: al cerrar cada punto se actualiza **esta tabla** y el documento informativo
> que quede obsoleto, en el mismo ticket.
