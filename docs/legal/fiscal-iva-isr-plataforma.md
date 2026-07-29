# Modelo fiscal de Vibra — IVA e impuestos indirectos (modelo VENDEDOR DIRECTO / seller of record)

> **Estado:** documento de diseño **operativo**, actualizado **2026-07-28** al **MODELO DE VENDEDOR DIRECTO**. Es la guía de referencia para **construir y desplegar** la facturación e impuestos.
> Las tasas por país se confirman con el fiscalista y la procesadora (Pagsmile/EBANX) **conforme se habilitan**; **México (16%) está confirmado** para arranque.
>
> **⚠️ Cambio de modelo (2026-07-28).** Hasta el 2026-07-27 este documento asumía a Vibra como **intermediaria/retenedora** (régimen 18-J / 113-A). El modelo aprobado como base ("Reporte maestro del nuevo modelo fiscal y operativo de Vibra", v1.0, 28-jul-2026) cambia el enfoque: **Vibra es la VENDEDORA directa frente al comprador en el modelo general.** Ver **§0**. Las secciones §1–§11 y los Anexos se conservan como **referencia del detalle fiscal mexicano** pero fueron escritas bajo el modelo anterior (ver nota al final de §0).
>
> **Alcance:** **México** (base fiscal) + **17 países LatAm** en **lista orientativa ABIERTA** — se ampliará/ajustará según los países que habilite la procesadora aprobada y la validación fiscal país por país. Solo **México (16%)** está confirmado para arranque.
>
> **Servicios BLOQUEADOS:** Sesión exclusiva\* y Tiempo contigo\* — no clasificar ni programar hasta decisión escrita.
>
> Marco (referencia mexicana): LIVA (Cap. III BIS, arts. 1º-A BIS, 16, 18-B a 18-M, 24, 29) y su Reglamento (art. 58);
> LISR (arts. 113-A a 113-D y Título V, arts. 153, 156, 167); CFF (art. 30-B); LIF 2026 (art. 25);
> RMF 2026; reforma DOF 07-11-2025; jurisprudencia del PJF. Fuentes al final.

---

## 0. MODELO VIGENTE: Vibra es VENDEDORA DIRECTA (seller of record)

En el modelo general, **el comprador contrata con Vibra, no con el creador.** Vibra fija el precio final, cobra, **determina el impuesto indirecto aplicable**, emite el comprobante/factura, concede el acceso o coordina la entrega, y administra cancelaciones, reembolsos, contracargos y la reclamación del consumidor. **El creador es PROVEEDOR de Vibra** (le suministra el contenido/ejecución/colaboración contratada).

**Consecuencia contable propuesta (a validar por contador):** el **100% del precio base** vendido = ingreso bruto de Vibra; la **participación del creador (≈77%)** = costo/obligación de pago; la **participación de Vibra (≈23%)** = margen. **El impuesto cobrado al comprador NO es ingreso ni base de reparto.** El reparto se calcula sobre el **precio base**, no sobre el total con impuesto.

### Dos cálculos INDEPENDIENTES (principio rector)

1. **Impuesto de la VENTA** → lo determina la **residencia del COMPRADOR** (el IVA/VAT/IGV del país donde se consume).
2. **Documentación y retención del PAGO al creador-proveedor** → lo determina la **residencia y régimen del CREADOR**.

El país del comprador fija el impuesto de la venta; el país del creador fija cómo se documenta y retiene el pago al proveedor. Son cálculos separados.

### 0.1 La matriz de las 4 combinaciones (modelo vendedor)

Convención: **Comprador / Creador**. Vibra es la vendedora (seller of record), residente en México.

| Combinación | Impuesto de la VENTA (lo define el comprador) | Relación con el CREADOR-proveedor (lo define el creador) | Estado |
|---|---|---|---|
| 🇲🇽 **MX / MX** | **IVA mexicano 16%** según naturaleza del servicio | Proveedor mexicano de Vibra → CFDI y retenciones según persona/régimen | Definir reglas por régimen |
| 🇲🇽 **MX** / 🌍 **EX** | **IVA mexicano 16%** (consumo en México) | Proveedor extranjero → revisar importación de servicios, docs y retenciones | Opinión fiscal requerida |
| 🌍 **EX** / 🇲🇽 **MX** | **Impuesto del país del comprador** (§0.2). IVA MX **0% solo** con evidencia material de exportación (Art. 58 RLIVA) | Proveedor mexicano de Vibra → CFDI y retenciones domésticas según régimen | Evidencia de exportación |
| 🌍 **EX / EX** | **Impuesto del país del comprador** (§0.2) | Proveedor extranjero → posible importación/adquisición transfronteriza | Ver §0.2 (17 países) |

