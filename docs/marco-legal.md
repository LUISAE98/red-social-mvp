# Marco Legal de Vibra — Mapa de documentos, avisos y consentimientos

> ✅ **Nota 2026-08-26.** Este documento describía a Vibra como **intermediario/marketplace**, y el
> modelo volvió exactamente a eso tras el paréntesis de *vendedor directo* (jul–ago 2026). **Lo que dice
> sobre el rol de Vibra vuelve a ser correcto.** Ver `docs/legal/fiscal-iva-isr-plataforma.md` §0.
>
> ✅ **Didit es el proveedor de KYC vigente** (act. 2026-08-31). Se eliminó el 2026-08-13 y se
> **reintegró el 2026-08-27**, al elegir Global Payouts en vez de Connect: Connect traía el KYC
> incluido, Global Payouts no. Donde este documento lo nombra como proveedor de KYC, es correcto.
> Esta nota decía que se había eliminado y que había que leer *la procesadora de pagos*.

> **Estado:** investigación informativa (2026-07-24). **NO es asesoría legal.**
> Los puntos marcados con fuente primaria fueron verificados contra textos de ley oficiales
> (Cámara de Diputados, Banxico, CNBV, DOF). El resto proviene de conocimiento del marco
> regulatorio y debe confirmarse. **Antes de publicar cualquier documento, un abogado mexicano
> especializado en (a) protección de datos, (b) fintech/medios de pago y (c) derecho del
> consumidor debe validarlo y redactar la versión final.** Ver §E.

Alcance operativo asumido: **base fiscal en México** (persona física migrando a persona moral
S.A. de C.V.), con **usuarios y creadores globales, incluidos UE y EEUU**. Decisión de
**contenido adulto: pendiente** — se cubren ambos escenarios (§C-6).

---

## ⚠️ Dos correcciones críticas que cambian todo (verificadas)

1. **La Ley de Protección de Datos cambió por completo en 2025.** Se publicó una **nueva LFPDPPP
   en el DOF el 2025-03-20, vigente desde el 2025-03-21**, que **abrogó la ley de 2010**.
   Consecuencias: el contenido mínimo del aviso de privacidad ahora está en el **Art. 15** (antes
   Art. 16); las **transferencias salieron** de la lista mínima y se rigen por una cláusula del
   **Art. 35**; hay que **distinguir finalidades necesarias (sin consentimiento) vs. voluntarias
   (con consentimiento)**. Además, la reforma constitucional de 2025 **desapareció al INAI** y
   trasladó la autoridad de datos a la Administración Pública Federal. **Toda plantilla de aviso
   anterior a 2025 quedó obsoleta.** *(Fuente primaria: DOF 2025-03-20; texto en diputados.gob.mx.
   Confirmar el nombre exacto de la autoridad sucesora con abogado.)*

2. **La wallet probablemente NO obliga a Vibra a ser IFPE — pero por una razón muy concreta: la
   custodia.** La Ley Fintech (LRITF, Arts. 22–24) define "fondos de pago electrónico" como fondos
   contabilizados en un registro a nombre de clientes que la institución **emite, administra,
   redime y transmite** de forma habitual y profesional. El **Art. 24 excluye** los esquemas
   *closed-loop* (saldo de propósito limitado, usable solo con el emisor, no convertible a dinero).
   La línea real **no es un monto mínimo** (ese "umbral" fue refutado 0-3), sino **quién custodia
   el dinero**: si el dinero real vive en Mercado Pago (entidad regulada) y la wallet de Vibra es
   un **mero ledger contable interno**, Vibra queda fuera del perímetro IFPE. **El riesgo aparece
   cuando Vibra custodia saldos que el usuario puede transmitir a terceros o convertir a efectivo**
   — y como Vibra **permite retiros**, ese punto es exactamente la frontera a cuidar (§C-5).
   *(Fuente primaria verificada: LRITF Arts. 22/24, diputados.gob.mx; última reforma DOF 2025-11-14.)*

---

## A. Inventario de documentos legales

Prioridad: **[B]** = bloqueante para lanzar · **[R]** = recomendado / fase 2.

