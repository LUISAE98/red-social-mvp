# Auditorías de seguridad — Vibra

Registro de las auditorías de seguridad por bloques y de lo que queda pendiente.

Última actualización: **2026-08-14** (bloques 1, 2, 3 y 4 cerrados)

---
## Pendientes

### 1. Separar el rol de supermoderador (H04 del Bloque 3)

**Estado:** aplazado por decisión de producto. Es el único trabajo de seguridad que queda abierto de los tres bloques.

Hoy una sola persona con el claim `role=moderator` puede moderar contenido, aprobar devoluciones de dinero, disparar reembolsos de Stripe y ejecutar healthchecks que manejan secretos. No hay separación entre moderador de contenido, soporte, finanzas y operador técnico.

Se decidió dejarlo así **mientras el equipo sea Luis y poca gente de confianza**. Cuando entre gente nueva a moderar contenido, conviene partirlo en al menos dos roles: uno que solo toca contenido y otro que puede tocar dinero.

**Qué haría falta:** un segundo claim (por ejemplo `role=finance`), cambiar `requirePlatformMod` en `backend/src/authz.ts` para distinguirlos, y reasignar los roles existentes. El guard ya está centralizado ahí, así que el cambio es acotado.

**Lo que ya reduce el riesgo mientras tanto:**

- El supermoderador **ya no puede leer toda la base de datos**. Ve contenido, reportes y solo las conversaciones privadas que alguien denunció. No ve datos fiscales, bancarios, wallets, sesiones ni claves de transmisión.
- Todas las funciones privilegiadas, incluidas las de dinero, exigen claim **más** sesión de Google.
- Dar o quitar el rol revoca los tokens al instante y queda registrado en `adminAuditLog`.

---

### 2. Exigir correo verificado para entrar

**Estado:** aplazado a propósito. **No hacer todavía.**

Corresponde al hallazgo **H02** del Bloque 2, excluido de la auditoría por decisión de producto: la verificación de correo al crear cuenta está desactivada para poder usar cuentas de prueba sin verificar cada una.

Hoy el registro **envía** el correo de verificación, pero la cuenta queda autenticada y entra a la plataforma sin comprobar nada. No existe ninguna comprobación de `emailVerified` ni en el cliente, ni en las Firestore Rules, ni en las Cloud Functions.

**Cuando se active, hay que decidir dónde se corta el paso**, porque no es solo una casilla:

- ¿Se bloquea el acceso entero, o solo las acciones sociales (publicar, comentar, crear comunidades)?
- ¿Qué pasa con las cuentas ya creadas sin verificar?
- Las cuentas de Google llegan con el correo ya verificado por el proveedor, así que solo afecta al registro por correo y contraseña.
- El sitio natural para exigirlo en el servidor es `notAnonymous()` o una función hermana en las reglas, más el guard de rutas en `RootChrome`.

Pendiente hasta que se decida el cambio, previsiblemente antes de producción.

---

### 3. Esquemas cerrados en las creaciones (M01 del Bloque 4) — RESUELTO

**Estado:** cerrado y desplegado el 2026-08-14. **Cero declaraciones sin esquema.**

Una regla que no fija **qué campos** admite el documento (`keys().hasOnly([...])`) deja escribir campos inventados, y quedan guardados. No abre acceso a nada por sí solo, pero engorda documentos y deja sitio a que un campo colado confunda a una regla futura.

El inventario redimensiona el hallazgo. De **64** declaraciones `allow create`:

- **36 están cerradas al cliente** (`allow create: if false`), fruto de las auditorías. No admiten nada, así que el esquema sobra.
- **28 fijan el esquema**, algunas a través de funciones auxiliares (`userCreateKeysAllowed` y compañía). Diecisiete se cerraron en esta pasada, en dos tandas:
  - **Acceso e identidad (7):** `groups`, `groups/{g}/members`, `groups/{g}/joinRequests`, `users/{u}/joinRequestsSent`, `users/{u}/groupMemberships`, `handles` y `users/{u}/sessions`.
  - **Contenido y telemetría (10):** `stories`, `liveChats/{l}/messages`, `editHistory` (×3, y el del post admite además `previousMedia`), `liveViewers`, `liveUniqueViewers`, `vodViewers`, `views` y `fcmTokens`.
- **0 sin esquema.**