> **Regla crítica.** NO implementar `buyerCountry != MX → IVA 0%`. La tasa 0% mexicana requiere clasificación exportable + evidencia de aprovechamiento en el extranjero. El impuesto del país del comprador se calcula de forma independiente.

### 0.2 Impuesto por país — LISTA ORIENTATIVA (abierta, sin validar)

> ⚠️ **Lista orientativa** (se valida por país conforme se habilita). Tasas y mecanismos de LatAm cambian rápido (Brasil en reforma 2026; Perú/Ecuador cambiaron en 2024). **La lista está ABIERTA:** se amplía/ajusta según **los países que habilite la procesadora (Pagsmile o EBANX)** y la validación fiscal por país. **México (16%) está confirmado** para arranque; el resto se activa al confirmar tasa + mecanismo. Las tasas viven en configuración versionada (no hardcode), así que agregar un país es cambiar config, no código.

| País | Tasa | Cómo se cobra | ¿Registro obligatorio? |
|---|---|---|---|
| 🇲🇽 México | 16% | Reg. proveedor extranjero (18-B) o retención vía plataforma | Sí (o retención) |
| 🇦🇷 Argentina | 21% | Retención por banco/emisora (percepción) | No |
| 🇧🇷 Brasil | Reforma CBS/IBS (ago-2026) | Registro + e-invoicing (en transición) | Sí (régimen 2026) |
| 🇨🇱 Chile | 19% | Registro simplificado; si no, retención | Sí (o retención) |
| 🇨🇴 Colombia | 19% | Registro y cobro; o retención voluntaria | Sí (o retención) |
| 🇵🇪 Perú | 18% | Registro como agente; retención desde dic-2024 | Sí |
| 🇺🇾 Uruguay | 22% | Registro y cobro | Sí |
| 🇩🇴 Rep. Dominicana | 18% | Registro desde la 1ª venta (sin umbral) | Sí (inmediato) |
| 🇨🇷 Costa Rica | 13% | Retención del 13% por el banco; registro voluntario | No (voluntario) |
| 🇪🇨 Ecuador | 15% | Retención por bancos/emisoras; registro opcional | No (opcional) |
| 🇵🇾 Paraguay | 10% | Retención por institución financiera | No |
| 🇬🇹 Guatemala | 12% | Régimen voluntario propuesto; si no, retención | Voluntario/retención |
| 🇧🇴 Bolivia | 13% | Régimen digital emergente (2024) | En definición |
| 🇸🇻 El Salvador | 13% | Sin régimen digital específico aún | Sin reglas claras |
| 🇭🇳 Honduras | 15% (ISV) | Dato limitado | Confirmar |
| 🇳🇮 Nicaragua | 15% | Dato limitado | Confirmar |
| 🇵🇦 Panamá | 7% (ITBMS) | Dato limitado sobre digital | Confirmar |

**Patrón operativo:** en 🟢 **Argentina, Costa Rica, Ecuador, Paraguay** el impuesto lo **retiene el banco/procesador** (probablemente NO registras). En 🔴 **México, Brasil, Chile, Colombia, Perú, Uruguay, Rep. Dominicana** **debes registrarte** como proveedor extranjero. En 🟡 **Guatemala, Bolivia, El Salvador, Honduras, Nicaragua, Panamá** el régimen digital está incierto. **Esto lo confirman la procesadora (D-01) + el fiscalista (D-02).**

### 0.3 Servicios BLOQUEADOS

**Sesión exclusiva\* y Tiempo contigo\*** quedan fuera del modelo definitivo hasta decisión escrita (D-03/D-04). **No** asignar taxCategory, sellerOfRecord, factura, tasa, reparto ni payout a estos dos servicios.

### 0.4 Reglas de implementación

- **No 0% automático** por comprador extranjero (requiere evidencia de exportación material).
- **Importes inmutables por orden** (snapshot de tasa y FX); nunca reconstruir el historial con la config vigente.
- **No hardcode** de tasas: configuración versionada con vigencia, fuente oficial y aprobación.
- **Donaciones:** no llamarlas "donación" ni tratarlas como venta si el pago desbloquea acceso/derecho exigible; si son apoyo genuino, separar (pendiente opinión — D-05).

