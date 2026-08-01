# Aviso de Privacidad Integral de Vibra

> **BORRADOR v0.1 — 2026-07-26. Documento de trabajo; NO sustituye la revisión de un abogado.**
> Redactado conforme a la **nueva Ley Federal de Protección de Datos Personales en Posesión de los
> Particulares (LFPDPPP) publicada en el DOF el 20‑mar‑2025, vigente desde el 21‑mar‑2025**, que abrogó
> la ley de 2010. Incluye secciones específicas para **UE (GDPR)** y **California (CCPA/CPRA)** por el
> alcance global. **Debe validarlo un abogado mexicano de protección de datos**, con apoyo UE/EEUU.
> Ver [README.md](./README.md) y [../marco-legal.md](../marco-legal.md).
>
> **Placeholders a completar:** `[[RAZÓN SOCIAL]]`, `[[RFC]]`, `[[DOMICILIO LEGAL]]`,
> `[[CORREO DE PRIVACIDAD]]`, `[[ÁREA/RESPONSABLE DE DATOS]]`, `[[REPRESENTANTE UE]]`, `[[DPO SI APLICA]]`,
> `[[FECHA DE PUBLICACIÓN]]`.
>
> **⚠️ Verificaciones legales clave (confirmar con abogado):**
> 1. **Autoridad de datos.** La reforma constitucional de 2025 **desapareció al INAI**; sus atribuciones
>    pasaron a una autoridad del Ejecutivo federal (Secretaría Anticorrupción y Buen Gobierno /
>    "Transparencia para el Pueblo"). Verificar el **nombre exacto y la vía vigente** para quejas del
>    titular. En este borrador se le nombra "**la Autoridad**".
> 2. **Remisiones vs. transferencias.** Bajo la LFPDPPP, compartir datos con **encargados** (proveedores
>    que tratan datos por cuenta de Vibra: Firebase, Vercel, Mux, Cloudflare, LiveKit, Didit, Mercado
>    Pago en lo aplicable) son **remisiones**, que **no requieren la cláusula de consentimiento de
>    transferencia**; solo las **transferencias a terceros responsables** (autoridades, reorganización
>    corporativa, etc.) requieren la cláusula del **Art. 35**. Confirmar la calificación de cada
>    proveedor con el abogado.

**Última actualización:** `[[FECHA DE PUBLICACIÓN]]`

---

## 1. Identidad y domicilio del Responsable

`[[RAZÓN SOCIAL]]` ("**Vibra**"), con RFC `[[RFC]]` y domicilio en `[[DOMICILIO LEGAL]]`, es la persona
responsable del tratamiento de tus datos personales recabados a través de la plataforma **Vibra**
(`https://vibraon.com`, sus subdominios y aplicaciones asociadas, la "**Plataforma**").

Contacto en materia de privacidad: **`[[ÁREA/RESPONSABLE DE DATOS]]`**, correo `[[CORREO DE PRIVACIDAD]]`.