⚠️ **En `create` y `update`, `request.resource.data` es el documento RESULTANTE, no lo que se manda.** Varias de estas colecciones se escriben con `set(..., {merge:true})`, así que el `hasOnly` tiene que cubrir la UNIÓN de todos los campos que puede acabar teniendo el documento, no los de una sola llamada. Es el caso de `liveUniqueViewers`, donde `registerUniqueViewer` pone `uid`/`isGuest` y `addWatchTime` añade `watchSeconds` después.

**Pruebas.** `test/rules/groupMembers.rules.test.ts` incluye los bloques `M01 — esquema cerrado en creaciones de acceso` y `M01 — esquema cerrado en contenido y telemetría`, que escriben el **payload exacto** del cliente (crear comunidad, alta del dueño, alta de miembro, reserva de handle, registro de sesión) y comprueba que pasa, más el mismo payload con un campo inventado y comprueba que no. Es cobertura imprescindible: el resto de la suite siembra con las reglas desactivadas, así que una lista de claves incompleta no la detectaría nadie y aparecería en producción como "no puedo crear comunidades".

⚠️ **Detalle que costó un falso positivo:** `description` en `groups` se valida como `is string` sin rama para null. El código real escribe `input.description.trim()`, así que sin descripción llega `""` y pasa; un fixture con `null` falla por un motivo que en producción no existe.

El script del inventario está en `scripts/` si hay que repetirlo: resuelve también los esquemas definidos en funciones auxiliares, no solo los `hasOnly` escritos dentro del propio `allow`.

---

### 4. Limpieza de archivos huérfanos en Storage (M06 del Bloque 4) — RESUELTO

**Estado:** cerrado y desplegado el 2026-08-14.

Al borrar una publicación no se borraban sus imágenes ni sus miniaturas de Storage. Seguían ahí, ocupando, facturando y —lo que importa— accesibles por su URL de token para quien la tuviera guardada.

`backend/src/postMediaCleanup.ts` barre imágenes, miniaturas, la portada del video y todo el prefijo `commentImages/{postId}/`. Dos disparadores: `onPostSoftDeletedCleanupMedia` para el camino normal y `onPostDeletedCleanupMedia` para las limpiezas administrativas con Admin SDK.

⚠️ **El disparador principal es la ACTUALIZACIÓN, no el borrado del documento.** Borrar un post es lógico (`isDeleted: true`) para no romper contadores ni hilos de comentarios; engancharse solo a `onDocumentDeleted` no habría limpiado nunca nada. Y solo actúa en la transición `false → true`, porque si no, cualquier actualización de un post ya borrado relanzaría el barrido.

**Fuera de alcance a propósito:** los videos de Mux, que viven en Mux con su propio ciclo de vida y su propia facturación. Retirarlos es otro trabajo.

Cobertura en `backend/test/postMediaCleanup.pure.test.ts`.

---

### 5. Lectura entre servicios de las reglas de Storage — RESUELTO

**Estado:** cerrado el 2026-08-14. Luis concedió el permiso en consola y las subidas a comunidades volvieron a funcionar. Se deja escrito porque la causa no es evidente y puede repetirse.

El gate de lectura que cerró **B4-C02** consulta Firestore desde `storage.rules` (`firestore.exists(/databases/(default)/documents/groups/$(groupId))`) para saber si la comunidad es privada u oculta. Esa consulta **entre servicios** no está funcionando: la evaluación lanza error y la regla deniega. El síntoma era `storage/unauthorized` al subir cualquier imagen o portada de video a un post de comunidad.

**Por qué se coló:** las reglas compilan y despliegan sin problema por CLI; el permiso que la consulta necesita se concede desde la consola de Firebase, que lo pide con un aviso al guardar reglas con llamadas entre servicios. Desplegando por CLI ese aviso nunca aparece. Además, el gate solo corre cuando alguien usa el SDK —el contenido público se sirve con URL de token, que no evalúa reglas—, así que estuvo desplegado sin ejercitarse desde el Bloque 4.

**Apaño desplegado:** en `storage.rules`, `allow read` de `posts/…` y `commentImages/…` empieza por `isOwnUpload(uid)`. Como `||` cortocircuita, quien sube lee su propio archivo sin tocar Firestore, que es lo que hace `getDownloadURL` justo después de subir. Publicar dejó de depender de la consulta rota. Leer el archivo **de otro** en una comunidad sigue pasando por ella y, mientras falle, se deniega — falla cerrado, que es lo correcto, y no afecta al producto porque el contenido público se sirve por token y el restringido lo firma `getRestrictedMediaUrls` con el Admin SDK.