### 0.5 Decisiones pendientes (se resuelven en paralelo, NO bloquean construir)

| ID | Decisión | Propietario |
|---|---|---|
| D-01 | Rol de la procesadora (Pagsmile/EBANX) por país: ¿recauda/remite el impuesto o solo procesa? | Luis + procesadora |
| D-02 | Matriz fiscal validada de los países habilitados | Fiscalista internacional |
| D-03/D-04 | Clasificación final de Sesión exclusiva\* y Tiempo contigo\* | Luis + fiscalista |
| D-05 | Tratamiento de apoyos/donaciones y margen de Vibra | Fiscalista |
| D-06 | Retenciones y comprobantes por régimen del creador-proveedor | Fiscalista México |
| D-07 | Presentación contable 100/77/23 y VAT de proveedor | Contador |

**Estado:** base aprobada para **construir la integración**. México (16%) confirmado para arranque; los demás países se activan por configuración conforme se validan. Las decisiones pendientes se resuelven en paralelo sin frenar el desarrollo.

### 0.6 Facturación (Facturapi) — modelo de DOS CFDIs

Como Vibra es **vendedor directo**, la facturación se reduce a **2 comprobantes** (antes, como intermediario, eran ~3; **desaparece el "CFDI de comisión"** porque el 23% de Vibra es **margen**, no un servicio facturado al creador):

1. **Vibra → Comprador (factura de venta).** La emite **Vibra con SU propio CSD** (org de Vibra en Facturapi). **Self-service y automática:** el comprador pide factura, captura RFC/uso/régimen/CP, y se timbra al instante. Si no pide factura → **comprobante de pago** (no fiscal) y la venta entra a la **factura global** mensual.
2. **Creador → Vibra (factura de proveedor).** El creador es proveedor y factura su ~77% a Vibra. Requiere el **CSD del creador**. **Alta perezosa:** al querer **cobrar por primera vez**, el creador sube su CSD (se crea su **organización en Facturapi**) y acepta el **aviso legal de auto-facturación (self-billing)** — junto al KYC/monetización. De ahí en adelante, **cada pago genera su CFDI a Vibra automáticamente**. Las **retenciones** al creador-proveedor (ISR/IVA según su régimen) se calculan y reflejan en ese CFDI (D-06).

**Plan de integración por bloques (Facturapi):**

| Bloque | Qué | Estado |
|---|---|---|
| **0 · Base** | Cliente Facturapi + healthcheck + punto de enganche preparado (agnóstico de procesadora) | ✅ construido (sandbox, sin deploy; enganche NO conectado aún) |
| **1a · Datos fiscales creador** | RFC/régimen/CP + consentimiento self-billing (callable `saveCreatorTaxProfile` + doc `creatorTaxProfiles/{uid}` backend-only + reglas) | ✅ backend construido (sin deploy; falta UI) |
| **1b · CSD → org Facturapi** | Callable `uploadCreatorCsd` + helpers de organización. **Endpoints VERIFICADOS en sandbox** (crear org, PUT `/legal` sin tax_id, `/certificate` singular, DELETE). El RFC lo fija el CSD y se valida contra el RFC declarado | ✅ backend construido y endpoints verificados (sin deploy); falta correr la subida con un CSD real end-to-end |
| **1c · Datos fiscales comprador** | RFC/uso/CP — se captura al pedir factura | Va con Bloque 2 |
| **2 · Vibra→Comprador** | "Solicitar factura" self-service + timbrado inmediato con CSD de Vibra (MX 16%) | Se construye ya |
| **3 · Creador→Vibra** | Org por creador (CSD perezoso) + auto-CFDI cada pago (self-billing). Retenciones como parámetro (D-06) | Estructura ya; montos con fiscalista |
| **4 · Comprobante de pago** | Recibo no fiscal para compras sin factura | Se construye ya |
| **5 · Multi-país + factura global** | Tasas por país (config versionada) + factura global mensual | Conforme se habilita país/procesadora |
| **6 · Cutover producción** | CSD/keys reales + procesadora en vivo | Al final |
| **7 · Comprobante internacional** | Comprobante de pago para creadores EXTRANJEROS (cuando se les envía dinero fuera de México) | Pendiente — hasta tener retiros + API de pagos |