| # | Documento | Prio | Ley / jurisdicción que lo exige | Contenido mínimo | Dónde se muestra en la app |
|---|-----------|------|--------------------------------|------------------|----------------------------|
| 1 | **Términos y Condiciones de Servicio** (usuario final) | [B] | LFPC/PROFECO (contrato de adhesión, MX); base contractual general; DSA art. 14 (UE) exige T&C claros sobre moderación | Objeto; elegibilidad y edad; cuenta y seguridad; licencia de uso; conducta prohibida; rol de Vibra como **intermediario/marketplace** (no parte del contrato fan↔creador); comisiones; suspensión/terminación; **limitación de responsabilidad y garantías "AS-IS"**; **ley aplicable y jurisdicción** (elegir MX; cláusula de arbitraje opcional); modificaciones; enlaces a las demás políticas | **Footer** (siempre) + **checkbox clickwrap no premarcado** en registro |
| 2 | **Acuerdo de Creador / Monetización** (separado del T&C) | [B] | Contractual; base para retención fiscal (CFF/LISR); PROFECO; condiciones de payout | Elegibilidad para monetizar; **KYC obligatorio (Didit) como gate de retiro**; comisiones de la plataforma por tipo de servicio; calendario y mínimos de retiro; obligaciones fiscales del creador (§C-5, §B); responsabilidad del creador por su contenido y por cumplir lo que vende; causales de desmonetización; manejo de reembolsos y contracargos | Al **activar monetización** de un perfil (clickwrap dedicado) |
| 3 | **Aviso de Privacidad Integral** | [B] | **Nueva LFPDPPP 2025, Art. 15**; GDPR arts. 13–14 (UE); CCPA/CPRA (California) | Identidad y **domicilio del responsable**; datos tratados **identificando los sensibles**; **finalidades distinguiendo necesarias vs. voluntarias**; medios para ejercer **derechos ARCO** y revocar consentimiento; uso de cookies/rastreo; cambios al aviso; **cláusula de transferencias (Art. 35)**. Secciones adicionales por región: **bases de licitud, DPO/representante UE, transferencias internacionales, derechos GDPR** (UE); **"Do Not Sell/Share", categorías, derechos CPRA** (California) | **Footer** + enlace **en el punto de captación** (registro, formularios) — debe estar disponible desde el momento en que se recaban datos |
| 4 | **Aviso de Privacidad Simplificado / Corto** | [B] | LFPDPPP 2025 (aviso corto en captación directa) | Identidad del responsable; finalidades principales; remisión al aviso integral | Junto al formulario de registro y en cada punto de captación directa |
| 5 | **Política de Cookies** + **banner de consentimiento (CMP)** | [B] (UE) | ePrivacy + GDPR (UE); recomendable MX/US | Categorías (necesarias, analíticas, marketing); finalidad y duración; cómo revocar. Banner con **opt-in previo** para no esenciales (UE): botones "Aceptar / Rechazar / Configurar" en igualdad | **Banner en primera visita** (bloqueante de cookies no esenciales hasta consentir) + página enlazada en footer |
| 6 | **Normas de Comunidad / Política de Contenido Aceptable** | [B] | DSA (UE, transparencia de moderación); protege el safe harbor DMCA/DSA | Contenido prohibido (ilegal, odio, NCII, menores, spam, deepfakes no consentidos); reglas de comunidades ocultas; proceso de reporte y apelación; consecuencias | Footer + enlace **al publicar** y en el flujo de reporte |
| 7 | **Política de Reembolsos y Cancelaciones** | [B] | LFPC/PROFECO (MX); Directiva 2011/83 + 2019/770 (UE, contenido digital); FTC (US) | Cuándo hay/no hay reembolso por tipo de producto; entrega de contenido digital y **renuncia al derecho de desistimiento UE** (ver §C); no-show en sesiones; contracargos | **Checkout de cada compra** (visible antes de pagar) + footer |
| 8 | **Términos de la Wallet / Monedero** | [B] | LRITF (delimitar que **no es IFPE**); LFPC | Naturaleza del saldo (**crédito interno / no dinero electrónico, no convertible salvo retiro vía el procesador**); que el dinero real lo custodia el **procesador de pago (Mercado Pago)**; sin intereses; expiración; correcciones del ledger; que **no es una cuenta bancaria ni depósito garantizado** | Al **activar la wallet / primer saldo** |
| 9 | **Política de Pagos, Comisiones y Retiros** | [B] | LRITF; LFPIORPI (AML); CFF/LISR (retención) | Métodos de pago; comisiones por servicio; **flujo de retiro con KYC + revisión humana**; tiempos; monedas y tipo de cambio; límites; motivos de bloqueo/retención (AML/sanciones) | Sección de wallet + **flujo de retiro del creador** |
| 10 | **Consentimiento de Grabación de Sesiones 1-a-1** | [B] | Leyes de grabación bi-parte (varios estados US); GDPR (biometría, art. 9); LFPDPPP (datos sensibles); BIPA-tipo (Illinois) | Aviso claro de que la sesión **se graba**; **consentimiento expreso de AMBAS partes** antes de iniciar; quién puede descargar/reusar; plazo de conservación en R2; base legal | **Pantalla/modal ANTES de entrar** a la videollamada (bloqueante, ambos aceptan) |
| 11 | **Aviso y Consentimiento de Datos Biométricos** | [B] | GDPR art. 9; LFPDPPP (sensibles); BIPA (Illinois) y leyes estatales US | Tratamiento de rostro/identidad en **KYC (Didit)** y en **grabaciones**; finalidad; conservación; que se comparte con el proveedor (Didit); derecho a revocar | En el **flujo de KYC** y referenciado en §10 |
| 12 | **Política de Propiedad Intelectual / DMCA** + **Agente Designado** | [B] | DMCA §512 (US safe harbor); Directiva Copyright UE art. 17; LFDA (MX) | Licencia que el usuario otorga a Vibra (limitada, para operar el servicio); proceso **notice-and-takedown**; contranotificación; política de **reincidentes**; **datos del Agente Designado** (registrar ante el US Copyright Office) | Footer + formulario de reporte de infracción |
| 13 | **Política de Verificación de Edad / Protección de Menores** | [B] | COPPA (US <13); Age-Appropriate Design Code (UK); LFPDPPP (menores) | **Edad mínima** (recomendado 18+ dada la monetización y videollamadas; mínimo 13+ nunca sin control parental); método de verificación; qué pasa con cuentas de menores | Registro (gate de edad) + T&C |
| 14 | **Política de Retención y Eliminación de Datos** | [R] | LFPDPPP; GDPR (limitación de plazo) | Plazos por tipo de dato (cuenta, ledger, KYC, **grabaciones en R2**, logs); borrado tras baja; excepciones legales (AML: conservar expediente) | Interna + resumida en el aviso de privacidad |
| 15 | **Procedimiento de Notificación de Brechas** | [R] | LFPDPPP; GDPR (72 h a la autoridad) | Detección, evaluación, notificación a autoridad y titulares, registro | Interno (documento operativo) |
| 16 | **Puntos de contacto y Reporte de Transparencia (DSA)** | [R] (UE) | DSA (UE) | Punto de contacto único; mecanismo de notificación de contenido ilícito; reporte anual de moderación | Footer (UE) |
| 17 | **Política de contenido adulto + registros 18 U.S.C. 2257 + consentimiento de performers** | **Solo si se permite adulto** | 18 U.S.C. 2257 (US); reglas Visa/Mastercard; leyes estatales de verificación de edad de espectadores | Prohibición de menores; **verificación y expediente 2257 de cada performer**; consentimiento documentado; verificación de edad del espectador; reglas del procesador | Onboarding de creador adulto + gate de acceso al contenido |