**Cómo se resolvió:** concediendo el permiso al agente de servicio de reglas sobre Firestore desde la consola de Firebase (Storage → Reglas). El apaño de `isOwnUpload(uid)` se queda puesto igualmente: publicar no debe depender de una consulta entre servicios, aunque ahora funcione.

---

### 6. Tokens de descarga de las fotos ya publicadas en perfiles restringidos — CERRADO POR DECISIÓN

**Estado:** cerrado el 2026-08-14. **Decisión de Luis: no se hace el barrido de tokens; se borrarán todas las fotos viejas.**

Borrar la foto resuelve el problema de raíz y mejor que quitarle el token: sin archivo no hay nada que abrir. Y desde M06 (pendiente 4) esa limpieza es automática — al marcar un post como borrado, `onPostSoftDeletedCleanupMedia` se lleva sus archivos de Storage.

Queda registrado el motivo por si reaparece el mismo caso más adelante.

Desde el 2026-08-14 un perfil restringido protege sus medios, pero **solo lo que se sube a partir de ahí**. Lo publicado antes tiene su token de descarga ya creado, y un token abre el archivo sin sesión y para siempre: no lo revoca ningún cambio de reglas.

**Qué haría falta:** un barrido que recorra los medios de los posts de perfiles restringidos y borre el metadato `firebaseStorageDownloadTokens` de cada archivo. Es acotado, pero toca archivos en producción y no tiene vuelta atrás — borrado el token, la única vía es la URL firmada, que es justo lo que se quiere.

---

### 8. Exigir App Check en las Cloud Functions (C06 del Bloque 5)

**Estado:** en fase de OBSERVACIÓN, decidido por Luis el 2026-08-15. No hay nada que cambiar en el código todavía.

Hay 98 callables y **ninguna** declara `enforceAppCheck: true`. La app cliente ya está preparada para mandar el sello (`lib/appCheck.ts`), pero el backend no lo comprueba: cualquiera con un token de Firebase válido puede llamar a las funciones directamente desde un script, saltándose los límites que solo existen en la interfaz.

Se eligió observar antes de bloquear. Encender la exigencia a ciegas deja fuera a quien no mande el sello por cualquier motivo —una pestaña vieja, un móvil con caché, el flujo de compra sin cuenta— y eso se ve como "la app entera falla".

**Los pasos, en orden. Los tres primeros son de Luis, en consola:**

1. **Comprobar que la variable `NEXT_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY` está puesta en Vercel.** ⚠️ Es lo primero y es fácil de pasar por alto: si no está, el cliente **no manda ningún sello** y las métricas saldrán en 0 % verificado. Se concluiría que nadie manda sello cuando en realidad es que nunca se activó. No aparece en ningún `.env` del repositorio, así que solo se puede confirmar en Vercel.
2. Dejar correr unos días y mirar en la consola de Firebase → App Check → Cloud Functions el reparto entre peticiones **verificadas**, **sin verificar** y **caducadas**.
3. Decidir con esos números. Lo esperable si todo está bien es que casi todo llegue verificado.

4. **Solo entonces**, encender la exigencia en el backend.

⚠️ **Encender la exigencia obliga a redesplegar.** `enforceAppCheck` es una opción de despliegue de la función, no un interruptor en caliente. Si se quisiera poder apagarlo sin desplegar, habría que no usar esa opción y comprobar `request.app` a mano dentro de cada callable contra una bandera de configuración — más código y más sitios donde olvidarlo. Se decide cuando haya datos.

---

### 7. Cobertura de los criterios que se movieron a callables — RESUELTO para C03 y C05

**Estado:** cerrado el 2026-08-14.

Los criterios de **B4-C03** (no colarse en la comunidad de otro) y **B4-C05** (solo el dueño monetiza) ya no los aplican las reglas sino el callable `createPost`, y un test de reglas no puede ejercitarlos porque el Admin SDK no pasa por ellas. Al cerrar la puerta de `posts`, sus pruebas antiguas pasaron a verificar solo que está cerrada.

`backend/test-emulator/createPost.emulator.test.ts` los cubre disparando el callable con `firebase-functions-test` contra el emulador de Firestore — **sin emulador de Functions**: lo que se prueba es la lógica de autorización, no el transporte HTTPS. 12 pruebas: los dos criterios, el miembro baneado cuyo documento sigue existiendo, la cuenta de invitado, el archivo de Storage ajeno y que autor, contadores y estado no se pueden falsear desde el borrador.

Se lanza con `npm run test:emulator`, junto al resto de la suite del backend.