**Estado de avance (2026-07-29):**
- ✅ **Listos:** Bloque 0, 1a, 1b (CSD probado end-to-end) + toda la **UI del panel de retiro** (Auto con CSD, Manual con subida PDF/XML, copiar datos, animaciones, validación inline).
- ❌ **Faltan:** Bloque 2 (factura Vibra→comprador, **siguiente**), 1c (datos del comprador), 4 (comprobante de pago), **backend del Bloque 3** (timbrado real creador→Vibra self-billing + validación del XML manual; requiere resolver la API key por organización — el `401` del `GET /test-api-key`), 5 (multi-país + factura global), 6 (cutover), y 7 (comprobante internacional).
- El **sistema de retiros / payout (money-out)** sigue pendiente de la **API de pagos** elegida.

### 0.7 Flujo de retiro con gate fiscal (dónde vive la facturación en la UI)

La facturación del creador se resuelve en la **Wallet, al momento del retiro** (perezoso: solo lidia con lo fiscal cuando quiere dinero). **Ramifica por país fiscal del creador:**

- **Creador EXTRANJERO →** salta todo lo fiscal, va directo a confirmar monto + cuenta → `withdrawalRequest` → pago. (Sus impuestos se manejan en su país, en otro momento.)
- **Creador MEXICANO →** entra al **panel fiscal**:
  1. **Datos fiscales (una vez):** RFC / razón social / régimen / CP (`saveCreatorTaxProfile`).
  2. **Elegir cómo factura (una vez, recordado):**
     - **A) Automático (CSD):** sube su CSD una vez + acepta self-billing → org en Facturapi → retiros = 1 clic, factura instantánea (⚡ pago rápido).
     - **B) Manual:** se le muestran los **datos exactos a facturar** (receptor Vibra, subtotal, IVA, **retenciones**, total) y sube su CFDI.
  3. **Factura del retiro:** A = Vibra timbra sola (self-billing). B = sube XML → **validación automática con Facturapi** (timbrado, receptor = Vibra, total correcto).
  4. **Retiro creado:** entra al flujo `withdrawalRequest` existente. **La factura es prerrequisito**: sin CFDI válido no se libera el dinero.

**Cuenta bancaria (aparte, antes):** se captura en el **KYC de Didit** (con cotejo del titular vs. nombre KYC) y se guarda **extendiendo `payoutAccounts`** con `provider` (spei/stripe/payoneer/pagsmile) + campos según el rail. Proveedor de payout swappable por país.

**Parametrizado (pendiente D-06):** las **retenciones** (ISR/IVA que Vibra retiene al creador PF) dependen del **régimen** del creador. El cálculo queda parametrizado por régimen; los % exactos entran con el fiscalista.

---

> ⚠️ **NOTA SOBRE LAS SECCIONES SIGUIENTES (§1–§11 y Anexos).** Fueron redactadas bajo el modelo ANTERIOR de **intermediario/retenedor**. Se conservan como **referencia del detalle fiscal mexicano** (IVA del comprador mexicano, mecánica de retención al creador, jurisprudencia y tasas 2026), que sigue siendo útil. **Bajo el modelo de vendedor directo cambian:** (a) **Vibra** factura la venta al comprador (no el creador); (b) el "corte de comisión" pasa a ser **margen (≈23%)**, no una intermediación gravada aparte; (c) el creador es **proveedor** que factura a Vibra, y las retenciones se analizan sobre esa relación, no sobre una intermediación 18-J. La reelaboración fina al modelo vendedor queda pendiente de la auditoría técnica y del fiscalista (D-06).

---

## 1. La regla de oro del IVA (respuesta directa a "¿cuándo cobro 16%?")

> ### 🔑 El IVA de 16% lo determina, en la práctica, **DÓNDE ESTÁ EL COMPRADOR**, no el creador.
>
> - **Comprador en México → se cobra IVA 16%** (sin importar si el creador es mexicano o extranjero).
> - **Comprador en el extranjero → NO se cobra 16%** (0% de exportación si el creador es mexicano; fuera de objeto si el creador también es extranjero).