---

## B. Checklist de consentimientos "in-product" (dónde va cada uno)

| Pantalla / flujo | Qué debe aparecer | Tipo |
|---|---|---|
| **Registro** | Checkbox **no premarcado**: "Acepto los [T&C] y he leído el [Aviso de Privacidad]" · **gate de edad** (fecha de nacimiento / 18+) | Clickwrap bloqueante |
| **Primera visita** | Banner de **cookies** con Aceptar/Rechazar/Configurar (opt-in previo para no esenciales) | Banner bloqueante (UE) |
| **Aviso corto de privacidad** | Enlace visible junto a cualquier formulario que capte datos | Informativo |
| **Activar monetización (creador)** | Aceptación del **Acuerdo de Creador** + aviso fiscal (§C-5) | Clickwrap |
| **KYC (Didit)** | **Consentimiento biométrico** + aviso de que se comparte con el proveedor | Consentimiento expreso |
| **Activar wallet / primer saldo** | Aceptación de **Términos de la Wallet** (saldo ≠ dinero electrónico / cuenta bancaria) | Clickwrap |
| **Checkout de cualquier servicio** | Precio total, **política de reembolso**, y (UE) **renuncia expresa al desistimiento** para contenido digital de entrega inmediata | Confirmación de compra |
| **Antes de una videollamada 1-a-1** | **Consentimiento de grabación de ambas partes** (modal bloqueante) | Consentimiento expreso, bilateral |
| **Subir contenido** | Confirmación de que se tienen los derechos y de que se otorga la licencia a Vibra; recordatorio de Normas de Comunidad | Clickwrap / recordatorio |
| **Flujo de retiro** | Aviso de KYC, tiempos, revisión humana y posibles retenciones (AML) | Informativo |
| **Reportar contenido** | Acceso al mecanismo de notificación (DMCA / DSA) | Formulario |