**Sigue abierto en general:** cada vez que un criterio sale de las reglas hacia un callable, sale también de la suite de reglas. Conviene acordarse al mover el siguiente.

---
## Bloque 5 — Backend privilegiado, APIs y servicios externos (EN CURSO)

### C05 — Sesiones pagadas sin poder entrar a la videollamada — RESUELTO

**Cerrado y desplegado el 2026-08-15.** Era el único hallazgo del bloque que estaba **roto en producción**, no en riesgo.

`getLivekitToken` solo aceptaba `paymentStatus === "simulated_paid"`, el estado del flujo simulado anterior a Stripe. El flujo real escribe `authorized` al retener y `paid` al capturar, así que una sesión pagada de verdad y bien agendada **no obtenía token**: comprador y creador se quedaban fuera con el dinero ya cobrado. Todos los demás sitios que miran el pago (`notifications.ts`, los triggers del ledger) aceptaban los dos valores desde siempre; este se quedó atrás.

⚠️ **`authorized` NO se acepta, a propósito.** El cobro se captura **al agendar**, y esa misma operación deja el estado en `paid`. Lo que sigue en `authorized` es una retención sin cita a la que entrar.

El comentario de `lib/experiences/useHasPurchasedExperiences.ts` afirmaba que los meet & greet son "siempre `simulated_paid`" — la misma suposición que causó el fallo. Corregido para que no lo repita nadie.

Cobertura en `backend/test-emulator/livekitTokens.emulator.test.ts` (5 pruebas).

### C01 + C02 — Esquema abierto en `createPost` y precio manipulable — RESUELTO

**Cerrado y desplegado el 2026-08-15.** Son un solo problema y por eso se arreglaron juntos.

**C01.** El documento se escribía como `{...draft, ...autoritativos}`: los campos que decide el servidor se pisaban, pero **cualquier otro del cliente sobrevivía tal cual**. Era el residuo que quedó documentado al hacer M04 del Bloque 4, y se subestimó. Ahora hay listas de campos permitidos, también para las estructuras anidadas (`premium`, `liveData`, `media`, `videoData`, `playback`, `processing`); lo que no esté se descarta antes de escribir.

**C02.** El precio vive por triplicado —`oneTimePrice`, `premium.price`, `liveData.ticketPrice`— y los cobros de Stripe leen los alternativos como respaldo (`oneTimePrice ?? premium.price`). Solo se validaba el primero, **y solo si venía presente**: omitirlo y poner el precio en cualquiera de los otros dos saltaba el tope entero, y el campo sin validar era justo el que acababa cobrándose.

Ahora se resuelve **un** precio efectivo, se valida ese, y se reescriben los tres iguales. Si llegan varios y no coinciden se rechaza, en vez de elegir uno: precios distintos significan enseñar uno y cobrar otro.

⚠️ **Se igualan en vez de quitar los campos alternativos a propósito.** `buildPremiumAccessFields` escribe `premium.price` y `oneTimePrice` desde la misma variable, así que en el código actual siempre coinciden; igualarlos hace inofensivo el respaldo sin tener que apostar a que no exista ningún dato antiguo raro.

**Dos cosas más que salieron al cerrarlo:**

- `visibilityMode` de un directo aceptaba cualquier cadena y lo desconocido caía en abierto por descarte. Ahora lo que no esté en la lista se trata como `members_only`, el modo más cerrado.
- `scheduledData` nace nulo. Ningún camino de creación lo rellena, pero `scheduledData.status` **sí se lee** para pintar un post como programado o en vivo, así que sembrarlo era una forma de aparentar un directo sin serlo.

Cobertura en `backend/test-emulator/createPost.emulator.test.ts` (20 pruebas en total).

### C03 — Un post cualquiera colaba como directo — RESUELTO

**Cerrado y desplegado el 2026-08-15.** Tres sitios comprobaban lo mismo de tres formas y dos estaban mal:

- donaciones y supercomentarios → `if (!post.liveData && post.postType !== "live")`, que solo rechaza cuando fallan **las dos**: pasaba un post normal con cualquier `liveData` colgando, y también un post marcado como live sin configuración;
- ticket de acceso → `if (post.liveData == null)`, que ni siquiera miraba el tipo.

Ahora hay un único guard, `payments/stripe/livePostGuard.ts`, que exige tipo `live` **y** configuración, y lo usan los tres. Mismo patrón que obligó a centralizar los guards de autorización en `authz.ts`: criterios duplicados que se separan con el tiempo.