Este Aviso se pone a tu disposición **desde el momento en que se recaban tus datos** y forma parte de
los [Términos y Condiciones](./01-terminos-y-condiciones.md) (#1).

## 2. Datos personales que tratamos

Según tu uso de la Plataforma, podemos tratar las siguientes categorías:

- **Datos de identificación y contacto:** nombre, nombre de usuario, correo electrónico, teléfono (si lo proporcionas), fotografía de perfil, biografía.
- **Datos de la cuenta y autenticación:** credenciales, identificadores de cuenta, sesiones y dispositivos con sesión abierta.
- **Datos de edad:** fecha de nacimiento o confirmación de mayoría de edad (18+).
- **Contenido y actividad:** publicaciones, fotos, videos/VOD, historias, transmisiones en vivo, comentarios, reacciones, menciones, mensajes, seguidores, membresías y comunidades.
- **Datos de verificación de identidad (KYC):** documento de identidad e **imagen facial / datos biométricos** procesados con nuestro proveedor de verificación (actualmente **Didit**; se prevé su reemplazo por **Stripe** antes de producción). **(Datos sensibles — ver §4.)**
- **Grabaciones de videollamadas 1‑a‑1:** audio y video de los productos de videollamada 1‑a‑1 (*Sesión exclusiva* y *Tiempo contigo*), **no ofrecidos actualmente**; **cuando se habiliten**, se grabarán e incluirán **datos biométricos**. **(Datos sensibles — ver §4.)**
- **Datos de pago y facturación:** método de pago tokenizado por el Proveedor de Pagos (no almacenamos el número completo de tarjeta), historial de transacciones, saldo del monedero interno (Wallet), y datos fiscales (para Creadores‑proveedores: RFC/identificación fiscal, residencia fiscal, datos para CFDI/constancias; para Compradores que solicitan factura: sus datos fiscales).
- **Datos para determinación del impuesto de la venta:** como **Vibra vende directamente** y debe determinar el impuesto según el **país del Comprador**, tratamos indicios de residencia/consumo (país inferido por IP, país del medio de pago/banco emisor, domicilio de facturación y código telefónico), que **conservamos por transacción como evidencia fiscal**.
- **Datos de ubicación aproximada:** ubicación aproximada derivada de la dirección IP (a nivel de celda de ~10 km) asociada a ciertas compras, para prevención de fraude, determinación fiscal y estadística; **no recabamos tu ubicación fina.**
- **Datos técnicos y de uso:** dirección IP, identificadores de dispositivo, tipo de navegador, páginas y funciones utilizadas, cookies y tecnologías similares (ver [Política de Cookies](./05-politica-cookies.md) (#5)).
- **Comunicaciones y soporte:** mensajes con nuestro equipo, reportes de moderación, solicitudes de derechos.

No recabamos conscientemente datos de **menores de edad**; la Plataforma es solo para mayores de 18 años.

## 3. Origen de los datos

Recabamos datos: **(a)** directamente de ti (registro, perfil, contenido, KYC, compras); **(b)**
automáticamente por tu uso de la Plataforma (datos técnicos, cookies); y **(c)** de terceros que actúan
como proveedores (p. ej. resultado de la verificación de identidad, confirmación de pagos).

## 4. Datos personales sensibles

El **KYC** (imagen facial / biometría e identificación oficial) y las **grabaciones de sesiones 1‑a‑1**
(que contienen datos biométricos) constituyen **datos personales sensibles**.

Su tratamiento requiere tu **consentimiento expreso**, que se recaba de forma específica en el momento
correspondiente (en el flujo de verificación y antes de iniciar la videollamada), conforme al
[Consentimiento de Datos Biométricos](./11-consentimiento-biometrico.md) (#11) y al
[Consentimiento de Grabación](./10-consentimiento-grabacion.md) (#10). Aplicamos medidas de seguridad
reforzadas para estos datos y limitamos su acceso al personal estrictamente necesario.

## 5. Finalidades del tratamiento

Distinguimos las finalidades **necesarias** (indispensables para prestarte el servicio, no requieren tu
consentimiento) de las **voluntarias** (requieren tu consentimiento y puedes negarlas sin que ello afecte
el servicio principal).

### 5.1. Finalidades necesarias (para dar la relación de servicio)

- Crear y administrar tu cuenta, autenticarte y gestionar tus sesiones y dispositivos.
- Prestar las funciones de la Plataforma (perfiles, comunidades, contenido, VOD, transmisiones, videollamadas, mensajería).
- Procesar tus compras **como vendedora**, operar la Wallet (ledger interno), calcular el reparto con el Creador‑proveedor y gestionar retiros.
- **Determinar el impuesto de la venta según tu país** (como Comprador), cobrarlo y **emitir el comprobante o factura**, conservando los indicios de residencia/consumo como evidencia fiscal.
- **Verificar tu identidad (KYC)** cuando corresponda, como condición para monetizar y retirar.
- **Grabar las videollamadas 1‑a‑1** contratadas y ponerlas a disposición de las partes autorizadas.
- Cumplir obligaciones **fiscales** de Vibra como vendedora y, respecto del Creador‑proveedor, retener y documentar su pago según su residencia/régimen (cálculo independiente).
- **Prevención de fraude, seguridad, moderación** de contenido y **cumplimiento legal** (incluida la prevención de lavado de dinero y la atención de requerimientos de autoridad).
- Atender tus solicitudes de soporte, quejas y ejercicio de derechos.
- Enviarte **comunicaciones de servicio** (transaccionales, de seguridad, legales y operativas).

### 5.2. Finalidades voluntarias (requieren tu consentimiento)

- Enviarte **comunicaciones de marketing**, novedades y promociones.
- **Personalización y recomendaciones** de contenido y creadores más allá de lo necesario para operar el servicio.
- **Analítica** con fines de mejora del producto más allá de la estrictamente necesaria.

Puedes **negar u oponerte** a las finalidades voluntarias, ahora o después, enviando tu solicitud a
`[[CORREO DE PRIVACIDAD]]` o mediante los controles disponibles en la Plataforma, sin que ello afecte la
prestación del servicio principal.

## 6. Medios para limitar el uso o divulgación / negar finalidades voluntarias

Puedes limitar el uso o divulgación de tus datos y negar las finalidades voluntarias escribiendo a
`[[CORREO DE PRIVACIDAD]]` o desde la configuración de la Plataforma cuando esté disponible. También
puedes inscribirte, en su caso, en los registros públicos para limitar publicidad que la ley prevea.

## 7. Transferencias y remisiones de datos

### 7.1. Remisiones a encargados (proveedores que tratan datos por cuenta de Vibra)

Para operar la Plataforma compartimos datos con proveedores que los tratan **siguiendo nuestras
instrucciones** (encargados), bajo obligaciones de confidencialidad y seguridad, incluyendo:

- **Firebase / Google Cloud** (autenticación, base de datos, almacenamiento, funciones).
- **Vercel** (hospedaje del sitio).
- **Mux** (procesamiento y entrega de video/VOD).
- **Cloudflare** (transmisiones en vivo y almacenamiento de grabaciones).
- **LiveKit** (videollamadas 1‑a‑1 y su grabación).
- **Didit** (verificación de identidad / KYC). *Se prevé su reemplazo por la verificación de identidad de **Stripe** antes del lanzamiento a producción; el aviso se actualizará entonces.*
- **Stripe** (Stripe Connect — procesamiento de pagos y liquidación de retiros; **en el futuro también verificación de identidad**, ver §4), en lo que actúe como encargado.

Estas **remisiones**, conforme a la LFPDPPP, **no requieren tu consentimiento** adicional.

### 7.2. Transferencias a terceros responsables

Podemos **transferir** datos, sin requerir tu consentimiento cuando la ley lo permita, en supuestos como:

- a **autoridades** competentes, cuando exista requerimiento legal o para el cumplimiento de la ley (fiscal, prevención de lavado de dinero, moderación de contenido ilícito, orden judicial);
- a **asesores** y auditores bajo deber de confidencialidad;
- en el marco de una **reorganización corporativa** (fusión, adquisición o transmisión de negocio).

Para cualquier otra transferencia que requiera tu consentimiento, se recabará conforme a la **cláusula
del artículo 35** (ver §8).

### 7.3. Carácter internacional

Algunos proveedores y destinatarios se ubican **fuera de México** (p. ej. EEUU y la UE). Adoptamos las
salvaguardas que exija la ley aplicable para dichas remisiones/transferencias internacionales.

## 8. Cláusula de transferencias (artículo 35 LFPDPPP)

`[[ ]]` **Acepto** / `[[ ]]` **No acepto** que mis datos personales se transfieran en los términos
descritos en este Aviso que requieran mi consentimiento.

> Nota de implementación: cuando exista una transferencia que requiera consentimiento, esta cláusula
> debe presentarse como una casilla que el titular pueda marcar/desmarcar. Las transferencias del §7.2
> que la ley exceptúa **no** dependen de esta casilla.

## 9. Derechos ARCO y revocación del consentimiento

Tienes derecho a **Acceder** a tus datos, **Rectificarlos** cuando sean inexactos, **Cancelarlos** cuando
consideres que no se requieren, y **Oponerte** a su tratamiento (derechos "**ARCO**"), así como a
**revocar** el consentimiento que hayas otorgado.

**Cómo ejercerlos:** envía tu solicitud a `[[CORREO DE PRIVACIDAD]]` indicando: (i) tu nombre y medio
para recibir respuesta; (ii) los documentos que acrediten tu identidad (o representación); (iii) la
descripción clara de los datos y del derecho que deseas ejercer. Responderemos en los **plazos legales**
aplicables. El ejercicio es **gratuito** (solo podrán cobrarse, en su caso, los gastos de reproducción o
envío que la ley permita).

La revocación del consentimiento o la oposición/cancelación pueden implicar que **no podamos seguir
prestando ciertos servicios** que dependan de dichos datos (por ejemplo, sin KYC no es posible retirar
fondos).

Si consideras que tu derecho a la protección de datos fue vulnerado, puedes acudir a **la Autoridad**
competente en materia de protección de datos personales `[[nombre y vía a confirmar tras la reforma que
desapareció al INAI]]`.

## 10. Conservación de los datos

Conservamos tus datos **mientras mantengas tu cuenta** y, tras su baja, durante los plazos necesarios
para cumplir obligaciones legales (fiscales, de prevención de lavado de dinero, de moderación y de
atención de disputas) y para el ejercicio o defensa de derechos, tras lo cual se **bloquean y
suprimen**. Los plazos por tipo de dato se detallan en la [Política de Retención](./14-retencion-datos.md)
(#14). Las **grabaciones** se conservan por el plazo indicado en el [documento #10](./10-consentimiento-grabacion.md).

## 11. Seguridad

Aplicamos medidas de seguridad administrativas, técnicas y físicas razonables para proteger tus datos
contra pérdida, uso indebido o acceso no autorizado, con controles reforzados para los datos sensibles.
Ningún sistema es infalible; en caso de una **vulneración de seguridad** que afecte de forma significativa
tus derechos, te informaremos conforme a la ley.

## 12. Cookies y tecnologías de rastreo

Usamos cookies y tecnologías similares conforme a la [Política de Cookies](./05-politica-cookies.md) (#5).
Donde la ley lo exija, recabamos tu **consentimiento previo** para las cookies no esenciales mediante un
mecanismo de gestión de preferencias.

## 13. Decisiones automatizadas

`[[Describir si existen decisiones automatizadas con efectos jurídicos o significativos — p. ej.
detección automatizada de fraude o moderación — y, en su caso, el derecho del titular a intervención
humana. Confirmar con producto y abogado.]]`

## 14. Cambios al Aviso de Privacidad

Podemos actualizar este Aviso. Publicaremos la versión vigente en la Plataforma indicando la fecha de
última actualización y, cuando los cambios sean sustanciales, te lo notificaremos por un medio razonable.

---

# Anexo A — Información adicional para Usuarios en la Unión Europea / EEE (GDPR)

Si te encuentras en la UE/EEE, además de lo anterior aplica lo siguiente conforme al Reglamento (UE)
2016/679 (**GDPR**).

**Responsable del tratamiento:** `[[RAZÓN SOCIAL]]`, `[[DOMICILIO LEGAL]]`.
**Representante en la UE (si aplica):** `[[REPRESENTANTE UE]]`. **DPO (si aplica):** `[[DPO]]`.

**Bases jurídicas del tratamiento:**
- **Ejecución de un contrato** (art. 6.1.b): crear y operar tu cuenta, prestar los servicios y procesar compras.
- **Obligación legal** (art. 6.1.c): obligaciones fiscales, prevención de lavado de dinero, atención de requerimientos, moderación de contenido ilícito.
- **Interés legítimo** (art. 6.1.f): seguridad, prevención de fraude, mejora del servicio y analítica básica, ponderando tus derechos.
- **Consentimiento** (art. 6.1.a): marketing, personalización avanzada, cookies no esenciales. Para **datos biométricos/sensibles** (KYC, grabaciones), consentimiento **explícito** (art. 9.2.a).

**Tus derechos:** acceso, rectificación, **supresión ("derecho al olvido")**, limitación del tratamiento,
**portabilidad**, oposición, y a retirar tu consentimiento en cualquier momento (sin efectos retroactivos).
Puedes ejercerlos en `[[CORREO DE PRIVACIDAD]]` y presentar una reclamación ante tu **autoridad de control**
nacional.

**Transferencias internacionales:** cuando transfiramos datos fuera del EEE, usaremos mecanismos válidos
(p. ej. **cláusulas contractuales tipo** de la Comisión Europea u otras garantías adecuadas).

**Conservación:** aplicamos los plazos del §10; los datos se conservan solo el tiempo necesario para las
finalidades y las obligaciones legales.

**Decisiones automatizadas:** ver §13; tienes derecho a no ser objeto de decisiones basadas únicamente en
tratamiento automatizado con efectos jurídicos o significativos, salvo las excepciones legales.

---

# Anexo B — Aviso de privacidad para residentes de California (CCPA/CPRA)

Si eres residente de California, aplican estos derechos conforme a la **California Consumer Privacy Act**
reformada por la **CPRA**.

**Categorías de información personal que recabamos:** identificadores (nombre, usuario, correo, IP);
información de cuenta; datos comerciales (historial de compras); actividad en internet (uso, cookies);
**geolocalización aproximada**; datos de audio/video (grabaciones de sesiones); **información sensible**
(datos biométricos e identificación del KYC); e información profesional/fiscal de Creadores. **Fuentes,
finalidades y divulgaciones:** las descritas en las §2–§7.

**Venta / "compartición" (sharing):** **Vibra no vende** tu información personal por dinero. En la medida
en que el uso de cookies de publicidad pudiera considerarse "compartir" para publicidad de contexto
cruzado, ofreceremos un mecanismo de **"Do Not Sell or Share My Personal Information"** y respetaremos las
señales de exclusión (p. ej. *Global Privacy Control*). `[[Confirmar según el uso real de cookies
publicitarias.]]`

**Tus derechos:** conocer/acceder, **eliminar**, **corregir**, **excluirte de la venta/compartición**,
**limitar el uso de tu información sensible**, y a la **no discriminación** por ejercer tus derechos.
Ejércelos en `[[CORREO DE PRIVACIDAD]]`. Podemos requerir verificar tu identidad.

---

### Anexo C — Notas de trabajo (no forma parte del aviso publicado)

1. **Aviso simplificado (#4).** Debe existir una versión **corta** en el punto de captación (registro y
   formularios) que remita a este aviso integral. Pendiente redactar como documento #4.
2. **Autoridad de datos.** Confirmar el nombre y la vía vigentes tras la desaparición del INAI (2025).
3. **Remisiones vs. transferencias.** Confirmar con el abogado la calificación de cada proveedor
   (encargado vs. responsable) para decidir qué entra en la cláusula del Art. 35 (§8).
4. **Brecha G10** del tracker: falta el **canal self-service** para ejercer ARCO / derechos GDPR / CCPA.
5. Alinear los plazos de conservación con el documento #14 cuando se redacte.
