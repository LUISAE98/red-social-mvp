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

### 3. Esquemas cerrados en las creaciones (M01 del Bloque 4)

**Estado:** aplazado. Necesita inventario antes que código.

De las 61 declaraciones `allow create` de `firestore.rules`, muchas no fijan **qué campos** puede traer el documento (`keys().hasOnly([...])`). Se puede escribir un campo inventado y quedará guardado. No abre acceso a nada por sí solo, pero engorda documentos y deja sitio a que un campo colado confunda a una regla futura.

**Qué haría falta:** listar las 61, separar las que ya están acotadas de las que no, y cerrar primero las que tocan dinero o acceso. Hacerlo a ciegas rompe escrituras legítimas, porque el esquema real de varias colecciones no está escrito en ningún sitio salvo el código que las escribe.

---

### 4. Limpieza de archivos huérfanos en Storage (M06 del Bloque 4)

**Estado:** aplazado. Es coste y operación, no seguridad.

Al borrar una publicación no se borran sus imágenes ni sus miniaturas de Storage. Siguen ahí, ocupando y facturando. No son accesibles por la app, pero los archivos con token de descarga siguen sirviéndose por URL directa.

**Qué haría falta:** un trigger `onDocumentDeleted` sobre `posts` que barra el prefijo del post. Ojo con el borrado suave: hoy borrar un post lo marca, no lo elimina, así que el disparador correcto es el barrido de los marcados, no el borrado del documento.

---

### 5. Habilitar la lectura entre servicios de las reglas de Storage

**Estado:** bloqueado, lo tienes que hacer tú en consola. **Hay un apaño desplegado que sostiene el producto mientras tanto.**

El gate de lectura que cerró **B4-C02** consulta Firestore desde `storage.rules` (`firestore.exists(/databases/(default)/documents/groups/$(groupId))`) para saber si la comunidad es privada u oculta. Esa consulta **entre servicios** no está funcionando: la evaluación lanza error y la regla deniega. El síntoma era `storage/unauthorized` al subir cualquier imagen o portada de video a un post de comunidad.

**Por qué se coló:** las reglas compilan y despliegan sin problema por CLI; el permiso que la consulta necesita se concede desde la consola de Firebase, que lo pide con un aviso al guardar reglas con llamadas entre servicios. Desplegando por CLI ese aviso nunca aparece. Además, el gate solo corre cuando alguien usa el SDK —el contenido público se sirve con URL de token, que no evalúa reglas—, así que estuvo desplegado sin ejercitarse desde el Bloque 4.

**Apaño desplegado:** en `storage.rules`, `allow read` de `posts/…` y `commentImages/…` empieza por `isOwnUpload(uid)`. Como `||` cortocircuita, quien sube lee su propio archivo sin tocar Firestore, que es lo que hace `getDownloadURL` justo después de subir. Publicar dejó de depender de la consulta rota. Leer el archivo **de otro** en una comunidad sigue pasando por ella y, mientras falle, se deniega — falla cerrado, que es lo correcto, y no afecta al producto porque el contenido público se sirve por token y el restringido lo firma `getRestrictedMediaUrls` con el Admin SDK.

**Qué falta:** conceder el permiso al agente de servicio de reglas sobre Firestore. Consola de Firebase → Storage → Reglas; al guardar debería aparecer el aviso para habilitarlo. Si no aparece, hay que darlo a mano en IAM y conviene mirar juntos cuál es la cuenta exacta antes de tocar nada.

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

**Residuo aceptado en M04:** `groupCategory` y `groupTags` se siguen aceptando del cliente, solo saneados. Son copias de metadatos públicos de la comunidad que solo alimentan el ranking de recomendaciones; falsearlos mal-clasifica el propio post y no toca acceso, dinero ni exposición. Validarlos en el servidor obligaría a duplicar allí la tabla de categorías canónicas de `types/group.ts`.

**Hueco de cobertura conocido:** los criterios de C03 y C05 ya no los aplican las reglas sino el callable, y un test de reglas no puede ejercitarlos porque el Admin SDK no pasa por ellas. Sus pruebas antiguas se sustituyeron por otras que solo verifican que la puerta está cerrada. Cubrirlos pide un test de integración contra el emulador de Functions, que hoy no existe.

**Código compartido:** `shared/posts/` guarda la lógica pura que usan los dos lados (índice de búsqueda, metadatos de compartir). `scripts/sync-shared.js` la copia a `backend/src/shared/` en cada build, porque el backend tiene `rootDir: "src"` y no puede importar de fuera. El destino está en `.gitignore` y se regenera siempre, así que no puede divergir.

---

## Trabajo relacionado del mismo tramo

- **Node.js 20 → 22** en las 165 Cloud Functions. Node 20 se decomisaba el 2026-10-30. Revisar de nuevo hacia 2027.
- **Cuatro funciones fantasma retiradas** de producción: `diditWebhook` (HTTP público), `createKycSession`, `createStripeCheckoutSession` y `migrateCurrencyMxnToUsd`. Vivían desplegadas sin código en el repositorio, así que ninguna auditoría de código las vio. **Borrar el código no borra la función desplegada.**
- **Política de contraseñas** en Firebase Auth (10 caracteres, mayúscula, minúscula, número y símbolo) en modo *Exigir*. `lib/auth/passwordPolicy.ts` es su espejo exacto: si se cambia una, hay que cambiar la otra.
- **Protección de enumeración de correo** activada en Firebase Auth.