### M03 — Webhooks perdidos en silencio — RESUELTO

**Cerrado y desplegado el 2026-08-15.**

`claimWebhookEvent` tenía un `catch` que trataba **cualquier** error como entrega duplicada. Si Firestore parpadeaba —indisponible, permisos, un fallo pasajero—, el webhook respondía "ya estaba hecho" y 200: el proveedor daba la entrega por buena y **no reintentaba**, así que ese evento se perdía para siempre. Un cobro sin acceso, una membresía sin activar, un video sin publicar, y en silencio.

Ahora solo `ALREADY_EXISTS` (código gRPC 6) cuenta como duplicado; lo demás se propaga. Verificado que en los cuatro webhooks (Stripe, Mux, Cloudflare, LiveKit) el reclamo se llama **fuera** de cualquier `try` que se lo trague, así que el error sube y el manejador devuelve 5xx para que el proveedor reintente. Como el reclamo es atómico, el reintento no duplica nada.

Cobertura en `backend/test-emulator/webhookEvents.emulator.test.ts` (4 pruebas).

### C04 — Objetos de pago duplicados en Stripe — RESUELTO

**Cerrado y desplegado el 2026-08-15.**

Ocho creaciones de cobro usaban `crypto.randomUUID()` como clave de idempotencia. Una clave aleatoria le dice a Stripe "esto es una operación nueva" **cada vez**, así que no deduplica nada. Y el flujo es leer estado → crear el objeto en Stripe → guardar su id: dos ejecuciones concurrentes de la misma compra —doble clic, dos pestañas, un reintento del cliente— creaban DOS PaymentIntents o DOS suscripciones, y la segunda sobrescribía el id guardado. El objeto huérfano se queda vivo y cobrable en Stripe sin que Vibra lo conozca. Que la materialización del acceso sea idempotente no arregla eso.

La convención correcta ya estaba en el repositorio (`capture_${externalReference}` en `holdCapture.ts`); los que CREAN los cobros no la seguían. Ahora todos usan `stripeIdempotencyKey()`.

⚠️ **La clave incluye los parámetros que pueden variar, no solo la referencia.** Stripe cachea la clave 24 h junto con sus params y devuelve `idempotency_error` si se reusa con otros distintos — y el importe cambia por motivos legítimos: aplicar saldo a favor, otro impuesto según el país de la tarjeta, otra moneda. Con el importe dentro de la clave, repetir la misma petición deduplica y una petición realmente distinta obtiene su propia clave.

El comentario de `groupSubscriptionStripe.ts` rechazaba la clave estable justo por ese motivo, y tenía razón con la versión simple: la objeción se resuelve incluyendo los params, no volviendo a lo aleatorio.

**Excepción a propósito:** `createStripePaymentIntent` mantiene la clave aleatoria. Es una herramienta de prueba de pasarela, solo para supermoderadores y topada a 500; cada llamada debe crear un cobro nuevo aunque repita importe.

**Residuo conocido:** sigue sin haber reserva transaccional antes de llamar a Stripe. La clave estable cubre el caso que hace daño —mismos datos, dos envíos—; dos peticiones concurrentes con importes distintos son operaciones genuinamente distintas.

Cobertura en `backend/test/idempotency.pure.test.ts` (6 pruebas).

### C07 — Subidas de video sin techo — RESUELTO (parcial, ver alcance)

**Cerrado y desplegado el 2026-08-15.** **Tope: 10 videos al día por persona** (decisión de Luis).

Las tres funciones que crean subidas en Mux aceptaban cualquier UID autenticado sin tope persistente. Una granja de cuentas —o una sola comprometida— podía generar subidas indefinidamente, y la factura del proveedor la paga Vibra. No hacía falta vulnerar Firestore ni saltarse ninguna regla: bastaba con llamar a la función.

`backend/src/quotas.ts` lleva un contador diario en `dailyQuotas/{uid}_{clave}`, en transacción. Lo usan `createMuxDirectUpload`, `createMuxDonationUpload` y `createMuxGroupDonationUpload`.

⚠️ **No es lo mismo que `rateLimiter.ts`.** Aquel limita la VELOCIDAD (un post cada 10 s, 20 por hora) y su ventana se vacía sola; este pone un TECHO al día que no se recupera hasta el día siguiente. **Un abuso lento y constante pasa por debajo del control de ritmo sin despeinarse**, que es justo el caso que importa cuando lo que se gasta es dinero de un proveedor.

Detalles que importan:

