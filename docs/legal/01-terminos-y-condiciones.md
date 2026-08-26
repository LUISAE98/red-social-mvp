# Términos y Condiciones de Servicio de Vibra

> **⚠️ CAMBIO DE MODELO (2026-08-26): INTERMEDIACIÓN.** Sustituye al modelo de *vendedor directo* que
> rigió entre julio y agosto de 2026. Bajo el modelo vigente **el Creador vende y presta al Comprador**,
> y **Vibra intermedia y cobra por cuenta del Creador**. Vibra responde de la plataforma, del cobro y del
> proceso de reembolso; el Creador responde de prestar lo que ofreció.
>
> El cambio no es de redacción: cambia **quién vende, quién factura y quién responde de qué**. Todo
> párrafo que aún describa a Vibra como vendedora y al Creador como su proveedor debe leerse como
> superado. Ver [fiscal-iva-isr-plataforma.md](./fiscal-iva-isr-plataforma.md) y el
> [Acuerdo de Creador](./02-acuerdo-de-creador.md) (#2).
>
> **Entidad: Vibra On, LLC. Procesadora: Stripe. Denominación: USD. Reparto: 75% Creador / 25% Vibra**
> sobre el precio base, con el impuesto de la comisión por encima. Los once Servicios están **activos**.
> Ver `docs/stripe-integracion.md` y `docs/modelo-financiero.md`.
>
> **BORRADOR v0.5 — 2026-07-31. Documento de trabajo extenso; NO sustituye la revisión de un abogado.**
> Se redactó para ser lo más completo y protector posible como *plantilla*. Dos cosas siguen siendo
> indispensables antes de publicarlo: **(1)** completar los datos de la entidad y contactos
> (`[[placeholders]]`), que solo tú/tu abogado pueden aportar, y **(2)** la **validación y firma de un
> abogado mexicano** (protección de datos / fintech / consumidor), con apoyo de contraparte en la UE
> (GDPR/DSA) y EEUU (DMCA, privacidad estatal, arbitraje) por el alcance global. Ver
> [README.md](./README.md) y [../marco-legal.md](../marco-legal.md).
>
> **Placeholders a completar:** `[[RAZÓN SOCIAL]]`, `[[RFC]]`, `[[DOMICILIO LEGAL]]`,
> `[[CIUDAD/ENTIDAD DE JURISDICCIÓN]]`, `[[MONEDA BASE = MXN]]`, `[[CORREO LEGAL]]`,
> `[[CORREO DE PRIVACIDAD]]`, `[[CORREO DMCA / AGENTE DESIGNADO]]`, `[[CORREO DE SEGURIDAD]]`,
> `[[CORREO DE SOPORTE]]`, `[[REPRESENTANTE UE]]`, `[[FECHA DE PUBLICACIÓN]]`.
>
> **Decisiones de producto que este borrador asume (confirmar):** edad mínima **18**; contenido adulto
> **prohibido** por ahora (si se permite → documento #18 + ajuste de §17, §40, §58); resolución de
> disputas **por tribunales** (si se opta por arbitraje + renuncia a acción colectiva para EEUU → §80);
> comisiones/mínimos/plazos/tipos de cambio viven en #2, #7, #8, #9.

**Última actualización:** `[[FECHA DE PUBLICACIÓN]]` · **Entrada en vigor:** a partir de su aceptación.

**Índice**
- **Parte I. Generalidades** (§1–§6)
- **Parte II. Tu cuenta** (§7–§14)
- **Parte III. Uso de la Plataforma** (§15–§22)
- **Parte IV. Tu Contenido** (§23–§29)
- **Parte V. Creadores y monetización** (§30–§36)
- **Parte VI. Pagos, Wallet y retiros** (§37–§46)
- **Parte VII. Reglas por tipo de Servicio** (§47–§60)
- **Parte VIII. Moderación, seguridad y cumplimiento** (§61–§70)
- **Parte IX. Propiedad intelectual** (§71–§75)
- **Parte X. Privacidad, datos y comunicaciones** (§76–§79)
- **Parte XI. Terminación** (§80–§82)
- **Parte XII. Responsabilidad y riesgos** (§83–§88)
- **Parte XIII. Disposiciones legales** (§89–§100)

---

# Parte I. Generalidades

## 1. Quiénes somos y qué regula este documento

1.1. Estos Términos y Condiciones de Servicio (los "**Términos**") regulan el acceso y uso de la
plataforma **Vibra**, disponible en `https://vibraon.com`, sus subdominios y aplicaciones asociadas
(conjuntamente, la "**Plataforma**"), operada por `[[RAZÓN SOCIAL]]`, con RFC `[[RFC]]` y domicilio en
`[[DOMICILIO LEGAL]]` ("**Vibra**", "**nosotros**", "**nuestro**").

1.2. Vibra es una plataforma social centrada en creadores que permite construir perfiles y comunidades,
publicar y consumir contenido, transmitir en vivo, realizar videollamadas 1‑a‑1 y adquirir u ofrecer
servicios digitales monetizables.

1.3. Estos Términos aplican a todos los Usuarios (Fans, Creadores y visitantes) con independencia del
país desde el que accedan, complementados por los derechos imperativos de su jurisdicción.

## 2. Aceptación de los Términos

2.1. Al crear una Cuenta, acceder o usar la Plataforma, la persona usuaria ("**Usuario**", "**tú**")
declara haber leído, entendido y aceptado estos Términos y los documentos que forman parte integral de
los mismos (§3). Si aceptas en nombre de una persona moral, declaras tener facultades para obligarla.

2.2. Si no estás de acuerdo con estos Términos, no debes acceder ni usar la Plataforma.

2.3. **Contrato de adhesión.** Estos Términos constituyen un contrato de adhesión en términos de la Ley
Federal de Protección al Consumidor ("**LFPC**"). `[[Pendiente: inscripción del modelo de contrato de
adhesión ante PROFECO y número de registro.]]`

## 3. Documentos que forman parte de estos Términos (orden de prelación)

3.1. Se incorporan por referencia y forman parte de estos Términos:

- [Acuerdo de Creador / Monetización](./02-acuerdo-de-creador.md) (#2)
- [Aviso de Privacidad Integral](./03-aviso-privacidad-integral.md) (#3) y [simplificado](./04-aviso-privacidad-corto.md) (#4)
- [Política de Cookies](./05-politica-cookies.md) (#5)
- [Normas de Comunidad](./06-normas-comunidad.md) (#6)
- [Política de Reembolsos y Cancelaciones](./07-politica-reembolsos.md) (#7)
- [Términos de la Wallet](./08-terminos-wallet.md) (#8)
- [Política de Pagos, Comisiones y Retiros](./09-pagos-comisiones-retiros.md) (#9)
- [Consentimiento de Grabación](./10-consentimiento-grabacion.md) (#10) y [Biométrico](./11-consentimiento-biometrico.md) (#11)
- [Política de Propiedad Intelectual / DMCA](./12-propiedad-intelectual-dmca.md) (#12)
- [Política de Verificación de Edad](./13-verificacion-edad.md) (#13)
- [Política de Retención y Eliminación de Datos](./14-retencion-datos.md) (#14) y de [Accesibilidad](./17-accesibilidad.md) (#17)

3.2. **Prelación.** En caso de conflicto entre estos Términos y un documento específico, prevalece el
documento específico respecto de la materia que regula, salvo disposición legal en contrario.

## 4. Definiciones

- **Usuario:** toda persona que accede o usa la Plataforma.
- **Cuenta:** el registro personal mediante el cual el Usuario accede a la Plataforma.
- **Creador:** Usuario que activa la monetización y **vende y presta sus Servicios directamente al Comprador**, usando la Plataforma como canal de oferta, cobro y entrega (ver §16 y [Acuerdo de Creador](./02-acuerdo-de-creador.md) (#2)).
- **Fan / Comprador:** Usuario que sigue e interactúa con Creadores y que **adquiere Contenido o Servicios del Creador**, pagando a través de la Plataforma.
- **Contenido:** todo material publicado, transmitido o intercambiado (texto, imágenes, fotos, video bajo demanda ("VOD"), historias, transmisiones en vivo, comentarios, reacciones, mensajes, grabaciones).
- **Contenido de Usuario:** el Contenido creado o subido por Usuarios, distinto del Contenido y elementos propios de Vibra.
- **Servicios:** las funciones monetizables descritas en la Parte VII, que **el Creador vende al Comprador** a través de la Plataforma.
- **Comunidad:** grupo dentro de la Plataforma; puede ser **pública**, **privada** u **oculta**.
- **Membresía:** suscripción de renovación automática que da acceso a una Comunidad o a contenido exclusivo.
- **Sesión 1‑a‑1:** videollamada en tiempo real entre un Creador y un Comprador, que **se graba**. Comprende *Sesión exclusiva* y *Tiempo contigo* (este último antes denominado "meet & greet").
- **Saludo / Consejo / Mensaje:** contenido personalizado a solicitud, entregado por el Creador.
- **Apoyo:** contraprestación que el Fan paga al Creador a cambio del reconocimiento, la visibilidad o el acceso que éste le otorga. **No es un donativo** y recibe el mismo tratamiento que cualquier otra venta.
- **Wallet:** el registro contable interno donde se refleja el Saldo del Usuario dentro de la Plataforma.
- **Saldo:** el crédito interno reflejado en la Wallet; **no constituye dinero electrónico, depósito ni instrumento de pago** (ver §39).
- **Retiro:** solicitud del Creador para recibir su Saldo disponible a través del Proveedor de Pagos.
- **Proveedor de Pagos:** **Stripe** (Stripe Connect), el procesador de pagos que Vibra utiliza para procesar los cobros y liquidar los pagos, junto con las entidades financieras autorizadas aplicables.
- **KYC:** el proceso de verificación de identidad, operado a través del Proveedor de Pagos.
- **Moderador / Superadministrador:** personal autorizado por Vibra con funciones de moderación y cumplimiento (Parte VIII).
- **Servicios de Terceros:** servicios de infraestructura de proveedores externos (p. ej. Mux, Cloudflare, LiveKit, Stripe, Firebase, Vercel).

## 5. Modificaciones a los Términos y a la Plataforma

5.1. Podemos modificar estos Términos por motivos legales, de seguridad, técnicos o del negocio. Los
cambios **sustanciales** se notificarán con antelación razonable a su entrada en vigor.

5.2. El uso continuado tras la entrada en vigor implica aceptación. Si no estás de acuerdo, debes dejar
de usar la Plataforma y, en su caso, dar de baja tu Cuenta.

5.3. Podemos modificar, suspender o descontinuar funciones, procurando no afectar derechos ya
devengados.

## 6. Idioma y versión aplicable

6.1. Rige la versión en **español**. Las traducciones se ofrecen por conveniencia; en caso de
discrepancia, prevalece el español.

---

# Parte II. Tu cuenta

## 7. Elegibilidad y edad mínima

7.1. Debes tener al menos **18 años**. La Plataforma no está dirigida a menores; no permitimos su
registro ni recabamos conscientemente sus datos (ver [Política de Verificación de Edad](./13-verificacion-edad.md) (#13)).

7.2. No puedes usar la Plataforma si estás legalmente impedido, si tu Cuenta fue cancelada por
incumplimiento, o si te encuentras en una jurisdicción o lista respecto de la cual la ley nos prohíba
prestar servicios (§46).

## 8. Registro e información veraz

8.1. Debes proporcionar información veraz, completa y actualizada, y mantenerla al día. Podemos rechazar
un registro o condicionar el acceso a verificaciones adicionales.

## 9. Verificación de identidad (KYC)

9.1. Para monetizar y **retirar Saldo**, el Creador debe completar el KYC con nuestro proveedor. Puede
incluir tratamiento de **datos biométricos** y de documentos de identidad, sujeto al
[Consentimiento Biométrico](./11-consentimiento-biometrico.md) (#11) y al
[Aviso de Privacidad](./03-aviso-privacidad-integral.md) (#3).

9.2. Podemos repetir o actualizar la verificación por razones de seguridad, cumplimiento o prevención
de fraude o lavado de dinero.

## 10. Seguridad de la Cuenta

10.1. Eres responsable de la confidencialidad de tus credenciales y de toda actividad realizada desde
tu Cuenta. Debes **notificarnos de inmediato** cualquier acceso no autorizado.

10.2. La Plataforma ofrece **gestión de sesiones y dispositivos** para revisar y cerrar sesiones
abiertas; el cierre revoca el acceso del dispositivo correspondiente.

## 11. Titularidad y uso personal de la Cuenta

11.1. La Cuenta es **personal e intransferible**. No puedes venderla, rentarla, cederla ni permitir su
uso por terceros sin autorización.

11.2. No puedes crear Cuentas para suplantar a terceros, evadir sanciones o bloqueos, ni operar Cuentas
de forma automatizada sin autorización.

## 12. Verificación de cuentas, insignias y suplantación

12.1. Vibra puede ofrecer **insignias de verificación** u otros distintivos. Su otorgamiento es
discrecional y revocable; no implican respaldo de Vibra al Contenido del Usuario.

12.2. Está prohibido **suplantar** a personas o entidades o sugerir de forma engañosa una afiliación o
verificación inexistente.

## 13. Comunicaciones de la Cuenta

13.1. Al registrarte **consientes recibir comunicaciones electrónicas** de servicio (transaccionales,
de seguridad, legales y operativas), con la misma validez que las comunicaciones por escrito.

13.2. Las comunicaciones **de marketing** requieren tu consentimiento y son revocables en cualquier
momento, sin afectar las de servicio.

## 14. Cuentas inactivas

14.1. Podemos marcar como inactivas las Cuentas sin actividad prolongada y, previa notificación
razonable, restringirlas o cancelarlas, respetando la liquidación del Saldo conforme a los
[Términos de la Wallet](./08-terminos-wallet.md) (#8), la §45 y la ley aplicable.

---

# Parte III. Uso de la Plataforma

## 15. Licencia de uso de la Plataforma

15.1. Sujeto a estos Términos, te otorgamos una **licencia limitada, personal, no exclusiva, no
transferible y revocable** para acceder y usar la Plataforma para fines personales y, en el caso de
Creadores, para ofrecer sus Servicios.

15.2. No adquieres derecho de propiedad alguno sobre la Plataforma ni sus componentes.

## 16. Rol de Vibra como intermediaria

16.1. **El Creador vende y presta al Comprador.** Respecto de los Servicios, el Creador es quien ofrece,
quien fija su precio y quien ejecuta la prestación. **El contrato de compra se celebra entre el Comprador
y el Creador.**

16.2. **Vibra intermedia y cobra por cuenta del Creador.** Vibra opera la Plataforma, publica el catálogo,
procesa el cobro, entrega técnicamente el Contenido, modera y da soporte. **Cobra el precio y los
impuestos de la venta en nombre y por cuenta del Creador**, al amparo del mandato de cobro que éste le
otorga (Acuerdo de Creador §3), y retiene su comisión y las retenciones fiscales obligatorias.

16.3. **Reparto de responsabilidades.** El **Creador responde** de prestar lo que ofreció, de que su
Contenido sea lícito y de contar con los derechos necesarios. **Vibra responde** del funcionamiento de la
Plataforma, de la correcta ejecución del cobro y de tramitar los reembolsos conforme a la
[Política de Reembolsos](./07-politica-reembolsos.md) (#7).

16.4. **Reembolsos.** Por ser quien cobró, **Vibra gestiona y ejecuta los reembolsos** frente al
Comprador, y los repercute al Creador conforme al Acuerdo de Creador §9. Que Vibra los gestione no la
convierte en vendedora ni traslada a ella la obligación de prestar el Servicio.

16.5. **Moderación.** Vibra puede rechazar, retirar o desmonetizar Contenido conforme a la Parte VIII, y
**repetir contra el Creador** por el incumplimiento de sus obligaciones.

> **⚠️ Validar por abogado/fiscalista:** la caracterización de Vibra como **intermediaria y prestadora de
> servicios de cobranza**; la suficiencia del **mandato de cobro** para emitir comprobantes por cuenta del
> Creador; y el reparto de responsabilidad de consumo (PROFECO/LFPC) entre Creador y Plataforma.

## 17. Reglas de conducta y uso aceptable

17.1. Te obligas a cumplir la ley, estos Términos y las [Normas de Comunidad](./06-normas-comunidad.md)
(#6).

17.2. **Queda prohibido**, de forma enunciativa:

- publicar Contenido ilegal o que promueva actividades ilegales;
- **material de abuso sexual infantil o que involucre a menores** de cualquier forma (tolerancia cero; §67);
- contenido sexual o íntimo de personas sin su consentimiento (NCII) o material sintético no consentido ("deepfakes");
- incitar al odio, la violencia, el terrorismo, la autolesión o la discriminación;
- acosar, amenazar, intimidar, extorsionar, difamar o suplantar a personas;
- infringir derechos de propiedad intelectual o de imagen de terceros (Parte IX);
- fraude, engaño o manipulación de métricas, reseñas, insignias o sistemas de la Plataforma;
- distribuir malware, hacer ingeniería inversa, vulnerar la seguridad o interferir con la operación;
- eludir controles de edad, moderación, pago, geográficos o de seguridad;
- lavado de dinero, financiamiento ilícito o evasión de sanciones;
- recopilar datos de otros Usuarios sin autorización (scraping) o violar su privacidad;
- usar bots o automatización no autorizada;
- ofrecer bienes o servicios **prohibidos o de alto riesgo** que la ley o nuestras políticas no permitan.

17.3. **Contenido adulto.** Por el momento, la Plataforma **no permite contenido sexual explícito ni
pornográfico**. `[[Si Vibra decide permitirlo, se activa el documento #18 (contenido adulto, registros
2257 y consentimiento de performers) y esta sección se sustituye por el régimen correspondiente,
incluida la verificación de edad de espectadores y las reglas del Proveedor de Pagos.]]`

## 18. Funciones sociales

18.1. La Plataforma permite seguir perfiles, unirse a Comunidades, comentar, reaccionar, mencionar,
compartir, publicar historias y enviar mensajes, conforme a las reglas de cada función y a las Normas
de Comunidad.

18.2. Ofrecemos herramientas para **bloquear, silenciar o reportar** a otros Usuarios. El bloqueo entre
Usuarios es una función social distinta de las medidas de moderación de Vibra (Parte VIII).

## 19. Comunidades públicas, privadas y ocultas

19.1. Las Comunidades pueden ser **públicas**, **privadas** u **ocultas**. El carácter privado u oculto
limita la visibilidad frente a otros Usuarios, **pero no frente a las funciones de moderación y
cumplimiento de Vibra** (§61).

19.2. Los administradores de una Comunidad deben moderar su espacio conforme a estos Términos, sin que
ello sustituya las facultades de Vibra.

## 20. Disponibilidad, funciones beta y Servicios de Terceros

20.1. Procuramos operación continua, pero la Plataforma puede sufrir interrupciones por mantenimiento,
fallos o causas ajenas (§87).

20.2. Algunas funciones pueden ofrecerse como **beta**, sin garantías y sujetas a cambio o retiro.

20.3. La Plataforma se apoya en **Servicios de Terceros**; su disponibilidad y condiciones pueden
afectar el funcionamiento. Los enlaces o integraciones a servicios externos se rigen por los términos
de dichos terceros, de los que Vibra no es responsable.

## 21. Aplicaciones móviles y tiendas de aplicaciones

21.1. Si accedes mediante una aplicación distribuida por una tienda (p. ej. App Store o Google Play),
también aplican los términos de dicha tienda. En caso de conflicto sobre la licencia de la aplicación,
prevalecerán los términos de la tienda respecto de esa licencia. `[[Ajustar si hay app nativa.]]`

## 22. Redes, datos y compatibilidad

22.1. El uso de la Plataforma requiere conexión a internet y equipos compatibles; los costos de datos y
equipo son a tu cargo. La calidad de video, VOD, transmisiones y videollamadas puede depender de tu
conexión y de Servicios de Terceros.

---

# Parte IV. Tu Contenido

## 23. Titularidad de tu Contenido

23.1. Conservas la **titularidad** de los derechos sobre tu Contenido de Usuario. Estos Términos no
transfieren su propiedad a Vibra.

## 24. Licencia que otorgas a Vibra

24.1. Nos otorgas una licencia **mundial, no exclusiva, transferible, sublicenciable y libre de
regalías** para **alojar, almacenar, reproducir, adaptar técnicamente (p. ej. transcodificar),
distribuir, comunicar públicamente y mostrar** tu Contenido, **con la finalidad de operar, proteger,
promover y mejorar la Plataforma** y prestar los Servicios.

24.2. La licencia se ejerce conforme a la **visibilidad** que elijas (p. ej. el contenido premium o de
Comunidad privada solo se muestra a quien tiene acceso).

24.3. **Terminación de la licencia.** Termina cuando eliminas el Contenido o das de baja tu Cuenta,
salvo: (i) copias de respaldo por un periodo razonable; (ii) Contenido ya compartido con terceros que
no lo hayan eliminado; y (iii) conservación requerida por ley, autoridad, o para moderación, seguridad
y cumplimiento (§66).

## 25. Declaraciones y responsabilidades sobre el Contenido

25.1. Declaras y garantizas que: (i) tienes todos los derechos necesarios sobre tu Contenido; (ii) no
infringe derechos de terceros ni la ley; y (iii) cuentas con el consentimiento de las personas
identificables que aparezcan en él.

25.2. **Derechos de imagen y voz de terceros.** No puedes publicar Contenido que use la imagen, voz o
identidad de un tercero sin su consentimiento, ni material sintético que lo suplante.

25.3. Eres el único responsable de tu Contenido y de las consecuencias de publicarlo.

## 26. Respaldo, eliminación y conservación

26.1. Puedes eliminar tu Contenido en cualquier momento; la eliminación lo retira de la vista pública,
pero **puede conservarse en estado inactivo** por razones técnicas, de respaldo, legales o de moderación
(§66 y [Política de Retención](./14-retencion-datos.md) (#14)).

26.2. Vibra no garantiza almacenamiento permanente y recomienda conservar copias propias.

## 27. Comentarios y sugerencias (feedback)

27.1. Si nos envías comentarios o sugerencias, nos otorgas el derecho de usarlos sin restricción ni
compensación.

## 28. Reseñas, calificaciones y reputación

28.1. Las reseñas o calificaciones deben ser honestas y basadas en experiencias reales. Está prohibido
manipular la reputación con reseñas falsas, incentivadas de forma engañosa o compradas.

## 29. Contenido de terceros y enlaces

29.1. La Plataforma puede mostrar Contenido de otros Usuarios o enlaces a sitios de terceros. No
respaldamos ni somos responsables de dicho contenido o sitios; su uso es bajo tu propio riesgo.

---

# Parte V. Creadores y monetización

## 30. Activación de la monetización

30.1. Para monetizar, el Usuario debe aceptar el [Acuerdo de Creador](./02-acuerdo-de-creador.md) (#2),
completar el KYC cuando aplique y cumplir los requisitos de la Plataforma. El Acuerdo de Creador
**complementa** estos Términos.

## 31. Relación entre Vibra y el Creador (independencia)

31.1. El Creador actúa como **prestador independiente** de sus Servicios. **Nada en estos Términos crea
una relación laboral, de sociedad, de mandato, de agencia o de empresa conjunta** entre Vibra y el
Creador. El Creador no es empleado ni representante de Vibra y no puede obligarla frente a terceros.

31.2. El Creador es responsable de sus propias herramientas, permisos, licencias, seguros y
cumplimiento (incluido el fiscal) necesarios para ofrecer sus Servicios.

## 32. Sin garantía de ingresos ni resultados

32.1. Vibra **no garantiza** ingresos, audiencia, ventas, visibilidad ni resultado alguno al Creador.
Las estimaciones, métricas o proyecciones son referenciales y no vinculantes.

## 33. Relación entre las partes

33.1. El Comprador contrata **con Vibra**; el Creador suministra a Vibra el Contenido/ejecución como
**proveedor**. El Creador debe describir con veracidad lo que ofrece a Vibra y cumplir en tiempo y forma,
para que Vibra pueda cumplir frente al Comprador.

33.2. El Creador **no debe redirigir los pagos fuera de la Plataforma** ni contratar directamente con el
Comprador para eludir a Vibra, sus controles o su reparto, cuando el Servicio se ofrezca a través de Vibra.

## 34. Precios y presentación de los Servicios

34.1. **El Creador fija el precio** de sus Servicios, dentro de los mínimos y máximos que publique la
Plataforma. El **precio total** que paga el Comprador —incluidos el cargo de servicio, la conversión de
moneda y los impuestos del país del Comprador— se muestra **antes de la compra**.

34.2. **Cargos incluidos en el precio.** El precio total puede incluir un **cargo fijo de servicio** y,
para Compradores que pagan en otra moneda, la **conversión** aplicable, presentada en su moneda local.
Todo se muestra desglosado o incluido en el total **antes de confirmar**.

## 35. Reparto económico con el Creador

35.1. Del **precio base** de cada venta, el Creador conserva el **75%** y Vibra retiene el **25%** como
comisión por intermediación, cobro y operación de la Plataforma.

35.2. **La comisión de Vibra causa su propio impuesto, que se suma por encima del 25%**, no se descuenta
de él. Cuando el Creador es contribuyente con actividad gravada, ese impuesto le es acreditable.

35.3. **El impuesto cobrado al Comprador no forma parte del precio base ni se reparte.**

35.4. Los porcentajes pueden variar por tipo de Servicio y se detallan en el
[Acuerdo de Creador](./02-acuerdo-de-creador.md) (#2).

## 36. Obligaciones fiscales del Creador

36.1. **El Creador es el vendedor y, como tal, el contribuyente del impuesto de la venta.** Vibra lo cobra
por su cuenta y lo entera o lo pone a su disposición según corresponda (§43).

36.2. **Vibra retiene y entera** los impuestos que la ley la obliga a retener sobre el pago al Creador, y
le entrega la constancia correspondiente. **Las retenciones no reducen su participación: la anticipan.**

36.3. **Las tasas dependen de la residencia, el régimen fiscal y los datos que el Creador haya entregado.**
No entregarlos implica retenciones mayores y puede impedir el retiro.

36.4. **Comprobantes.** El comprobante de la venta corresponde al Creador; **Vibra lo emite por él** al
amparo del mandato de cobro. Vibra le emite además el comprobante de su comisión y la constancia de
retenciones. El Creador no mexicano recibe un comprobante de pago y, **cuando se le retiene impuesto
mexicano, también la constancia de retenciones** (Acuerdo de Creador §7).

> **⚠️ Validar por fiscalista:** el régimen de retención por residencia y régimen, y la vía por la que
> Vibra emite comprobantes por cuenta del Creador.

---

# Parte VI. Pagos, Wallet y retiros

## 37. Procesamiento de pagos

37.1. Los pagos se procesan a través de **Stripe** (Proveedor de Pagos). Al pagar, **contratas con el
Creador**; Vibra cobra por cuenta de éste y aparece como cargo en tu estado de cuenta. Autorizas el cargo
por el monto total mostrado.

37.2. Podemos permitir **guardar métodos de pago**; el almacenamiento y tokenización de los datos de
tarjeta lo realiza el Proveedor de Pagos conforme a sus estándares (p. ej. PCI‑DSS). Vibra **no
almacena los datos completos de tu tarjeta**.

## 38. Autorización, verificación y prevención de fraude

38.1. Podemos realizar validaciones y controles antifraude sobre las operaciones y, cuando proceda,
solicitar verificación adicional o rechazar una operación sospechosa.

## 39. Naturaleza del Saldo y de la Wallet

39.1. La Wallet es un **registro contable interno**. El Saldo refleja créditos a favor del Usuario
dentro de la Plataforma y **no constituye dinero electrónico, fondos de pago electrónico, depósito
bancario, ni una cuenta de pago** en términos de la legislación financiera. El Saldo **no genera
intereses**, no es una cuenta a la vista y **no es transferible entre Usuarios**.

39.2. **Custodia del dinero.** Los fondos son procesados y custodiados por el Proveedor de Pagos y las
entidades financieras autorizadas aplicables. **Vibra no custodia dinero de los Usuarios ni opera como
institución financiera.** Los términos completos están en los
[Términos de la Wallet](./08-terminos-wallet.md) (#8).

## 40. Monedas y tipo de cambio

40.1. La moneda base de liquidación es **MXN**. A los Compradores en otra moneda se les puede **presentar
el precio en su moneda local** con el tipo de cambio aplicable ya incluido (p. ej. mediante la función de
conversión de Stripe) **antes de pagar**; pueden aplicarse conversiones y comisiones del Proveedor de
Pagos o de las redes de tarjetas.

## 41. Confirmación de compra y comprobantes

41.1. Al completar una compra recibirás confirmación. Los comprobantes fiscales, cuando procedan, se
emiten conforme a la ley aplicable.

## 42. Contracargos y disputas de pago

42.1. Si desconoces un cargo, contáctanos **antes** de iniciar un contracargo para intentar resolverlo.
El uso indebido de contracargos ("fraude amistoso") puede dar lugar a la suspensión de la Cuenta y a la
retención de Saldos relacionados.

42.2. Podemos **retener, revertir o compensar** importes en caso de fraude, error, contracargo o
reclamación fundada.

## 43. Impuestos de la venta

43.1. **El impuesto de la venta lo determina el país del Comprador**, no el del Creador. Vibra lo calcula,
lo incluye en el precio total mostrado y lo cobra por cuenta del Creador, que es el vendedor.

43.2. **Comprador en México:** la venta lleva el impuesto mexicano vigente.

43.3. **Comprador fuera de México:** la venta lleva el impuesto del país del Comprador, cuando Vibra esté
obligada a recaudarlo allí. Para los Servicios del catálogo, **la venta no lleva impuesto mexicano** por
tratarse de exportación de servicios.

43.4. El impuesto de la venta es **independiente** de las retenciones sobre el pago al Creador (§36): son
dos cálculos distintos, con bases y destinatarios distintos.

> **⚠️ Validar por fiscalista:** la matriz de impuestos por país del Comprador, el sustento documental de
> la exportación de servicios y la evidencia de ubicación del Comprador que debe conservarse por
> operación. Ver [fiscal-iva-isr-plataforma.md](./fiscal-iva-isr-plataforma.md).

## 44. Comisiones, deducciones y compensación (set‑off)

44.1. Vibra puede **deducir o compensar** de la participación o del Saldo del Creador: su comisión y el
impuesto de ésta, los impuestos retenidos sobre su pago, los reembolsos, contracargos, importes pagados
por error y ajustes que correspondan, de forma transparente y trazable en el historial de la Wallet.

## 45. Retiros

45.1. El Creador puede solicitar el retiro de su **Saldo disponible**, sujeto a: (i) KYC completado;
(ii) revisión de la solicitud (que puede incluir revisión humana); (iii) mínimos, plazos y límites
definidos en la [Política de Pagos, Comisiones y Retiros](./09-pagos-comisiones-retiros.md) (#9); y (iv)
controles de prevención de lavado de dinero y de sanciones.

45.2. Podemos **retener, aplazar o rechazar** un retiro ante sospechas fundadas de fraude, ilegalidad,
incumplimiento o requerimiento de autoridad, informando al Creador en la medida en que la ley lo
permita.

45.3. **Saldos inactivos / no reclamados.** Los Saldos sin actividad o no reclamados se tratarán
conforme a los Términos de la Wallet y a la legislación aplicable en materia de bienes no reclamados.

## 46. Prevención de lavado de dinero, sanciones y controles

46.1. Vibra aplica controles de **prevención de lavado de dinero y financiamiento al terrorismo** y
puede requerir información adicional, identificar operaciones y, cuando la ley lo exija, presentar los
avisos correspondientes a las autoridades.

46.2. **Sanciones y restricciones geográficas.** No prestamos servicios a personas o territorios sujetos
a sanciones aplicables (p. ej. ONU, OFAC/EEUU, UE) ni donde la ley lo prohíba. **Declaras** no
encontrarte en dichas listas o territorios ni actuar por cuenta de quien lo esté.

---

# Parte VII. Reglas por tipo de Servicio

> Estas reglas complementan la [Política de Reembolsos](./07-politica-reembolsos.md) (#7). El precio
> total y las condiciones de cada Servicio se muestran antes de la compra.

## 47. Catálogo de Servicios

47.1. A través de la Plataforma, el Creador puede vender **once Servicios**: **(1)** saludo personalizado,
**(2)** consejo personalizado, **(3)** sesión exclusiva, **(4)** tiempo contigo, **(5)** apoyo en perfil o
comunidad, **(6)** apoyo durante una transmisión en vivo, **(7)** entrada a una transmisión en vivo,
**(8)** súper comentario, **(9)** contenido grabado de pago, **(10)** publicación de pago y **(11)**
suscripción mensual a comunidad. Vibra puede agregar, modificar o retirar tipos de Servicio.

47.2. **Licencia al Comprador.** Al adquirir Contenido o un acceso, **el Creador te otorga —a través de
Vibra— una licencia personal, limitada, revocable, no exclusiva y no transferible**, de **acceso y uso
personal y no comercial**, sin derecho de descarga, redistribución, comunicación pública ni explotación
comercial. **No adquieres la titularidad** del Contenido: permanece en el Creador. El acceso puede
terminar cuando termine tu relación con la Plataforma o el Creador retire el Contenido.

47.3. **Disponibilidad.** Los once Servicios están activos. Vibra puede suspender o retirar cualquiera de
ellos, en general o para un Creador determinado, por razones de cumplimiento, riesgo o requerimiento de
los procesadores de pago.

## 48. Contenido premium y accesos de pago (VOD)

48.1. Otorgan acceso a Contenido o a un video bajo demanda de pago. Salvo defecto o falta de
disponibilidad imputable al Creador o a la Plataforma, el acceso a contenido digital ya disponible o
consumido **no es reembolsable**, sin perjuicio de los derechos del consumidor (§85 y §96).

## 49. Membresías / suscripciones (renovación automática)

49.1. Son **de renovación automática** por el periodo elegido. **Antes de suscribirte** se informa el
precio, la periodicidad y las fechas de cargo.

49.2. **Cancelación.** Puedes cancelar en cualquier momento, de forma **tan sencilla como te
suscribiste**. La cancelación surte efecto al final del periodo pagado, conservando el acceso hasta
entonces, salvo que la ley o la Política de Reembolsos dispongan otra cosa.

49.3. Los cambios de precio se notifican con antelación razonable y aplican a periodos posteriores.

## 50. Saludos, consejos y mensajes personalizados

50.1. El Fan solicita el contenido personalizado; el Creador puede **aceptar o rechazar**.

50.2. **Plazo de entrega.** El Creador debe entregarlo dentro del plazo ofrecido. Si no lo cumple o lo
rechaza, procede el **reembolso** (Política de Reembolsos (#7)).

50.3. **Licencia.** Se entrega para **uso personal y no comercial** del Comprador bajo la licencia de la
§47.2; el Creador conserva la titularidad de los derechos de autor y otorga a Vibra los derechos para
comercializarlo y entregarlo.

50.4. El contenido solicitado no puede infringir la ley ni las Normas de Comunidad; el Creador puede
negarse a solicitudes que las violen.

## 51. Videollamadas 1‑a‑1 grabadas

51.1. Los productos de **videollamada 1‑a‑1 grabada** son **Sesión exclusiva** y **Tiempo contigo** (este
último antes denominado "meet & greet"). Los presta el Creador, que fija su precio y su disponibilidad.

51.2. La videollamada **se graba** y el acceso requiere el
**consentimiento expreso de grabación de ambas partes** antes de iniciar, conforme al
[Consentimiento de Grabación](./10-consentimiento-grabacion.md) (#10) y §77, además de las reglas de
puntualidad, no‑show, conducta y uso de la grabación que se publicarán entonces.

## 52. Sesiones y eventos en vivo de pago; entradas (tickets)

52.1. El acceso a ciertas transmisiones o sesiones en vivo puede requerir el **pago de una entrada**. La
entrada da acceso al evento en las fechas y condiciones indicadas.

52.2. Si el evento se cancela por causa imputable al Creador o a la Plataforma, procede reembolso o
reprogramación conforme a la Política de Reembolsos.

## 53. Transmisiones en vivo (lives)

53.1. Los Creadores pueden transmitir en vivo. El Contenido en vivo está sujeto a estos Términos y a las
Normas de Comunidad y puede ser **moderado en tiempo real**. Una transmisión puede quedar disponible
después como VOD si el Creador lo habilita.

## 54. Supercomentarios

54.1. Un **supercomentario** es un comentario o mensaje **destacado de pago** durante una transmisión o
publicación. Al comprarlo, autorizas su cargo; su naturaleza es de **contraprestación** por la atención
del Creador y la función de destacado, no un donativo deducible.

54.2. Salvo error, **no es reembolsable**. Los supercomentarios están sujetos a moderación y pueden ser
retirados si violan las reglas, sin que ello genere, por sí solo, derecho a reembolso cuando la retirada
se deba a un incumplimiento del Usuario.

## 55. Apoyos en perfil, comunidad y transmisiones en vivo

55.1. **Los Apoyos no son donativos.** Son la **contraprestación** que el Comprador paga al Creador a
cambio del reconocimiento, la visibilidad o el acceso que éste le otorga —aparecer con nombre, ser
mencionado, destacar en la transmisión o acceder a un espacio de la comunidad—. Se tratan como cualquier
otra venta del catálogo, con su precio, sus impuestos y su comisión.

55.2. **No tienen carácter de caridad ni son deducibles.** Vibra no es donataria autorizada y ningún
Apoyo genera comprobante de donativo. Está prohibido usar el lenguaje de "donación" para sugerir
deducibilidad fiscal.

55.3. Antes de pagar se muestra **qué recibe el Comprador** a cambio. Salvo error, los Apoyos **no son
reembolsables** una vez entregado ese reconocimiento o acceso.

> **⚠️ Nota de coherencia:** el tratamiento fiscal de los Apoyos depende de que exista contraprestación.
> Ninguna superficie del producto debe describirlos como donativos o aportaciones sin contrapartida.

> **⚠️ Validar por fiscalista (D‑05):** tratamiento de apoyos/donaciones y su distinción de la venta.

## 56. Eventos y experiencias

56.1. Se rigen por las condiciones específicas que publique el Creador (fecha, aforo, requisitos),
además de estos Términos y la Política de Reembolsos.

## 57. Regalos, promociones y créditos

57.1. Toda promoción o crédito promocional está sujeta a sus condiciones específicas, puede tener
vigencia limitada y **no es canjeable por dinero** salvo que la ley lo exija.

## 58. Contenido sensible y clasificación

58.1. Vibra puede aplicar **etiquetas de sensibilidad** o restricciones de acceso a cierto Contenido. El
Creador debe clasificar su Contenido con honestidad cuando la Plataforma lo requiera.

## 59. Naturaleza digital y derecho de desistimiento

59.1. Los Servicios son digitales y se prestan electrónicamente. Para su ejecución inmediata, en
jurisdicciones que reconozcan el derecho de desistimiento, se recabará tu **consentimiento y renuncia
expresa** conforme a la §96 y la Política de Reembolsos.

## 60. Reventa y uso indebido

60.1. Salvo autorización, no puedes **revender** accesos, entradas o Contenido, ni compartir
credenciales para eludir pagos. El acceso adquirido es personal.

---

# Parte VIII. Moderación, seguridad y cumplimiento

> Esta Parte refleja el sistema real de moderación de Vibra (rol `moderator`, cola de reportes con
> resolución, ejecución de acciones y **bitácora de auditoría** `adminAuditLog`) y las facultades que
> Vibra ejerce para mantener la Plataforma segura y conforme a la ley.

## 61. Alcance del acceso del Superadministrador

61.1. Con fines **exclusivos** de moderación, seguridad y cumplimiento legal, el personal de moderación
de Vibra ("**Superadministrador**" o "**Moderador**") puede **acceder a la totalidad del Contenido y
actividad de la Plataforma**, incluyendo Comunidades **privadas y ocultas**, publicaciones, comentarios,
mensajes, transmisiones, saludos, sesiones y **Contenido que haya sido eliminado** (el Contenido
eliminado se conserva en estado inactivo y permanece accesible para moderación y cumplimiento).

## 62. Finalidad limitada y confidencialidad

62.1. Este acceso se ejerce **únicamente** para moderar la Plataforma, atender reportes, prevenir y
detectar actividades ilícitas o violatorias de estos Términos, y cumplir obligaciones legales.

62.2. **El Superadministrador no puede divulgar, filtrar, comercializar ni entregar a terceros la
información a la que accede**, salvo (i) a las autoridades competentes en los casos y por los cauces
legales previstos, o (ii) cuando la ley lo obligue.

62.3. El personal de moderación está sujeto a deberes de **confidencialidad** y al
[Aviso de Privacidad](./03-aviso-privacidad-integral.md) (#3). El acceso indebido o la divulgación no
autorizada constituyen faltas graves y pueden derivar en responsabilidad.

## 63. No interacción

63.1. En su función de moderación, el Superadministrador **no participa en la vida social de la
Plataforma**: **no comenta, no reacciona ("like"), no publica ni interactúa** con el Contenido o los
Usuarios. Su función es estrictamente de supervisión y aplicación de las reglas.

## 64. Facultades de moderación

64.1. Ante un incumplimiento de estos Términos, de las Normas de Comunidad o de la ley, el
Superadministrador podrá adoptar, **de forma proporcional a la falta**, una o varias de las siguientes
medidas:

- **(a) Advertir** al Usuario para que cese una conducta;
- **(b) Silenciar (mutear)** temporalmente una Cuenta, limitando su capacidad de publicar o interactuar;
- **(c) Eliminar o inhabilitar Contenido** que infrinja las reglas;
- **(d) Restringir funciones** (p. ej. monetización, transmisión, comentarios) de una Cuenta;
- **(e) Suspender o bloquear (banear)** una Cuenta, impidiendo el acceso a la Plataforma;
- **(f) Eliminar** una Cuenta en casos graves o de reincidencia;
- **(g) Dar aviso a las autoridades** competentes en casos de contenido o conductas ilegales.

64.2. Las facultades anteriores son **taxativas** en su naturaleza (moderación y cumplimiento) y no
habilitan al Superadministrador a realizar actos distintos a los aquí previstos.

64.3. En casos de **riesgo grave o inminente** (p. ej. contenido de abuso infantil, amenazas de daño),
Vibra puede actuar de inmediato, incluyendo la preservación de evidencia y el aviso a las autoridades,
sin notificación previa al Usuario.

## 65. Reportes de Usuarios

65.1. Cualquier Usuario puede **reportar** Contenido o Cuentas mediante los mecanismos de la Plataforma,
indicando el motivo (p. ej. spam, discurso de odio, violencia, contenido ilegal, acoso, desinformación,
u otro).

65.2. Vibra revisa los reportes y los resuelve con una medida de la §64 o **desestimando** el reporte.
Vibra puede establecer **límites y controles antiabuso** del sistema de reportes.

## 66. Registro, auditoría y preservación

66.1. Toda acción de moderación y todo acceso relevante quedan **registrados en una bitácora de
auditoría interna**, con identificación del Moderador, la acción, el objeto afectado y la fecha.

66.2. Vibra puede **preservar** Contenido, registros y datos asociados cuando sea necesario para cumplir
la ley, atender requerimientos de autoridad, resolver disputas o hacer cumplir estos Términos, incluso
después de su eliminación por el Usuario, conforme a la [Política de Retención](./14-retencion-datos.md)
(#14).

## 67. Protección de menores y tolerancia cero

67.1. Vibra mantiene **tolerancia cero** frente a material de abuso sexual infantil y a la explotación de
menores. Detectado dicho material, Vibra lo removerá, preservará la evidencia, **suspenderá la Cuenta** y
**dará aviso a las autoridades** competentes y, cuando corresponda, a los organismos habilitados para su
reporte. `[[Confirmar con abogado el mecanismo de reporte aplicable por jurisdicción.]]`

## 68. Debido proceso y apelación

68.1. Cuando sea razonable y salvo impedimento legal o de seguridad, Vibra **informará** al Usuario
afectado sobre la medida adoptada y sus motivos, y pondrá a su disposición un medio para **apelar**
dentro de un plazo razonable. La resolución de la apelación puede confirmar, modificar o revertir la
medida.

## 69. Atención a Usuarios y quejas

69.1. Vibra ofrece un canal de **atención y quejas** en `[[CORREO DE SOPORTE]]` o dentro de la
Plataforma, y procurará responder en plazos razonables. Este canal no sustituye los derechos del Usuario
ante las autoridades de consumo o de protección de datos.

## 70. Cooperación con autoridades, DSA y transparencia

70.1. Vibra puede **atender requerimientos legales** de autoridades competentes y divulgar la información
estrictamente necesaria conforme a la ley y al Aviso de Privacidad.

70.2. **Usuarios en la Unión Europea (DSA).** Vibra pondrá a disposición un **punto de contacto** y
mecanismos de **notificación y acción** sobre contenido presuntamente ilícito, proporcionará, cuando
proceda, una **declaración de motivos** de las medidas de moderación, tratará con prioridad las
notificaciones de **alertadores fiables**, e informará sobre las vías de reclamación y de resolución
extrajudicial de litigios disponibles, conforme al Reglamento de Servicios Digitales. `[[Detalle
operativo y reportes de transparencia en el documento #16.]]`

---

# Parte IX. Propiedad intelectual

## 71. Propiedad de la Plataforma

71.1. La Plataforma y sus elementos (marcas, logotipos, software, bases de datos, diseño e interfaz) son
propiedad de Vibra o de sus licenciantes y están protegidos por la ley. No se te otorga derecho alguno
sobre ellos salvo la licencia de uso de la §15.

71.2. **Marca "Vibra" y logotipo.** No puedes usar nuestras marcas o logotipos sin autorización escrita.

## 72. Respeto a los derechos de terceros y notificaciones (DMCA)

72.1. Vibra atiende notificaciones de presunta infracción conforme a la
[Política de Propiedad Intelectual / DMCA](./12-propiedad-intelectual-dmca.md) (#12).

72.2. **Notificación y retirada.** Los titulares pueden notificar al **Agente Designado**
(`[[CORREO DMCA / AGENTE DESIGNADO]]`) con los elementos que exige la ley; Vibra podrá retirar o
inhabilitar el Contenido presuntamente infractor.

72.3. **Contranotificación.** El Usuario afectado puede presentar una contranotificación conforme al
procedimiento aplicable.

## 73. Infractores reincidentes

73.1. Vibra **cancela** las Cuentas de Usuarios que resulten **infractores reincidentes** de derechos de
propiedad intelectual, conforme a la ley aplicable.

## 74. Responsabilidad de plataformas de contenido (UE)

74.1. Para Usuarios y Contenido en el ámbito de la UE, aplican adicionalmente las obligaciones de la
Directiva de Derechos de Autor en el Mercado Único Digital (incluido su artículo 17), en los términos
que el documento #12 desarrolle.

## 75. Contenido creado con inteligencia artificial

75.1. Si publicas Contenido generado o modificado con herramientas de inteligencia artificial, eres
responsable de que no infrinja derechos de terceros ni suplante su identidad, y debes cumplir las Normas
de Comunidad sobre etiquetado cuando apliquen.

---

# Parte X. Privacidad, datos y comunicaciones

## 76. Protección de datos personales

76.1. El tratamiento de datos personales se rige por el
[Aviso de Privacidad](./03-aviso-privacidad-integral.md) (#3), conforme a la **Ley Federal de Protección
de Datos Personales en Posesión de los Particulares** y, según la ubicación del Usuario, a la normativa
aplicable (**GDPR** en la UE; **CCPA/CPRA** en California, entre otras).

76.2. **Datos sensibles y biométricos.** El KYC y la grabación de sesiones implican tratamiento de
**datos biométricos y sensibles**, sujeto a consentimiento específico conforme al
[Consentimiento Biométrico](./11-consentimiento-biometrico.md) (#11).

76.3. **Transferencias internacionales.** El uso de Servicios de Terceros puede implicar transferencias
de datos a otros países, con las garantías que exija la ley aplicable, según se detalla en el Aviso de
Privacidad.

## 77. Grabaciones y consentimiento

77.1. En los productos de **videollamada 1‑a‑1 grabada** (*Sesión exclusiva* y *Tiempo contigo*, §51) la
sesión **se graba** y, antes de iniciar, **ambas partes deben otorgar su consentimiento expreso** conforme
al
[Consentimiento de Grabación](./10-consentimiento-grabacion.md) (#10); la grabación se conservará y solo
podrán descargarla las partes autorizadas, en los plazos indicados, prohibiéndose difundirla sin el
consentimiento de las personas que aparecen en ella.

## 78. Cookies y tecnologías de rastreo

78.1. El uso de cookies y tecnologías similares se rige por la
[Política de Cookies](./05-politica-cookies.md) (#5). Donde la ley lo exija, se recaba consentimiento
previo para cookies no esenciales.

## 79. Comunicaciones electrónicas

79.1. Consientes recibir comunicaciones electrónicas de servicio, con la misma validez que las escritas.
Las de marketing requieren tu consentimiento y son revocables (§13).

---

# Parte XI. Terminación

## 80. Terminación por el Usuario

80.1. Puedes dejar de usar la Plataforma y **solicitar la baja** de tu Cuenta en cualquier momento.
Antes de la baja deben liquidarse las obligaciones devengadas y tratarse el Saldo conforme a los
[Términos de la Wallet](./08-terminos-wallet.md) (#8) y la [Política de Pagos](./09-pagos-comisiones-retiros.md) (#9).

## 81. Suspensión y terminación por Vibra

81.1. Podemos **suspender o terminar** tu acceso, total o parcialmente, ante incumplimiento de estos
Términos o las Normas de Comunidad; riesgos de seguridad o fraude; requerimientos legales; o conforme a
las facultades de moderación (§64). Cuando sea razonable, la medida se notificará conforme a la §68.

## 82. Efectos de la terminación y supervivencia

82.1. La terminación no afecta las disposiciones que por su naturaleza deban **subsistir**: Contenido y
licencias otorgadas, propiedad intelectual, pagos y obligaciones fiscales devengadas, moderación y
preservación, confidencialidad, responsabilidad, indemnización, ley aplicable y solución de
controversias.

---

# Parte XII. Responsabilidad y riesgos

## 83. Naturaleza de la relación

83.1. Nada en estos Términos crea entre Vibra y el Usuario una relación laboral, de sociedad, de agencia
o de empresa conjunta. Cada parte actúa por cuenta propia.

## 84. Descargos de garantías

84.1. En la máxima medida permitida por la ley, la Plataforma se proporciona **"tal cual" y "según
disponibilidad"**, sin garantías implícitas de comerciabilidad, idoneidad para un fin particular,
disponibilidad ininterrumpida o ausencia de errores.

84.2. Vibra no garantiza el Contenido ni los Servicios de los Creadores, ni el resultado de las
interacciones entre Usuarios, sin perjuicio de sus funciones de moderación.

84.3. **Derechos del consumidor.** Nada en esta Parte excluye o limita las garantías y derechos que la
legislación de consumo (LFPC en México y las normas imperativas de la UE y EEUU) reconozca de forma
irrenunciable a los Usuarios consumidores.

## 85. Limitación de responsabilidad

85.1. En la máxima medida permitida por la ley, Vibra no será responsable por daños indirectos,
incidentales, especiales, punitivos o consecuenciales, ni por pérdida de datos, ingresos o reputación,
derivados del uso o imposibilidad de uso de la Plataforma.

85.2. La responsabilidad total de Vibra por reclamaciones relacionadas con la Plataforma se limita
conforme al estándar que defina el abogado `[[monto/estándar a definir; no puede excluir la
responsabilidad que la ley no permita excluir, incluidos dolo o negligencia grave y los derechos del
consumidor]]`.

## 86. Indemnización

86.1. Te obligas a mantener en paz y a salvo a Vibra, sus afiliadas y su personal, frente a reclamaciones
de terceros derivadas de tu Contenido, de tu uso de la Plataforma o del incumplimiento de estos
Términos, en la medida en que la ley lo permita.

## 87. Fuerza mayor

87.1. Vibra no será responsable por incumplimientos derivados de causas fuera de su control razonable
(caso fortuito o fuerza mayor), incluyendo fallas de Servicios de Terceros, cortes de red, desastres,
actos de autoridad o conflictos.

## 88. Seguridad e informes de vulnerabilidades

88.1. Agradecemos los informes responsables de vulnerabilidades a `[[CORREO DE SEGURIDAD]]`. Está
prohibido explotar vulnerabilidades, acceder a datos ajenos o interrumpir el servicio.

---

# Parte XIII. Disposiciones legales

## 89. Ley aplicable

89.1. Estos Términos se rigen por las **leyes de los Estados Unidos Mexicanos**, sin perjuicio de las
normas imperativas de protección al consumidor y de datos aplicables por la ubicación del Usuario.

## 90. Jurisdicción y competencia

90.1. Para su interpretación y cumplimiento, las partes se someten a los **tribunales competentes de
`[[CIUDAD / ENTIDAD]]`**, renunciando a cualquier otro fuero, **salvo los derechos irrenunciables** que
la ley reconozca al Usuario consumidor.

## 91. Consumidores: PROFECO, UE y desistimiento

91.1. **México (PROFECO).** En materia de consumo, el Usuario puede acudir a la **Procuraduría Federal
del Consumidor**. `[[Ajustar según el registro del contrato de adhesión.]]`

91.2. **Unión Europea.** Los consumidores en la UE conservan sus derechos imperativos, incluido, cuando
aplique, el **derecho de desistimiento** de 14 días. Para **contenido digital de ejecución inmediata**,
dicho derecho **se pierde** cuando el Usuario consiente expresamente el inicio de la ejecución y
reconoce esa pérdida, consentimiento que se recaba en la compra. Existe además la plataforma europea de
resolución de litigios en línea.

91.3. **EEUU.** Aplican los derechos imperativos correspondientes, incluidas las reglas de cancelación
de suscripciones de renovación automática.

## 92. Resolución de controversias `[[decisión de producto]]`

92.1. `[[Si Vibra opta por arbitraje y/o renuncia a acciones colectivas para EEUU, el abogado debe
redactar aquí la cláusula, con sus excepciones y su opción de exclusión (opt‑out), y verificar su
compatibilidad con la LFPC para consumidores en México, donde suele ser inoponible.]]`

## 93. Cesión

93.1. No puedes ceder tus derechos u obligaciones sin autorización de Vibra. Vibra puede cederlos en el
marco de una reorganización, fusión o transmisión de negocio, sin merma de tus derechos.

## 94. Divisibilidad y no renuncia

94.1. Si alguna disposición se declara inválida, las demás continúan vigentes, y la afectada se
interpretará en el sentido válido más cercano a su intención. La falta de ejercicio de un derecho por
Vibra no constituye renuncia al mismo.

## 95. Acuerdo íntegro y encabezados

95.1. Estos Términos y los documentos de la §3 constituyen el **acuerdo íntegro** respecto de la
Plataforma y sustituyen acuerdos previos sobre la misma materia. Los encabezados son de referencia.

## 96. Contratación electrónica y conservación

96.1. Aceptas contratar por medios electrónicos. Las manifestaciones de voluntad realizadas a través de
la Plataforma (aceptaciones, consentimientos de compra, de grabación y de datos) tienen plena validez
conforme al Código de Comercio y la legislación aplicable. Vibra puede conservar registros de dichas
aceptaciones como prueba.

## 97. Accesibilidad

97.1. Vibra procura que la Plataforma sea accesible conforme a la [Política de Accesibilidad](./17-accesibilidad.md)
(#17) y agradece los reportes de barreras de accesibilidad.

## 98. Notificaciones y contacto

98.1. Contacto general/legal: `[[CORREO LEGAL]]`. Privacidad y derechos ARCO: `[[CORREO DE PRIVACIDAD]]`.
Propiedad intelectual: `[[CORREO DMCA / AGENTE DESIGNADO]]`. Soporte: `[[CORREO DE SOPORTE]]`.

98.2. **Representante en la UE (si aplica):** `[[REPRESENTANTE UE — nombre y datos de contacto,
conforme al GDPR/DSA.]]`

98.3. Las notificaciones de Vibra al Usuario se realizarán por los datos de contacto de su Cuenta o
mediante avisos en la Plataforma.

## 99. Datos del responsable

99.1. **Responsable:** `[[RAZÓN SOCIAL]]` · **RFC:** `[[RFC]]` · **Domicilio:** `[[DOMICILIO LEGAL]]` ·
**Contacto:** `[[CORREO LEGAL]]`.

## 100. Vigencia

100.1. Estos Términos permanecen vigentes mientras uses la Plataforma o mantengas una Cuenta, y en lo
conducente, tras su terminación, conforme a la §82.

---

### Anexo A — Comparativa de estructura con plataformas de referencia (nota de trabajo, no forma parte del contrato)

| Bloque de Vibra | Referencia estructural | Ajuste propio de Vibra |
|---|---|---|
| Parte II–III (cuenta, edad, KYC, conducta, licencia de uso) | YouTube, Facebook | Edad 18+, KYC vía procesadora, gestión de sesiones/dispositivos, verificación/insignias, tiendas de apps |
| Parte V–VI (creador, comisiones, Wallet, retiros, impuestos, AML) | Patreon, Twitch | Independencia del creador, sin garantía de ingresos, Wallet **no‑IFPE** por custodia en MP, régimen fiscal SAT, AML/sanciones, saldos no reclamados |
| Parte IV / IX (contenido, licencia, DMCA, art. 17 UE, reincidentes, IA) | YouTube, Facebook | Deepfakes/derechos de imagen, Agente Designado, contenido con IA |
| Parte VII (11 Servicios) | Patreon (membresías), Cameo (saludos), Twitch (supercomentarios/apoyos), OnlyFans (transacciones fan‑creador) | Catálogo real: publicación de pago, contenido grabado, suscripciones, saludos/consejos, sesiones 1‑a‑1 grabadas, entradas a live, súper comentarios, apoyos |
| Parte VIII (moderación / Superadmin) | — (redactado desde el sistema real: `moderation.ts`, `adminAuditLog`) | Acceso total con fin de moderación, **no divulgación, no interacción**, facultades taxativas, tolerancia cero menores, auditoría, apelación, DSA |
| Parte XIII (ley, PROFECO, UE, arbitraje, contratación electrónica) | — | México + derechos imperativos UE/EEUU; arbitraje opcional; validez de aceptaciones electrónicas |

### Anexo B — Pendientes de decisión / integración antes de publicar

1. **Datos de la entidad y contactos** (`[[placeholders]]`), representante UE y Agente Designado DMCA.
2. **Contenido adulto** (§17.3): decisión pendiente; si es "sí", integrar documento #18 y ajustar §17, §46, §58.
3. **Acciones "mutear" y "eliminar cuenta"** (§64 b, f): la política ya las contempla, pero `moderation.ts`
   hoy solo implementa `warn`, `remove_content`, `block_user` y `report_to_authorities`. Al construir la
   "sesión especial" de moderación deben añadirse esas acciones para que sistema y contrato coincidan.
4. **Arbitraje / renuncia a acción colectiva** (§92): decisión de producto para EEUU.
5. **Registro del contrato de adhesión ante PROFECO** (§2.3, §91.1).
6. **Suscripciones recurrentes y payouts/retiros**: al liberarse en producción (hoy parcialmente
   pendientes), confirmar que §45 y §49 reflejan el flujo final.
7. **Mecanismo de reporte de material de abuso infantil** por jurisdicción (§67).
8. **Validación integral por abogado** (MX + apoyo UE/EEUU).