La residencia del creador **no cambia si hay o no 16%**; cambia otras cuatro cosas: (a) 0% vs. "fuera de objeto" cuando el comprador es extranjero, (b) **quién** entera el IVA y **en qué %** (50% al creador MX vs. 100% al extranjero), (c) el **ISR** (113-A vs. Título V), y (d) el **CFDI** (quién lo emite).

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
| II | **Medio de pago** vía intermediario en territorio nacional | Tarjeta/banco emisor mexicano en Mercado Pago |
| III | **Dirección IP** en rango asignado a México | Geo por IP (`registrar-compra-geo`) |
| IV | **Código telefónico de país** = +52 | Teléfono del registro |

**Acción de producto:** persistir y **conservar los 4 datos por transacción** como evidencia fiscal de la clasificación de IVA.

---

## 4. LA MATRIZ OPERATIVA — las 4 combinaciones (creador–comprador)

Convención: **Creador (vendedor) – Comprador**. La plataforma (Vibra) es residente en México en las cuatro filas. "IVA del servicio" = el IVA sobre lo que vende el creador; la **comisión de Vibra se grava aparte** (§5).

### Tabla maestra

| # | Combinación | IVA del servicio | Retención IVA (quién/%) | ISR al creador | Retención ISR | CFDI (quién emite) |
|---|---|---|---|---|---|---|
| **1** | 🇲🇽**MX–MX** | **16%** (comprador en MX) | Creador traslada 16%; **Vibra retiene 50%** (100% sin RFC) y entera | **113-A** (residente MX) | **Vibra 2.5%** sobre ingreso sin IVA (20% sin RFC) | Creador: CFDI de ingreso al comprador. Vibra: CFDI de **retención** (compl. Plataformas Tecnológicas) + CFDI de **comisión** (16%) |
| **2** | 🌍**EX–MX** | **16%** (comprador en MX) | **Vibra retiene 100%** del IVA cobrado y entera | **Título V** — depende de caracterización; **por defecto NO se retiene** (ver §7) salvo regalía | 0% (servicio Art. 156 desde el extranjero) **o** 25%/35%→~10% con tratado (regalía Art. 167) | Creador NO emite. **Vibra** emite comprobante 18-D-V al comprador (IVA por separado, si lo pide) + CFDI de retención de IVA. Comisión: ver §5 |
| **3** | 🇲🇽**MX–EX** | **0%** exportación (comprador fuera) — **frágil, ver ⚠️** | A 0% no hay IVA que retener; creador acredita su IVA de insumos | **113-A** (residente MX — el ISR no depende de dónde está el comprador) | **Vibra 2.5%** sobre ingreso (20% sin RFC) | Creador: CFDI de ingreso a **0%**. Vibra: CFDI de retención (ISR) + CFDI de **comisión (16%**, creador MX) |
| **4** | 🌍**EX–EX** | **Sin IVA mexicano** (fuera de objeto) | Nadie (Vibra solo es conducto de cobro) | **Sin fuente de riqueza en MX** → 0% (matiz regalía en §7) | Ninguna | Ninguno por el servicio. Comisión de Vibra: candidata a **0% export** (ver §5) |

### Detalle por fila

**Fila 1 — MX–MX (caso base, sin zona gris).** 16% de IVA; Vibra retiene **50%** del IVA trasladado al creador PF con RFC (**100%** si no da RFC) y lo entera. ISR **2.5%** sobre el ingreso sin IVA (**20%** sin RFC). Si el creador PF factura ≤ $300,000/año puede optar por **pago definitivo** (113-B) y la retención agota su ISR. **RESICO no aplica** a lo cobrado por la plataforma: manda el 113-A.

**Fila 2 — EX–MX (creador extranjero, fan mexicano).** El fan **sí paga 16%** (LIVA Art. 16 §4 remite al Cap. III BIS: el servicio se presta en territorio nacional porque el receptor está en México). Vibra retiene el **100%** del IVA (18-J-II-a §2, ampliado por la reforma 2026 a plataformas mexicanas) y lo entera el día 17. **El creador extranjero NO necesita inscribirse en el RFC ni facturar** si Vibra retiene el 100% (Art. 18-D último párrafo) — es la ruta limpia del agregador. **El ISR es la zona gris grande** (ver §7): por defecto no se retiene, salvo que el servicio se caracterice como regalía.