- El día se cuenta con el reloj de **Ciudad de México**, no UTC. Con UTC el contador se reiniciaría a las 18:00 hora local y quien agotara la cuota por la mañana la recuperaría el mismo día.
- La cuota se consume **después** de comprobar el permiso: a quien no puede publicar ahí no se le gasta el día por intentarlo.
- Va en transacción porque leer y sumar por separado deja pasar dos llamadas simultáneas. Hay una prueba que lanza 15 a la vez y comprueba que solo entran 10.

**Fuera de alcance a propósito:** `createGreetingMuxUpload`. Es la entrega de un saludo **ya pagado**; toparlo bloquearía a un creador con muchos pedidos y el abuso ahí está acotado por que cada uno exige un comprador que pagó.

**Sigue abierto del hallazgo original:** no hay cuota todavía en la creación de inputs de directo (Mux/Cloudflare), el render animado por Egress, el render FFmpeg ni las llamadas a Facturapi. El mecanismo ya está hecho y aplicarlo a cada uno es añadir una línea; falta decidir el número de cada cual.

Cobertura en `backend/test-emulator/quotas.emulator.test.ts` (4 pruebas).

---
## Bloques cerrados

### Bloque 1 — Superficie de ataque y fronteras de confianza

4 críticas, 6 altas, 4 medios y los bajos. Todo desplegado y verificado con peticiones reales contra producción.

- **C01** SSRF con `DELETE` arbitrario y sin autenticar en `whip-proxy`.
- **C02** Webhook de Cloudflare *fail-open*: omitir la cabecera de firma saltaba la autenticación.
- **C03** Cinco backfills `onRequest` sin autenticación que recorrían colecciones enteras con privilegios de administrador.
- **C04** SSRF almacenado vía `liveData.hlsUrl` en el proxy de espectadores.
- **H01** XSS de origen en `proxy-avatar` (copiaba el `content-type` remoto) + cabeceras de seguridad globales.
- **H02** Cualquier cuenta podía detener el egress de otra.
- **H03** Mutación anónima del estado de OBS.
- **H04** Analítica de compras manipulable sin sesión.
- **H05** Render caro (FFmpeg, egress) sin verificar propiedad del contenido.
- **H06** App Check — integrado y desplegado; Luis confirmó la configuración en consola el 2026-08-14.
- **Medios y bajos:** idempotencia de webhooks, rate limit del TTS, CSRF del logout, filtración de errores de proveedores, timeouts de salida, healthcheck.

### Bloque 2 — Identidad, autenticación, sesiones y cuentas

3 críticas, 6 de 7 altas, 4 de 5 medios y los bajos.

- **C01** Las cuentas anónimas (invitados de compra) podían participar socialmente.
- **C02** Acaparamiento ilimitado y permanente de nombres de usuario.
- **C03** "Revocar sesión" no revocaba nada, y se deshacía sola al reabrir la app.
- **H01** Correo, fecha de nacimiento y sexo eran de lectura pública. **Migrados** a `users/{uid}/private/identity`; los 11 perfiles existentes se migraron y se verificó que no quedó ningún campo personal en el documento público.
- **H02** Correo verificado — **excluido a propósito, ver pendiente 2**.
- **H03** El perfil aceptaba correo, proveedor y campos arbitrarios inventados.
- **H04** La edad mínima solo se comprobaba en el cliente.
- **H05** La caché de Firestore en IndexedDB sobrevivía al cierre de sesión.
- **H06** Bloquear una cuenta no revocaba sus tokens.
- **H07** Gestión de moderadores — cerrado. El segundo factor lo aplica Google sobre las cuentas de moderación; Vibra no puede exigirlo sin Identity Platform, y se aceptó así.
- **M05** Protección de rutas solo en cliente. **No se puede cerrar** sin un proyecto de sesión de servidor: el middleware corre en Edge, donde `firebase-admin` no funciona. Impacto bajo, las reglas y las funciones vuelven a autorizar.

**Pruebas:** `test/rules/anonymousContainment.rules.test.ts` cubre la contención de anónimos, el acaparamiento de handles, la revocación de sesiones, la falsificación de perfil, el gate de edad, el proveedor de los moderadores, la lectura acotada del supermoderador y las suscripciones vencidas. La suite completa de reglas está en **205 tests**.

### Bloque 3 — Autorización, roles y escalamiento de privilegios

3 críticas, 6 de 8 altas y 4 de 5 medios. Las dos altas restantes son decisiones tuyas, no hallazgos sin arreglar.