---

## C. Cláusulas críticas por funcionalidad monetizable

### C-1. Saludo personalizado (tipo Cameo)
- **Naturaleza:** servicio digital a pedido; Vibra es **intermediario**, el creador es el prestador.
- **Plazo de entrega** definido (p. ej. 7 días) y qué pasa si no cumple → **reembolso automático**.
- **Licencia de uso** clara para el comprador (uso personal, no comercial salvo acuerdo) y para el creador/Vibra.
- **Reembolsos:** política explícita por incumplimiento vs. arrepentimiento.
- **UE:** al ser contenido digital hecho a medida, la Directiva 2011/83 **excluye el desistimiento** una vez iniciada la ejecución con consentimiento previo → captar esa renuncia en el checkout.

### C-2. Sesión exclusiva / videollamada 1-a-1 (LiveKit, con grabación)
- **El punto más sensible de toda la plataforma.** Grabas video de dos personas y lo guardas/descargas.
- **Consentimiento de grabación bilateral y expreso** antes de iniciar (leyes de dos partes en varios estados de EEUU; datos biométricos bajo GDPR art. 9 / LFPDPPP sensibles / BIPA).
- **No-show, duración y conducta:** reglas claras; política de reembolso por no-show del creador.
- **Quién puede descargar y reusar** la grabación (creador, comprador) y **restricciones de redistribución**; prohibición de difundir sin consentimiento (NCII).
- **Conservación** del `.mp4` en R2: plazo y borrado.

### C-3. Membresías recurrentes (comunidades)
- **Renovación automática:** en EEUU la **regla FTC de "negative option" / "Click-to-Cancel"** y leyes estatales (California ARL) exigen: divulgación clara antes de cobrar, consentimiento expreso, **cancelación tan fácil como la suscripción**, y recordatorios. UE: información precontractual y cancelación sencilla.
- Precio, periodicidad, fecha de renovación y **cómo cancelar** visibles antes de suscribir.

### C-4. Propinas / donaciones (DonationFeedBanner)
- **No son donativos deducibles ni caridad:** llamarlas "donación" no cambia su naturaleza — son **ingreso gravable** del creador y una **compra/transferencia** para el fan.
- Evitar lenguaje que sugiera deducibilidad fiscal.
- Dejar claro que **no son reembolsables** (salvo error) y que aplican comisiones.