**Fila 3 — MX–EX (creador mexicano, comprador extranjero).** Tasa **0%** de exportación (Art. 29 LIVA), con ventaja de que el creador **recupera su IVA acreditable**. **PERO no es automática:** además de documentar el aprovechamiento efectivo en el extranjero (tesis **2031805**), el Art. 58 RLIVA exige **pago proveniente de cuentas en el extranjero** — requisito que el flujo agregador (fan paga a cuenta MX de Vibra) puede **romper**. **Si el 0% no procede, el fallback es 16%** (servicio prestado por residente mexicano, gravado por Art. 14/16). El **ISR sí corre** normal (2.5%/20%): la retención del 113-A no depende de dónde está el comprador, sino de que el ingreso lo obtenga un residente mexicano vía plataforma.

**Fila 4 — EX–EX (ambos extranjeros).** No hay hecho imponible mexicano sobre el servicio del creador (ni prestador ni receptor en MX; LIVA Art. 1/16 *a contrario*) ni fuente de riqueza para ISR. **La única pieza mexicana es la comisión de Vibra** (§5), que aquí es la candidata **más defendible** a 0% de exportación (el fan también está fuera → el argumento de "aprovechamiento en el extranjero" es fuerte). Respaldar la conclusión "negativa" con opinión de fiscalista.

---

## 5. La comisión de Vibra (el "corte" de la plataforma) — se grava aparte

La comisión que Vibra retiene por intermediar es **un servicio propio de Vibra** (mediación/comisión, LIVA Art. 14-IV) y causa su **propio IVA**, separado del servicio del creador. Como Vibra reside en México (Art. 16), el servicio se presta en territorio nacional; la tasa depende de **dónde se aprovecha**.

| Escenario | Tasa comisión | Fundamento | Certeza |
|---|---|---|---|
| Creador **residente en México** (filas 1 y 3) | **16%** | Art. 14-IV + Art. 16 LIVA | Alta / sin discusión |
| Creador **extranjero + fan también en el extranjero** (fila 4) | **0%** (exportación) | Art. 29-IV-**d)** "comisiones y mediaciones" + Art. 58 RLIVA | Alta *si* se documenta bien |
| Creador **extranjero + fan mexicano** (fila 2) — **ZONA GRIS** | **Probablemente 16%**; 0% es posición agresiva | Riesgo por jurisprudencia **2031805** y tesis I.10o.A.36 A / 2a. CXXIX/2015 | **Baja / alto riesgo de reclasificación** |

**Por qué la zona gris (fila 2) es riesgosa:** la **jurisprudencia registro 2031805** (Pleno Regional Centro-Norte, publicada 27-feb-2026, **de aplicación obligatoria**) exige probar el **aprovechamiento EFECTIVO en el extranjero** y prohíbe extender el 0% por analogía a servicios cuyos efectos se materializan en territorio nacional. Cuando el fan que consume/paga está en México, la autoridad tiene un argumento fuerte de que la intermediación "se aprovecha en México" → 16%. Complica más el modelo agregador el requisito del **Art. 58 RLIVA de pago desde cuenta en el extranjero**, que el flujo real (dinero en cuenta MX de Vibra) no satisface de origen.

**Recomendación conservadora:** tratar la comisión como **16% por defecto**, y aplicar 0% solo con expediente robusto (constancia de residencia fiscal del creador extranjero + contrato de intermediación + evidencia de aprovechamiento en el extranjero + solución al requisito de pago desde el extranjero). **Validar con fiscalista** cada uno de estos tres puntos.

---

## 6. Los 11 servicios, clasificados (y el tratamiento de las propinas)

Todos los 11 son **contraprestaciones por un servicio digital intermediado** → entran al régimen 18-J / 113-A. La matriz de §4 aplica a los 11 por igual (manda dónde está el comprador y la residencia del creador). Lo que cambia entre ellos es su **naturaleza jurídica** (contenido vs. servicio personal vs. "propina") — relevante sobre todo para el **ISR del creador extranjero** (§7).

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
3. **Capturar y validar el RFC** de cada creador MX en el onboarding fiscal (sin RFC: ISR 2.5%→20% e IVA 50%→100%). Va junto al KYC/Didit.
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
- Combinación creador–comprador (1–4), servicio (1–11), IVA aplicado (16%/0%/exento), base sin IVA, IVA retenido (50%/100%), ISR retenido, comisión de Vibra y su IVA (16%/0%), y los indicios 18-C como evidencia.

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