- **C01** Una regla comodín al final del archivo (`match /{document=**} { allow read: if isPlatformMod(); }`) **anulaba todas las restricciones de lectura**, porque en Firestore las reglas se combinan con OR. El supermoderador podía leer mensajes privados, datos fiscales y bancarios, wallets, sesiones, KYC y las **claves de transmisión** de cada directo. Ahora el acceso es explícito colección por colección, y de los mensajes privados solo ve **la conversación que alguien denunció** (`underReview`, marcado por `submitReport`).
- **C02** Un miembro baneado o expulsado seguía obteniendo URLs firmadas de las imágenes de comunidades privadas: la función solo comprobaba que su documento de miembro *existiera*, y al sancionar no se borra, se marca.
- **C03** Los documentos de suscripción tampoco se borran al terminar. Como la regla solo hacía `exists()`, quien pagó una vez podía **recrearse la membresía años después** y volver a entrar sin renovar.
- **H01** Desbanear devolvía el acceso completo aunque el ban hubiera cancelado la suscripción. **Decisión de Luis: tiene que volver a pagar.**
- **H02** Las invitaciones a moderador de comunidad no caducaban ni se revalidaban al aceptar: se podía invitar con la comunidad pública, volverla oculta y aceptar después. **Decisión de Luis: caducan a los 30 días**, y al aceptar se revalida visibilidad y estado.
- **H03** El reporte guardaba el "dueño del contenido" **que mandaba quien reporta**, y ese valor es el que usa el moderador al pulsar bloquear. Se podía señalar a un inocente. Ahora lo resuelve el servidor para los 11 tipos de reporte.
- **H04** Un solo rol lo hace todo — **ver pendiente 1**.
- **H05** Las funciones de dinero (capturar cobros, resolver devoluciones, healthchecks con secretos) exigían el claim pero **no la sesión de Google**. Unificado en `backend/src/authz.ts`.
- **H06** Dos backfills se autorizaban con un correo escrito en el código, sin claim ni proveedor. Incluida la migración de PII del Bloque 2, que se había escrito con ese mismo patrón.
- **H07** El vencimiento de suscripciones depende de una tarea diaria, así que hay hasta 24 h de margen. **Decisión de Luis: se acepta.**
- **H08** Las imágenes de mensajes privados se firmaban validando solo el prefijo de la ruta, así que **se podían renovar después de borrar el mensaje**.
- **M01/M02** La moderación de comunidades no dejaba historial: la huella vivía en el documento de miembro y cada acción sobrescribía la anterior. Nueva colección `groupModerationLog`, inmutable, legible por el dueño de la comunidad y el supermoderador. Importa porque banear cancela suscripciones de Stripe.
- **M03** Un moderador silenciado era rechazado por las reglas pero aceptado por las callables.
- **M04** `getMuxPlaybackToken` solo reconocía `role === "moderator"`, pero las promociones escriben `roleInGroup: "mod"`: se negaba el acceso a moderadores legítimos.
- **M05** Cualquier moderador podía resolver un reporte que otro estaba atendiendo. Ahora se toma en transacción al resolver.

### Bloque 4 — Datos, integridad y escrituras del cliente

5 críticas, las altas y 4 de 6 medios. Los dos medios abiertos son los pendientes 3 y 4.

- **C01** Los contadores de comentarios y respuestas los escribía el cliente en una escritura **aparte** del comentario, así que las reglas no podían atarlos: se podía inflar `counts.comments` sin comentar nada. Movidos a triggers (`backend/src/commentCounters.ts`).
- **C02** Las imágenes de publicaciones y de comentarios de comunidades restringidas eran legibles por cualquiera que tuviera la ruta. Cerrado en `storage.rules` con `isRestrictedGroup()`.
- **C03** Un post de perfil podía traer además el `groupId` de otra comunidad y aparecer dentro de ella. Perfil y comunidad son ahora mutuamente excluyentes.
- **C04** Empezar una transmisión escribía `activeLivePostId` en la comunidad **sin comprobar** que quien transmite pueda hacerlo ahí (`canBroadcastToGroup`).
- **C05** Cualquier miembro podía publicar contenido de pago en la comunidad de otro y cobrarlo. Ahora solo el dueño.
- **M04** Crear publicaciones era una escritura directa del cliente, y el límite de publicaciones vivía en una llamada **aparte**: eran dos pasos independientes y bastaba con no dar el primero. Una regla no puede exigir que antes ocurriera otra cosa. Ahora todo va por el callable `createPost` (`backend/src/createPost.ts`), donde el contador y la escritura son la **misma transacción**. De paso, autor, contexto, visibilidad, `isShareable`, índice de búsqueda, fijado y fechas los decide el servidor. Los cinco puntos de creación del cliente (texto, imagen, medios, video, directo) pasan por ahí. `posts` quedó en `create: if false`, desplegado el 2026-08-14 **después** del frontend: cerrarlo antes deja sin publicar a quien siga con el sitio viejo, y ese orden hay que respetarlo en cualquier cierre parecido.
- **M05** La creación de comunidades hacía tres escrituras sueltas; si fallaba la segunda quedaba una comunidad sin dueño. Unificadas en un `writeBatch`.