### C-5. Wallet / retiros (el nudo fintech + fiscal + AML)
- **Framing legal:** el saldo es **crédito interno contabilizado en un ledger**, el dinero real lo custodia **Mercado Pago**; **no es dinero electrónico (IFPE), ni cuenta bancaria, ni depósito garantizado**. *(Esta caracterización es lo que mantiene a Vibra fuera del perímetro IFPE — cuidarla en el diseño real, no solo en el texto: ver corrección #2.)*
- **Frontera IFPE a vigilar:** no permitir que un usuario **transfiera saldo a otro usuario** ni lo **convierta libremente a efectivo** fuera del flujo de retiro controlado; si eso ocurriera de forma habitual, Vibra podría caer en actividad de IFPE (autorización CNBV — proceso largo y costoso).
- **AML/PLD (LFPIORPI):** operar monederos y transmitir fondos puede constituir **Actividad Vulnerable** → obligaciones de **identificar al cliente, integrar expediente, y presentar avisos al SAT/UIF** al superar umbrales. El **KYC de Didit** alimenta esto. **Confirmar con abogado si Vibra debe darse de alta como Actividad Vulnerable.** Añadir **screening de sanciones (OFAC/listas)** para pagos internacionales.
- **Fiscal (régimen de plataformas tecnológicas, CFF/LISR):** una plataforma que intermedia pagos a creadores por servicios digitales suele estar obligada a **retener ISR e IVA** y **emitir constancias/CFDI**. **Comunicar a los creadores** en el Acuerdo de Creador que habrá retención y reporte al SAT.
- **Retiros:** KYC previo obligatorio, revisión humana, tiempos, límites, monedas/tipo de cambio, y causales de retención.

---

## D. Prioridades: bloqueante para lanzar vs. fase 2

**Bloqueante (no lanzar sin esto):**
1. T&C de Servicio + Acuerdo de Creador (docs 1, 2).
2. Aviso de Privacidad integral + corto conforme a la **LFPDPPP 2025** (docs 3, 4).
3. Banner + Política de Cookies (doc 5) — crítico para tráfico UE.
4. Normas de Comunidad + Política de Reembolsos (docs 6, 7).
5. Términos de Wallet + Política de Pagos/Retiros con el **framing IFPE correcto** (docs 8, 9).
6. **Consentimiento de grabación bilateral** + consentimiento biométrico (docs 10, 11).
7. Política DMCA + **registro del Agente Designado** ante el US Copyright Office (doc 12).
8. Gate de edad / verificación (doc 13).
9. Decisión **contenido adulto**; si es "sí", nada de adulto en vivo hasta tener 2257 + verificación de edad de espectadores + visto bueno del procesador (doc 17).

**Fase 2 / al escalar:**
- Retención y eliminación de datos; procedimiento de brechas (docs 14, 15).
- Puntos de contacto y reporte de transparencia DSA (doc 16) — obligatorio al crecer en la UE.
- Representante UE / DPO si el volumen lo exige.
- Política de accesibilidad.
- Alta formal como Actividad Vulnerable (AML) según dictamen del abogado.

---

## E. Advertencia (léase primero)

Este documento es **investigación informativa, no asesoría legal**, y no crea relación
abogado-cliente. El marco mexicano cambió sustancialmente en 2025 (nueva LFPDPPP; reformas a la
Ley Fintech) y la interpretación de la frontera IFPE, del alta como Actividad Vulnerable, y de las
obligaciones fiscales **depende de detalles concretos del diseño y los flujos de dinero reales de
Vibra**. Antes de publicar cualquier texto, **debe validarlo y redactarlo un abogado mexicano
especializado en protección de datos, fintech/medios de pago y derecho del consumidor**, con
apoyo de contraparte en la UE (GDPR/DSA) y EEUU (DMCA, 2257 si aplica, leyes estatales de
privacidad y grabación) dado el alcance global.

### Fuentes primarias verificadas (núcleo mexicano)
- **Ley Fintech (LRITF)** — texto oficial, Cámara de Diputados (última reforma DOF 2025-11-14): Arts. 22–24 (definición y exclusiones de "fondos de pago electrónico"), Art. 58 (facultad Banxico+CNBV).
- **Reglas conjuntas IFPE** (Banxico + CNBV) — DOF 2021-01-28.
- **Nueva LFPDPPP** — DOF 2025-03-20, vigente 2025-03-21 (abroga la ley de 2010): Art. 15 (contenido del aviso), Art. 35 (cláusula de transferencias).

> Temas cubiertos por conocimiento del marco (no verificados con fuente primaria en esta corrida, confirmar con abogado): consumidor UE/PROFECO, DMCA/DSA/Copyright UE, régimen fiscal de plataformas, LFPIORPI/AML, 2257 y verificación de edad, reglas de renovación FTC.