**⚠️ Marcadores `🔁 DLOCAL-MIGRATION` (lo que falta / debe rehacerse al migrar a dLocal):**
- **Determinación fiscal autoritativa en backend:** hoy el país viene del cliente (IP). Con dLocal debe determinarlo el servidor (IP del request + país de la tarjeta por BIN) y conservar los **indicios 18-C**.
- **Split de retención + CFDI:** calcular la retención (50%/100% IVA, ISR 2.5%/20%) y emitir el **CFDI de retención**. Requiere capturar RFC/residencia del creador (Fase 3b-2/3b-3/3b-4, con fiscalista y proveedor de timbrado PAC).

**Hecho (Fase 3b-1 — "IVA cobrado" en el Wallet, verificado con type-check):**
- El IVA se propaga del `paymentIntent` al ledger: `reconcile.materializeFromIntent` copia `taxCountry`/`taxAmount` al doc de dominio → los triggers lo pasan a `recordEarning` → se guarda por venta y se acumula en `walletSummary.lifetimeTaxCollected` (suma al ganar, resta al reembolsar). Suscripción: se pasa el IVA de cada cobro mensual.
- El Wallet (finanzas) muestra "**IVA cobrado (va al SAT)**" como línea de transparencia (solo si hubo ventas con impuesto). NO suma a ganancias ni al saldo retirable. i18n en es/en/pt-BR.
- **Las ganancias siguen sobre la base** (el IVA nunca infla el neto del creador).

**Propinas/donaciones (decidido 2026-07-27):** se les **suma IVA igual que todo** (son contraprestación gravada, §6.1). El modo donación del panel de pago muestra el desglose Subtotal / IVA / Total sobre el monto que elige el fan, y el cobro se multiplica por (1+tasa). Con esto, la feature "+impuestos" (visualización + cobro coherente) queda **completa**; lo que resta es la determinación autoritativa en backend (Fase 2/dLocal) y el desglose del Wallet (Fase 3).

---

## Anexo B — Resumen operativo por combinación (facturación y retención)

Convención: **Creador–Comprador**. Modelo operativo de Vibra (agregador + retenedor).

> **Clave que simplifica todo:** para RETENER al creador y darle su comprobante, Vibra
> solo necesita el **RFC del creador** (un dato). El **CFDI de retención** y el de la
> **comisión** los timbra **Vibra con SU propio CSD**. El CSD del *creador* solo hace
> falta si él emite su factura de ingreso al comprador (alta perezosa: solo si un
> comprador pide factura).

| Combo (Creador–Comprador) | IVA (lo determina el comprador) | ¿Vibra retiene? | ISR | Factura |
|---|---|---|---|---|
| **MX–MX** | 16% | **Sí: 50% del IVA + 2.5% ISR** (100%/20% sin RFC); Vibra lo entera | 2.5% al creador (20% sin RFC) | Creador factura al comprador si lo pide. Vibra emite CFDI de **retención** + de **comisión** (necesita RFC del creador). El creador declara el otro 50% del IVA |
| **EXT–MX** | 16% | **Sí: 100% del IVA**; Vibra lo declara (el creador extranjero no puede facturar IVA mexicano) | **Normalmente 0** (Título V; solo hay retención si hay fuente en MX / regalía) | Creador NO factura. **Vibra emite el comprobante al comprador** (IVA por separado, 18-D-V) |
| **MX–EXT** | **0%** (exportación)\* | Solo ISR (a 0% no hay IVA que retener) | 2.5% al creador (el ISR no depende de dónde está el comprador) | Creador factura a 0%. Vibra: CFDI de **retención** (ISR) + **comisión** 16% |
| **EXT–EXT** | Sin IVA mexicano (fuera de objeto) | **No** | No (sin fuente en MX) | Ninguna por la venta. Solo la **comisión de Vibra** (posible 0% de exportación) |

\* El 0% de exportación es **frágil** en el modelo agregador (el pago cae en la cuenta MX de Vibra; Art. 58 RLIVA exige pago desde el extranjero). Validar con fiscalista.

**Cuando el comprador NO pide factura:**
- Al comprador se le da un **comprobante de pago** (no fiscal). Y ya.
- Las **retenciones y el CFDI de retención al creador se hacen IGUAL** — no dependen de que el comprador pida factura.
- La **factura global mensual** (ventas a público en general no facturadas) es la única pieza que necesita definición del fiscalista: **¿la emite Vibra o el creador?** (Si la emite el creador, necesitaría CSD desde el mes 1 y el alta perezosa no aplica.)

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