**Fotos de un perfil restringido (decisión de Luis, 2026-08-14).** Un perfil con `profileRestricted: true` ya protege sus medios igual que una comunidad privada. La protección estaba atada solo a la visibilidad de la **comunidad**, así que las fotos de un perfil cerrado se servían con URL de token, o sea públicas para cualquiera con el enlace. El criterio es el mismo que ya aplicaba `canReadProfileContent` a los posts: **solo el dueño**, sin excepción para seguidores — las fotos no pueden ser más abiertas que el post que las lleva. Cerrado en las tres capas: al subir no se pide URL de descarga (`lib/posts/image-upload.ts`), `storage.rules` deniega la lectura ajena, y `getRestrictedMediaUrls` comprueba el perfil antes de firmar. La restricción se lee del perfil y no de la copia `profileRestricted` del post, que no se actualiza si el perfil se cierra después de publicar. Incluye las imágenes de comentarios, que tenían el mismo hueco.

**Historias en comunidad ajena (2026-08-14).** Crear una historia exigía autor, tipo y un `greetingRequestId` no vacío, pero **no comprobaba el `groupId`**. Como la lectura y los carruseles se resuelven por ese campo, cualquiera podía crear una historia con el id de una comunidad a la que no pertenece y aparecer dentro. Mismo patrón que C03 con las publicaciones. Ahora se exige pertenencia a la comunidad declarada.

⚠️ **Lo que NO era:** al principio se diagnosticó como que el `groupId` debía atarse al de la solicitud de saludo de la que nace la historia. Es falso, y atarlo así habría roto dos flujos legítimos: el `groupId` sale de **dónde se publica** (perfil o comunidad), no de dónde salió el saludo, y el **comprador** también puede publicar la historia como suya (`StoryCoverPicker`). Se comprueba pertenencia, no procedencia.

**Residuo aceptado en M04:** `groupCategory` y `groupTags` se siguen aceptando del cliente, solo saneados. Son copias de metadatos públicos de la comunidad que solo alimentan el ranking de recomendaciones; falsearlos mal-clasifica el propio post y no toca acceso, dinero ni exposición. Validarlos en el servidor obligaría a duplicar allí la tabla de categorías canónicas de `types/group.ts`.

**Hueco de cobertura conocido:** los criterios de C03 y C05 ya no los aplican las reglas sino el callable, y un test de reglas no puede ejercitarlos porque el Admin SDK no pasa por ellas. Sus pruebas antiguas se sustituyeron por otras que solo verifican que la puerta está cerrada. Cubrirlos pide un test de integración contra el emulador de Functions, que hoy no existe.

**Código compartido:** `shared/posts/` guarda la lógica pura que usan los dos lados (índice de búsqueda, metadatos de compartir). `scripts/sync-shared.js` la copia a `backend/src/shared/` en cada build, porque el backend tiene `rootDir: "src"` y no puede importar de fuera. El destino está en `.gitignore` y se regenera siempre, así que no puede divergir.

---

## Trabajo relacionado del mismo tramo

- **Node.js 20 → 22** en las 165 Cloud Functions. Node 20 se decomisaba el 2026-10-30. Revisar de nuevo hacia 2027.
- **Cuatro funciones fantasma retiradas** de producción: `diditWebhook` (HTTP público), `createKycSession`, `createStripeCheckoutSession` y `migrateCurrencyMxnToUsd`. Vivían desplegadas sin código en el repositorio, así que ninguna auditoría de código las vio. **Borrar el código no borra la función desplegada.**
- **Política de contraseñas** en Firebase Auth (10 caracteres, mayúscula, minúscula, número y símbolo) en modo *Exigir*. `lib/auth/passwordPolicy.ts` es su espejo exacto: si se cambia una, hay que cambiar la otra.
- **Protección de enumeración de correo** activada en Firebase Auth.
