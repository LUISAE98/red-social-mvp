# Auditorías de seguridad — Vibra

Registro de las auditorías de seguridad por bloques y de lo que queda pendiente.

Última actualización: **2026-08-15** (bloques 1 a 5 cerrados; el 6 parcial a propósito, ver pendiente 9)

---

## Mapa maestro de auditoría — 18 bloques

Esta es la división oficial de la auditoría técnica y de seguridad de Vibra. Los
"bloques" mencionados en documentos fiscales, legales o de implementación interna
no sustituyen esta numeración. Al terminar los 18 bloques se repetirá la auditoría
completa desde el Bloque 1 para comprobar correcciones, regresiones y pendientes.

1. **Superficie de ataque y fronteras de confianza.** Inventario de aplicaciones,
   rutas públicas/protegidas, Firebase, servicios, secretos, entradas externas y
   límites entre cliente, backend y proveedores.
2. **Identidad, autenticación, sesiones y cuentas.** Registro, login, proveedores,
   correo verificado, sesiones, tokens, cuentas anónimas, recuperación, bloqueo,
   suspensión y eliminación de cuentas.
3. **Autorización, roles y escalamiento de privilegios.** Claims, owner, moderadores,
   administradores, separación de funciones, operaciones privilegiadas y prevención
   de escalamiento horizontal o vertical.
4. **Datos, integridad y escrituras del cliente.** Firestore Rules, esquemas,
   validaciones, campos autoritativos, transacciones, concurrencia, datos
   desnormalizados y escrituras directas desde clientes.
5. **Backend privilegiado, Cloud Functions, APIs y servicios externos.** Callables,
   endpoints HTTP, webhooks, Admin SDK, App Check, rate limits, cuotas, idempotencia,
   timeouts y confianza en Mux, Cloudflare, LiveKit, Stripe, Facturapi y otros.
6. **Pagos, wallet, ledger, impuestos, reembolsos y facturación.** Stripe, intents,
   suscripciones, conciliación, crédito del comprador, cash-out, ingresos del
   creador, Connect/payouts, divisas, impuestos, CFDI y Facturapi.
7. **Comunidades, membresías y control de acceso.** Comunidades públicas, privadas y
   ocultas; invitaciones, solicitudes, membresías, suscripciones, roles internos,
   expulsiones, baneos, eliminación y prevención de fugas de contenido o miembros.
8. **Publicaciones, comentarios, historias, feeds y visibilidad.** Creación y ciclo de
   vida del contenido, audiencias, perfiles restringidos, premium, borrados,
   bloqueos, recomendaciones y propagación correcta de la visibilidad.
9. **Mensajes directos, chat y privacidad en tiempo real.** Creación de
   conversaciones, participantes, lectura/escritura, adjuntos, mensajes reportados,
   bloqueos, presencia, notificaciones y prevención de acceso a DM ajenos.
10. **Storage, medios, video, streaming y videollamadas.** Reglas de Storage, tokens y
    URLs firmadas, imágenes, audio, Mux, Cloudflare Stream, R2, lives, grabaciones,
    LiveKit, uploads, procesamiento, eliminación y control de costos.
11. **Servicios y experiencias pagadas del creador.** Saludos, consejos, sesiones,
    Tiempo contigo, meet & greet, donaciones y supercomentarios; disponibilidad,
    compra, aceptación, entrega, expiración, rechazo, reprogramación y disputas.
12. **Moderación, reportes, abuso y seguridad de usuarios.** Reportes, evidencias,
    sanciones, bloqueos, apelaciones, anti-spam, fraude, suplantación, contenido
    ilegal, auditoría de moderadores y resistencia a abuso coordinado.
13. **Notificaciones, búsqueda, descubrimiento y compartición.** Push/FCM,
    notificaciones internas, índices, búsqueda, sugerencias, enlaces compartidos,
    metadatos y prevención de filtraciones por sistemas secundarios.
14. **Frontend, estado, navegación y seguridad del cliente.** Manejo de estado,
    guards de rutas, cachés, hidratación, errores, i18n, moneda, PWA, responsive,
    accesibilidad y supuestos de seguridad que sólo existan en la interfaz.
15. **Privacidad, PII, retención, exportación y eliminación de datos.** Datos
    personales, fiscales y financieros; minimización, consentimiento, descargas,
    borrado de cuenta, retención, logs, archivos huérfanos y cumplimiento legal.
16. **Infraestructura, configuración y operación de producción.** Proyectos y
    ambientes, IAM, secretos, dominios, CORS, headers, Firebase/Vercel, despliegues,
    índices, backups, observabilidad, alertas, costos y recuperación ante desastres.
17. **Dependencias, cadena de suministro, scripts, tests y CI/CD.** Dependencias y
    vulnerabilidades, lockfiles, scripts, lint, typecheck, builds, emuladores,
    cobertura, pipelines, permisos de automatización y artefactos de entrega.
18. **Auditoría integral de producción y resiliencia extremo a extremo.** Recorrido de
    flujos reales, conciliación entre sistemas, fallos parciales, reintentos,
    degradación, incident response, runbooks, checklist de lanzamiento y
    reevaluación final de riesgos antes de producción.

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

### 7. Cobertura de los criterios que se movieron a callables — RESUELTO para C03 y C05

**Estado:** cerrado el 2026-08-14.

Los criterios de **B4-C03** (no colarse en la comunidad de otro) y **B4-C05** (solo el dueño monetiza) ya no los aplican las reglas sino el callable `createPost`, y un test de reglas no puede ejercitarlos porque el Admin SDK no pasa por ellas. Al cerrar la puerta de `posts`, sus pruebas antiguas pasaron a verificar solo que está cerrada.

`backend/test-emulator/createPost.emulator.test.ts` los cubre disparando el callable con `firebase-functions-test` contra el emulador de Firestore — **sin emulador de Functions**: lo que se prueba es la lógica de autorización, no el transporte HTTPS. 12 pruebas: los dos criterios, el miembro baneado cuyo documento sigue existiendo, la cuenta de invitado, el archivo de Storage ajeno y que autor, contadores y estado no se pueden falsear desde el borrador.

Se lanza con `npm run test:emulator`, junto al resto de la suite del backend.

**Sigue abierto en general:** cada vez que un criterio sale de las reglas hacia un callable, sale también de la suite de reglas. Conviene acordarse al mover el siguiente.


---

### 8. Exigir App Check en las Cloud Functions (C06 del Bloque 5)

**Estado:** en fase de OBSERVACIÓN, decidido por Luis el 2026-08-15. No hay nada que cambiar en el código todavía.

Hay 98 callables y **ninguna** declara `enforceAppCheck: true`. La app cliente ya está preparada para mandar el sello (`lib/appCheck.ts`), pero el backend no lo comprueba: cualquiera con un token de Firebase válido puede llamar a las funciones directamente desde un script, saltándose los límites que solo existen en la interfaz.

Se eligió observar antes de bloquear. Encender la exigencia a ciegas deja fuera a quien no mande el sello por cualquier motivo —una pestaña vieja, un móvil con caché, el flujo de compra sin cuenta— y eso se ve como "la app entera falla".

**Los pasos, en orden. Los tres primeros son de Luis, en consola:**

1. ~~Comprobar que la variable `NEXT_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY` está puesta en Vercel.~~ **Confirmado por Luis el 2026-08-15.**
2. **← AQUÍ ESTAMOS.** Dejar correr unos días y mirar en la consola de Firebase → App Check → Cloud Functions el reparto entre peticiones **verificadas**, **sin verificar** y **caducadas**.
3. Decidir con esos números. Lo esperable si todo está bien es que casi todo llegue verificado.

4. **Solo entonces**, encender la exigencia en el backend.

⚠️ **Encender la exigencia obliga a redesplegar.** `enforceAppCheck` es una opción de despliegue de la función, no un interruptor en caliente. Si se quisiera poder apagarlo sin desplegar, habría que no usar esa opción y comprobar `request.app` a mano dentro de cada callable contra una bandera de configuración — más código y más sitios donde olvidarlo. Se decide cuando haya datos.

---

### 9. BLOQUEADO POR LA LLC — todo lo que necesita Stripe USA

**Estado:** aplazado a propósito, no es deuda ni descuido. **Decisión de Luis (2026-08-15):** Vibra migra de Stripe México a Stripe USA y está esperando la LLC para abrir la cuenta. Hacer ahora este trabajo sobre el modelo mexicano es trabajo que se tira: cambia el emisor, el país fiscal, la moneda de liquidación, el régimen de retenciones y el comprobante que hay que emitir.

Lo que sí se pudo hacer sin la cuenta nueva —lógica, concurrencia, revocación de accesos, idempotencia— **ya está hecho y desplegado**. Lo de abajo es lo que de verdad depende de la cuenta.

#### Del Bloque 6 — Pagos, wallet, reembolsos y facturación

**A. Cobro al creador (Stripe Connect y payouts). No existe nada todavía.**

`backend/src/payments/stripe/stripeConnect.ts` solo define tipos y funciones puras; el propio archivo dice que aún no llama a Stripe. Falta entero: crear cuentas conectadas, los Account Links de alta, el webhook `account.updated`, transferencias, payouts, conciliar transferencias y payouts fallidos, actualizar `withdrawnGross`/`withdrawnNet` y el bloqueo fiscal previo al pago.

**Consecuencia hoy:** la wallet calcula lo que gana el creador, pero **no hay forma de sacarlo**. No es un agujero de seguridad, es una pieza sin construir.

⚠️ **Mínimo de retiro: 400 USD** (regla de Luis). Va aquí, en el retiro del CREADOR — **no** en `cashout.ts`, que es otra cosa: la devolución a un COMPRADOR del saldo que le quedó de una compra rechazada. Ponerlo ahí impediría a alguien recuperar sus propios 300 pesos hasta juntar 400 dólares. **Falta que Luis lo confirme.**

**B. H04 — Reembolsos parciales dejan la wallet inflada.**

Un reembolso parcial solo se registra; el asiento del ledger se revierte entero o nada. El creador sigue viendo un ingreso del que parte ya salió de Stripe.

**Por qué espera:** arreglarlo bien exige reversas proporcionales, que es un cambio en el modelo de datos del ledger —área sensible—. Y el daño está contenido: **sin payouts, una wallet inflada no puede convertirse en dinero que se vaya**. Hoy es un número mal mostrado. Conviene hacerlo junto con los payouts, con el modelo nuevo, en vez de dos veces.

**C. H02 — Procedencia del crédito en pagos mixtos.**

`buildOrigins` usa `chargedAmount` como techo reembolsable, pero cuando una compra se pagó en parte con saldo, el cobro de Stripe solo tiene el resto de tarjeta: el cash-out puede intentar devolver más de lo que ese cargo tiene. Falta además contabilidad por lotes de crédito. Atado al modelo de cobro que cambia.

**D. H07 — Las suscripciones congelan país, impuesto, precio y dueño.**

La metadata fiscal se fija al crear la suscripción y se reutiliza en cada renovación: un cambio de residencia no actualiza impuestos, una tasa nueva no afecta a las existentes, y la renovación usa el `ownerId` de entonces. Además `computeMonthlyCharge` no aplica el mismo 2 % de FX que `composeCharge`. **Todo esto lo redefine el modelo fiscal de EE. UU.**

**E. Facturación mexicana completa (H09, H10 y el resto de C05).**

- **H09** — el CFDI aplica 16 % fijo, reconstruye la base como total/1.16, fija la forma de pago a tarjeta de crédito, no distingue débito ni saldo ni pago mixto, y el respaldo trata `grossAmount`/`taxAmount` como USD aunque el ledger opere en MXN.
- **H10** — cambiar de RFC, razón social, régimen o código postal conserva el `csdStatus: ready` del certificado anterior.
- **C05 (resto)** — la duplicación por ids repetidos y el tope ya se cerraron; **falta la carrera** entre dos llamadas simultáneas, que pueden timbrar dos CFDI de la misma compra. Necesita reserva transaccional y clave idempotente contra Facturapi.
- **Sin empezar:** CFDI del creador hacia Vibra, autofacturación, retenciones de ISR e IVA, notas de crédito y cancelaciones, comprobante para extranjeros, factura global mensual y conciliación Facturapi ↔ Firestore.

⚠️ **Todo lo emitido hoy es de PRUEBA.** Las callables usan `FACTURAPI_TEST_KEY`; no hay evidencia fiscal productiva. El paso a llave real es parte de este mismo tramo. Ver [[project_facturapi_cutover]] — el RFC solo valida con llave LIVE.

#### De los Bloques 1 al 5

**Nada.** Ningún pendiente de esos bloques depende de Stripe. Los que siguen abiertos son los pendientes 1, 2 y 8 de este documento, y ninguno tiene que ver con pagos.

#### Qué hacer cuando llegue la LLC

En este orden, porque cada uno depende del anterior:

1. Abrir Stripe USA y decidir el modelo fiscal nuevo (emisor, país, moneda de liquidación, retenciones).
2. Connect y payouts, con el mínimo de 400 USD y el bloqueo fiscal previo.
3. H04 y H02 con el modelo nuevo, ya con payouts existiendo.
4. H07: recalcular impuestos en cada renovación en vez de congelarlos.
5. Facturación: lo que aplique al nuevo régimen, y la llave LIVE.

---

## Bloque 5 — Backend privilegiado, APIs y servicios externos (CERRADO)

Todos los altos y medios cerrados y desplegados. Lo único abierto es **App Check**, que está en fase de observación (pendiente 8), y **M07**, resuelto con la opción B más abajo.

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

**Completado el 2026-08-15** con los cinco topes restantes que decidió Luis, todos por persona y por día:

| Recurso | Tope | Dónde |
|---|---|---|
| Arrancar una transmisión (Mux y Cloudflare) | 10 | `liveMux.ts`, `liveCF.ts` |
| Render animado de un saludo (Egress) | 20 | `greetingRender.ts` |
| Render con marco (FFmpeg) | 20 | `videoOverlay.ts` |
| Intentos de pago | 30 | `getOrCreateStripeCustomer` |
| Facturas emitidas | 10 | `generateBuyerInvoice.ts` |

⚠️ **El de intentos de pago va holgado a propósito.** Una tarjeta rechazada hace que el comprador reintente varias veces y esos son intentos legítimos: ponerlo bajo no frena a un abusador, pierde ventas de gente que sí quería pagar.

Los dos que son `onRequest` en vez de `onCall` (los dos renders) traducen el tope a un **429** con el mismo texto que las demás cuotas.

Todos los topes se consumen **después** de comprobar el permiso, para no gastarle el día a quien ni siquiera podía hacer la acción.

Cobertura en `backend/test-emulator/quotas.emulator.test.ts` (4 pruebas).

### M02 — Método de pago ajeno para decidir el impuesto — RESUELTO

**Cerrado y desplegado el 2026-08-15.**

`/payment_methods/{id}` devuelve **cualquier** método visible para la cuenta de Stripe de Vibra, no solo los del comprador. Ni `repriceForCard` ni `cardCountry` comprobaban el dueño, así que se podía pasar el `pm_...` de otra persona para que el país fiscal —y con él el impuesto— saliera del de OTRA tarjeta, y confirmar el pago con una distinta.

Ahora se contrasta el `customer` del método contra el del comprador (`stripeCustomers/{uid}.customerId`, vía `getExistingStripeCustomerId`).

⚠️ **Una tarjeta recién tecleada NO está adjunta a ningún cliente** (`customer: null`), y ese es el caso normal al pagar con tarjeta nueva. Exigir que coincida siempre habría roto todos los pagos con tarjeta nueva. Se acepta la no adjunta —para conocer su id hay que haberla creado uno mismo en el navegador— y se rechaza la adjunta a otro cliente.

El hallazgo señalaba solo `repriceForCard`, pero `cardCountry.ts` tenía el mismo agujero y lo usan **todos** los cobros. Ahí no se lanza excepción sino que se ignora la tarjeta y el país cae a la IP: ese módulo tiene el contrato de no tumbar nunca un cobro. La vía de tarjeta guardada ya validaba el dueño contra Firestore.

### M04 — Clientes de Stripe y Facturapi sin tope de espera — RESUELTO

**Cerrado y desplegado el 2026-08-15.** 20 s en ambos. Sin `AbortSignal`, una conexión lenta retiene la instancia hasta el timeout global de la Cloud Function —minutos—: se paga ese tiempo, se ocupa concurrencia y el cliente se queda colgado. Las rutas proxy de Next ya lo hacían; los clientes centrales, no.

### M01 — TTS sin tope cuando falla el contador — MITIGADO

**Desplegado el 2026-08-15 (va con el frontend).**

El endpoint es público por diseño: lo consumen espectadores y el Browser Source de OBS con `new Audio(url)`, que no manda cabeceras. El `catch` del contador dejaba pasar la petición a propósito para no cortar el audio de un directo en marcha — pero eso significaba que **mientras Firestore estuviera caído el endpoint quedaba sin ningún tope**, siendo público.

Ahora hay un respaldo en memoria del proceso (600/hora por clave). No sustituye al de Firestore: no se comparte entre instancias y se pierde al reciclarse. Solo evita que "falla el contador" equivalga a "barra libre".

**Sin resolver del hallazgo:** la clave sigue saliendo del primer valor de `x-forwarded-for`. En Vercel esa cabecera la pone la plataforma, pero un abuso distribuido con muchas IP sigue siendo posible. Sin cabecera fiable no hay identificador mejor para un endpoint que no puede exigir sesión.

### M05 — Telemetría de compras con datos del cliente — SIN CAMBIOS, YA DOCUMENTADO

El hallazgo es correcto, pero ya estaba anotado en el propio código como límite conocido con su razonamiento: volver autoritativos `creatorId`, `serviceType` y `grossAmount` exige una referencia de compra que escribe un webhook **de forma asíncrona**, y esta llamada ocurre justo al concretar el pago, cuando a menudo todavía no existe. Registrar la geo desde el webhook pierde la IP del comprador, que es el dato que da sentido al mapa. Mitigado con sesión obligatoria, control de ritmo y tope de importe. **Solo corrompe la analítica del planeta 3D; nunca toca el ledger ni el saldo.**

### M07 — No hay política común de cuenta habilitada — PENDIENTE DE DECISIÓN

**Confirmado, pero MÁS PEQUEÑO de lo que sugería el hallazgo.** Ninguna callable comprueba que la cuenta de quien llama siga habilitada — `isActive` aparece por todo el backend pero **siempre referido a comunidades**, nunca a usuarios.

⚠️ **Lo que el hallazgo no vio:** el bloqueo real no depende de Firestore. `blockUser` (`backend/src/moderation.ts`) deshabilita la cuenta en **Firebase Auth** y además **revoca los refresh tokens**; la marca `platformBanned` de Firestore es solo para pintar la interfaz. O sea que un baneado no puede acuñar llaves nuevas y la que tenga muere en ~1 h.

**El hueco que queda de verdad son esos ~60 minutos**, más el caso de marcar `platformBanned` a mano en la consola sin pasar por `blockUser`, que no bloquea nada.

**Decisión de Luis (2026-08-15): opción B — cerrar la ventana solo donde duele**, dinero y recursos con factura, no en las 98 callables. Comprobarlo en todas obligaría a una lectura extra en cada llamada de cada usuario, todo el día, por un caso que ocurre de tarde en tarde.

**Desplegado el 2026-08-15.** `backend/src/accountStatus.ts` → `assertAccountNotBanned(uid)`, aplicado en:

- **`getOrCreateStripeCustomer`** — es el paso por el que pasan las ocho creaciones de intent más la herramienta de prueba. Un sitio en vez de nueve, y ninguno que se olvide al añadir el siguiente servicio de pago.
- **`requestCashout`** — sacar dinero.
- **`consumeVideoUploadQuota`** — cubre las tres subidas de video a Mux.
- **`createGreetingMuxUpload`** — la otra subida con factura.

⚠️ **Dos casos que NO son un baneo, y tratarlos como tal rompería el producto:**

- **Ficha inexistente.** Los compradores invitados usan sesión anónima y muchos no tienen documento en `users`; darlo por baneado dejaría sin pagar a todo ese flujo.
- **Fallo de lectura.** Si Firestore parpadea no se bloquea el cobro: se registra y se sigue. Lo contrario convertiría una incidencia de base de datos en una caída de los pagos, y el baneo real ya lo sostiene Firebase Auth — esto solo cubre la hora de gracia.

**Efecto secundario buscado:** hasta ahora marcar `platformBanned` a mano en la consola no bloqueaba nada, porque lo que bloquea de verdad es Auth. Ahora esa marca sí surte efecto en las funciones protegidas.

Cobertura en `backend/test-emulator/accountStatus.emulator.test.ts` (5 pruebas).

⚠️ **Nota de la suite:** al llegar a nueve archivos de emulador volvieron a fallar tres por contención de arranque —en archivos distintos y clavados en el timeout—, y cada uno pasaba solo al correrlo aparte. Se subió el timeout de 45 s a 90 s en `vitest.emulator.config.ts`. Si reaparece al sumar archivos, el síntoma es ese.

---
## Bloque 6 — Pagos, wallet, reembolsos y facturación (PARCIAL A PROPÓSITO)

Cerrado y desplegado el 2026-08-15 **todo lo que no depende de Stripe USA**: 4 críticos, 5 altos y 5 medios. Lo que falta está en el **pendiente 9** con su motivo.

- **C01** El saldo a favor se podía gastar dos veces. El cron devolvía el crédito de un checkout abandonado pero **no cancelaba el cobro en Stripe**: bastaba guardar el `client_secret`, esperar 6 h, cobrar el resto con tarjeta y quedarse además con el saldo. Ahora se cancela el cobro PRIMERO y, si la cancelación falla, no se devuelve nada. La comprobación del estado se relee dentro de la transacción.
- **C02** El webhook aprobaba con cualquier cobro. De una misma compra pueden colgar varios cobros de Stripe —recotizar por el país de la tarjeta cambia el importe y nace otro—, y un cobro viejo y barato podía aprobar la versión nueva y cara. ⚠️ **Solo se compara el id, no el importe**: `repriceForCard` corrige legítimamente el importe DEL MISMO cobro, así que compararlo rechazaría compras buenas. Está escrito en el código para que nadie "complete" la comprobación.
- **C03** Un contracargo no quitaba nada. Se devolvía el dinero y el comprador conservaba el post de pago, la entrada del directo o la comunidad. Ahora se retira el acceso —sin vetar la recompra, decisión de Luis— y **antes** de buscar el asiento del ledger, porque esa función salía temprano si no lo encontraba.
- **C04** Dos personas con el último cupo de una invitación entraban las dos. El cupo se **reserva antes de cobrar**, así que quien llega tarde se queda fuera sin haber pagado y desaparece el dilema de qué hacer con alguien ya cobrado. ⚠️ La reserva se consulta ANTES de validar la invitación: al reservar el último cupo el enlace se desactiva, y sin ese orden el comprador chocaba contra su propia reserva al reintentar.
- **H01** El cash-out se marcaba aprobado aunque faltara dinero por devolver. Ahora queda `partially_refunded`, dice cuánto falta y se puede retomar. **No se puede rechazar en ese estado**: devolvería el saldo entero a quien ya recibió parte en efectivo.
- **H03** El saldo se descontaba y la solicitud se creaba después; si eso fallaba, el comprador perdía saldo sin dejar solicitud que nadie pudiera encontrar. Ahora se revierte, y si hasta la reversión falla se registra como incidencia que necesita mano humana.
- **H05** Borrar una comunidad **no cancelaba sus suscripciones**: seguían cobrando cada mes y la renovación recreaba la membresía. Cerrado por los dos lados, y la cancelación es inmediata, no al final del periodo.
- **H06** Se podía empezar a pagar una suscripción a una comunidad borrada: el borrado es lógico, así que "existe" no bastaba.
- **H08** Si el proceso se caía entre capturar el cobro en Stripe y escribirlo en Firestore, el comprador quedaba cobrado y la solicitud congelada en "autorizada" para siempre. Ahora el webhook la recupera; al revés nunca.
- **Medios:** tasas de cambio con caducidad de 48 h (una tasa vieja cobra mal en silencio), tope de espera al proveedor de divisas, clave off-session con importe y moneda, deduplicación y tope en facturación, y los eventos de Stripe que solo se registraban — pago fallido y cancelado **liberan el saldo reservado al instante** en vez de dejarlo secuestrado 6 h, disputa abierta se marca sin tocar el acceso (se puede ganar), y reembolso fallido reabre el cash-out.

**Cobertura:** `intentBinding`, `revokeAccess`, `inviteReservation` y `accountStatus` en `backend/test-emulator/`. H05 y H08 no llevan prueba propia — viven dentro de flujos que no se pueden disparar sin montar medio Stripe, y se prefirió no fabricar una imitación.

⚠️ **La suite de emulador corre en SECUENCIAL** (`fileParallelism: false`). Con 12 archivos en paralelo fallaban tests distintos en cada corrida, siempre clavados en el timeout; se subió el tope tres veces (20 → 45 → 90 s) creyendo que eran lentos y no lo eran. Secuencial tarda menos y es determinista.

---
## Bloque 9 — Mensajes directos y privacidad (CERRADO)

3 críticos, 5 altos, 5 medios y los bajos. Desplegado el 2026-08-16/17.

- **C01** El bloqueo no cortaba dentro de un hilo ya abierto. SÍ se comprobaba al ABRIR una conversación nueva, pero al escribir dentro de una existente el único freno era `status: "blocked"` en el hilo, y ese estado lo escribe el CLIENTE después de bloquear, en una operación que no es atómica, se traga sus errores y no corre al desbloquear. Decisión de Luis: al bloquear, el hilo se cierra DEL TODO — ni escribir, ni reaccionar a mensajes viejos, ni volver a abrir las imágenes del historial (eso último en `dmImages.ts`). Esconderte un mensaje a ti mismo sigue permitido: no le manda ninguna señal al otro.
- **C02** Un participante podía destruirle las imágenes al otro. La regla solo exigía que la ruta empezara por la conversación, y la ruta real lleva también el uid de quien subió. Se escribía un mensaje apuntando al archivo DEL OTRO, se retiraba, y la limpieza lo borraba con el Admin SDK. ⚠️ **Mismo patrón que B8-C01**, pero aquí la imagen es un mapa suelto y no una lista, así que sí se pudo cerrar en la regla; además lleva la misma red en el consumidor.
- **C03** Cualquiera podía abrir a moderación una conversación ajena. El id es determinista (`uidA_uidB`), así que bastaba con conocer dos uids para denunciar un hilo ajeno y dejarlo `underReview`, que es lo que abre su lectura completa. Un moderador podía auto-denunciar cualquier hilo. Ahora solo denuncia quien está dentro.
- **Altos:** subidas a `dmImages` sin comprobar participación (⚠️ la comprobación acepta también que el id te incluya, **y es obligatorio**: al abrir un hilo nuevo la imagen se sube ANTES de que exista el documento); freno de mensajes (1 s, 300/hora) con el mismo mecanismo de lote atómico de B8-H03; imágenes remotas de rastreo por los campos `url`/`thumbnailUrl` que las reglas seguían aceptando sin validar dominio; la marca de moderación que no caducaba nunca; y las carreras del inbox — el resumen se reemplazaba sin mirar el orden, y sin marca de idempotencia una reentrega (Firebase garantiza *al menos una*) doblaba el contador y repetía el aviso.
- **Medios:** citas a mensajes inexistentes o atribuidas al otro; responder una solicitud sin activarla (⚠️ `convAfter()` es `getAfter`, así que basta con quitar la escapatoria del destinatario para obligar a que aceptar y responder ocurran juntos); avisos sin el texto del mensaje, decisión de Luis.
- **Bajos:** el resumen se recortaba a 140 al editar y a 200 al crear, así que editar RECORTABA el inbox; los fallos al refrescar el resumen no se reintentaban, dejando a la vista el texto de un mensaje retirado; la pantalla de ajustes mostraba `everyone` por defecto mientras reglas y tipos usan `following`; y la paginación sin desempate se saltaba o repetía mensajes con la misma marca de tiempo.

**No se cambió** (decisión de Luis, 2026-08-16): cambiar la política a "nadie" NO corta las conversaciones ya abiertas. El ajuste decide quién puede EMPEZAR.

- **El texto de las citas, cerrado del todo.** Era una copia que escribía el cliente y que las reglas NO podían comprobar: la cita se recorta a 200 caracteres y un mensaje llega a 2000, así que no hay con qué compararla y las reglas no saben cortar cadenas. Se podía poner en boca del otro cualquier cosa. Se resolvió por donde había que resolverlo: **el texto ya no se guarda**. La interfaz lo lee del mensaje ORIGINAL por su id, y en `replyTo` solo queda la referencia, de la que sí responden las reglas (el mensaje existe en el hilo y `senderId` es su autor real). Si el original quedó en una página anterior, la cita se pinta sin texto y sigue llevando a su mensaje al pulsarla: mejor no decir nada que repetir algo no verificable. Los mensajes antiguos que ya llevan `text` se leen igual, la interfaz ignora esa copia.

**Cobertura:** `directMessages.rules.test.ts`, suite de reglas **352 verdes**.

⚠️ **Al añadir el freno hubo que convertir 25 pruebas.** Nueve eran negativas y habrían empezado a fallar por FALTA DE CONTADOR en vez de por lo que probaban: un negativo que pasa por el motivo equivocado no vale nada. Y una prueba codificaba que el destinatario puede responder sin aceptar, algo que la interfaz no ofrece y que la auditoría marcó como fallo; se invirtió.

---
## Bloque 8 — Publicaciones, comentarios, historias, feeds y visibilidad (PARCIAL)

Desplegado el 2026-08-16: los 4 críticos, 6 de los altos y 2 medios. Lo que falta está abajo con su motivo.

**El patrón del bloque:** la creación de publicaciones se cerró y se hizo autoritativa en el bloque 4, y todas las garantías que da se podían deshacer **editando después**. La auditoría lo resumió bien: "las rutas posteriores a la creación rompen esas garantías".

- **C01** Firmar y borrar archivos ajenos. `media` se reescribe al editar y las Firestore Rules **no saben validar los elementos de una lista**, así que el autor podía meter ahí cualquier ruta del bucket. Dos funciones con privilegios de administrador la obedecían: `getRestrictedMediaUrls` la FIRMABA y `postMediaCleanup` la BORRABA. Ponías en tu post la ruta de la foto de otra comunidad, pedías el enlace firmado, te la descargabas y borrabas tu post para borrársela a su dueño. Cerrado en los dos consumidores con una invariante única (`posts/{contexto}/{uid}/`, en `backend/src/postMediaPaths.ts`), que ata cada ruta al post Y a su autor. ⚠️ **Falta el lado de la escritura**, ver pendientes.
- **C02** `profileFeed` público. La copia denormalizada del post en `users/{uid}/profileFeed` se leía **sin sesión siquiera**; excluía las comunidades ocultas pero no las privadas, y el backend materializa ahí el post entero. Lo que lo hacía invisible es que **ningún cliente lee esa copia**: la parrilla del perfil consulta `posts` directamente y allí sí se exige `isShareable`. Era un camino paralelo sin ninguno de esos filtros. Cerrada al dueño, igual que sus hermanas `homeFeed` y `savedPosts`.
- **C03** Historias de perfil cerrado, públicas. La regla daba por legible toda historia sin comunidad, sin mirar `profileRestricted`, `showPosts` ni los bloqueos; las publicaciones sí lo miraban desde hacía bloques. ⚠️ El comentario del código decía "las de perfil siguen públicas, que es lo que se quiere", y era cierto para lo que se estaba resolviendo entonces (perfil vs comunidad); que un perfil CERRADO siguiera enseñándolas nunca se decidió, simplemente no se miró. Decisión de Luis: desaparecen del feed público.
- **C04** Monetizar editando. `createPost` garantiza tres cosas —en una comunidad solo cobra su creador, precio entre 10 y 100000, y los tres campos de precio iguales— y la edición deshacía las tres. El cobro lee `oneTimePrice ?? premium.price` y acredita a `post.authorId`: era un cobro real a nombre de quien no tenía permiso. ⚠️ Los caminos `canUpdateLivePeakViewers` / `canUpdateLiveRuntimeData` solo dejan tocar `liveData`, **pero el precio del ticket vive dentro de `liveData`**; había que atarlos también.
- **H01/H07** Los 11 disparadores de `homeFeed`/`profileFeed` no tenían `retry`, y el borrado de una copia de comunidad recién oculta iba dentro de un `.catch(() => {})`. Un fallo dejaba contenido revocado visible para siempre. Misma lección que B7-C01.
- **H02** Cerrar el perfil no alcanzaba a lo ya publicado. Disparador nuevo + backfill.
- **H04** Menciones sin tope. `emitMentions` recorría todas con un `await` dentro del bucle: un solo comentario podía lanzar miles de notificaciones. Tope de 5 (decisión de Luis) en el disparador, que es el único sitio que ve la escritura venga de donde venga.
- **H05** Historias sin límites, por dos lados. **(a) La forma:** `hasOnly` fijaba qué claves podían venir pero no lo que traían, así que se podía fechar una historia en 2099 para dejarla clavada arriba del reel, estrenar con vistas infladas, o meter miles de prefijos y categorías; `createdAt == request.time` es lo que ancla la fecha. **(b) El ritmo:** no había NINGÚN freno, se podían crear sin límite. Cerrado con el mismo mecanismo de H03 —contador en el mismo lote atómico— a **20 al día**, decisión de Luis (2026-08-16), sin espera entre una y otra porque publicar dos seguidas es normal y quien manda es el tope diario.

  La aritmética del contador se compartió entre comentarios e historias en vez de duplicarla: `contadorAvanza(esperaSegundos, ventanaHoras, tope)` en las reglas y `lib/rateLimit/frenoEnLote.ts` en el cliente. Solo cambian los tres números.
- **Medios cerrados:** las portadas de historias eran `allow read: if true` aunque el perfil o la comunidad estuvieran cerrados; y `postMediaCleanup` registraba los borrados fallidos sin relanzarlos, así que un archivo que fallara una vez se quedaba para siempre.

- **C01, lado escritura** Editar una publicación pasó al servidor (`backend/src/updatePost.ts`), igual que la creación en el bloque 4. Comprueba que cada ruta cuelgue de ESTE post y de SU autor, acota texto y número de archivos, ancla los hosts de las URL (una URL externa en un medio convierte la publicación en una baliza que registra la IP de quien la abra) y escribe el historial de edición **en la misma transacción** que el cambio — antes eran dos escrituras sueltas y el historial podía quedar huérfano.
- **Los 5 medios**, cerrados: esquema cerrado en comentarios y respuestas (con contadores forzados a cero y fechas ancladas a `request.time`), validación completa al editar, limpieza que relanza en vez de tragarse el fallo, historial transaccional, y portadas de historias que respetan el perfil o la comunidad cerrados.

**Cobertura:** `postMediaPaths.pure.test.ts` (15) y `updatePost.emulator.test.ts` (14) en el backend — suite de emulador **156 verdes**. `postMonetizationEdit.rules.test.ts` y `storiesProfilePrivacy.rules.test.ts` en las reglas — suite de reglas **301 verdes**.

⚠️ **La suite del emulador del backend se lanza desde la RAÍZ** (`npm run test:emulator`), que es quien arranca el emulador con `emulators:exec` y define `FIRESTORE_EMULATOR_HOST`. Lanzar `test:emulator:run` desde `backend/` corre los tests sin emulador y caen 52 con "Unable to detect a Project Id", que parece un fallo del código y no lo es.

- **H03** El freno para comentar se pedía en una llamada APARTE (`checkRateLimitComment`) y el comentario se escribía directo después: dos pasos independientes, así que bastaba con no dar el primero. Una regla no puede exigir que ANTES ocurriera otra cosa, **pero sí puede exigir que ocurra A LA VEZ**: `canCreateComment` pide con `getAfter` que el contador quede escrito en el MISMO lote atómico. Sin contador no hay comentario, y el contador pasa por las reglas de `/rateLimits`, que comprueban los 3 s y el tope de 60 por hora.

  Se descartó el callable a propósito: quién puede comentar lo deciden **seis funciones encadenadas** de `firestore.rules` (acceso premium, ticket de directo, bloqueos de comunidad, comentarios habilitados, antigüedad del follow). Un callable habría necesitado su propia copia de las seis, y una copia que se desincroniza del original es exactamente el fallo que esta auditoría lleva ocho bloques encontrando. Así la autorización sigue viviendo en UN solo sitio. Decisión de Luis (2026-08-16).

  ⚠️ Esto **reabre `rateLimits` a escritura del cliente**, que se cerró en un bloque anterior porque el dueño reiniciaba `lastAt` para saltarse el límite. La diferencia es que ahora `lastAt` tiene que valer EXACTAMENTE `request.time`, la hora del servidor, y para escribir el `lastAt` ANTERIOR tiene que ser lo bastante viejo. El borrado sigue cerrado, que si no se borraba el documento y a empezar.

  ⚠️ **`checkRateLimitComment` se BORRÓ de producción**, no solo se dejó de usar. Escribía con el Admin SDK un `set` completo de `{lastAt, hourTimestamps}`, o sea que **borraba `windowStart` y `count`**: una llamada reiniciaba la ventana y el arreglo se desactivaba a sí mismo. `checkAndRecord` se conserva, lo usan `post` y KYC.

  ⚠️ Y de paso, **las respuestas no tenían freno ninguno**: `createPostComment` sí llamaba al límite y `createPostCommentReply` nunca lo hizo. El spam ni siquiera necesitaba saltarse nada, le bastaba con mudarse a las respuestas. Ahora gastan el mismo contador.

- **H06** El bloqueo entre miembros de una comunidad solo existía en el cliente: la interfaz escondía las publicaciones de quien habías bloqueado, pero pidiéndolas por el SDK llegaban igual. Cerrado en el `get`, en las dos direcciones (bloquear y ser bloqueado).

  ⚠️ **El `list` NO lo comprueba, y es una decisión, no un olvido.** Comprobar el bloqueo cuesta dos `exists()` por documento y el tope de 10 accesos es para la consulta ENTERA: con veinte publicaciones se agota y Firestore deniega la consulta COMPLETA, dejando el muro en blanco para todos. Cerrarlo ahí obliga a materializar el muro por persona (una copia de cada publicación por miembro), que es otra arquitectura y un coste permanente. Decisión de Luis (2026-08-16): cerrar el `get` —que es como se llega desde un enlace, una notificación o una búsqueda—, filtrar el listado en el cliente y dejarlo escrito. `groupMemberBlocks.rules.test.ts` incluye una prueba que documenta ese límite; **si algún día se materializa el muro, esa prueba cambia de signo**.

  Dos trampas que costaron dos rondas y las dos las detectó `premiumPostVisibility`, no las pruebas nuevas:
  - `resource.data.groupId` con el campo AUSENTE es un **error de evaluación**, no `false`. En un `||` el error se absorbe si otra rama da true —por eso el resto del archivo lo escribe suelto— pero esto va en un `&&` al final del `allow get`, donde el error deniega. Una publicación de perfil dejaba de abrirse. Hay que usar `.get('groupId', null)`.
  - `isMember()` va delante de los dos `exists()` por coste: un bloqueo entre miembros solo puede existir entre miembros, y el documento de miembro ya está en caché de `canReadPost`.

### ⚠️ Regresión encontrada en el bloque 6, ya corregida

**B6-C03 se anunció cerrado y no lo estaba.** El contracargo retiraba el acceso MARCANDO el documento (`status: "revoked"`, `revoked: true`) en vez de borrarlo —hace falta para investigar la disputa— pero las reglas comprobaban solo `exists()`:

```
function hasPostAccess(postId) {
  return signedIn() && exists(.../postAccess/$(uid + '_' + postId));   // ← el fallo
}
```

Resultado: reclamabas el cargo a tu banco, te devolvían el dinero y **conservabas el post de pago y la entrada al directo**. Lo mismo en `hasLiveTicket`.

Es el mismo patrón que ya mordió en el bloque 7 con los miembros sancionados: **los documentos se marcan, no se borran, y `exists()` no basta.** Se comprueba `revoked` y no `status` porque `postAccess` usa `"active"` y `liveAccess` usa `"paid"` —dos vocabularios— mientras que `revoked` lo escribe la misma función en los dos. Cubierto por `revokedAccess.rules.test.ts`.

### Pendientes del bloque 8

| Qué | Por qué no está |
|---|---|
| **C01, cerrar `media` en las reglas** | El callable ya existe y el cliente ya lo usa, pero ese cliente todavía no está en Vercel. Quitar `media` de `canEditPost` antes de que lo esté dejaría la edición rota. El ataque ya está muerto por los dos consumidores, así que esto es el tercer cerrojo, no la defensa. |

---
## Bloque 7 — Comunidades, membresías y moderación (CERRADO)

Cerrado y desplegado el 2026-08-16: 2 críticos, 6 altos, 4 medios y los 2 bajos.

- **C01** Una comunidad **oculta** podía tener contenido público: los posts guardaban una copia de la visibilidad y esa copia no se actualizaba al ocultar la comunidad. La sincronización ahora reintenta (`retry: true`), relee la visibilidad real dentro del handler y **lanza** si algo falla, más un barrido diario que caza lo que se haya escapado.
- **C02** La creación de posts era del cliente, así que el precio, el modo del directo y las banderas de premium venían de quien publicaba. Movida al backend con un DTO cerrado, un precio efectivo único escrito en los tres campos y los modos de directo desconocidos aplastados a `members_only`.
- **A3–A8** Invitaciones de moderador que no comprobaban sanciones, listas de miembros enumerables saltándose `membersListVisibility`, portadas y avatares de comunidades restringidas legibles por URL, la invitación consumida dos veces, y `softDeleteGroup` sin declarar `secrets` — con lo que la cancelación de suscripciones del bloque 6 **no hacía nada en silencio**.
- **M09–M11** Esquemas `hasOnly` en 17 declaraciones, coherencia del índice de búsqueda con la comunidad, y la autorización de los **siete** flujos de moderación movida DENTRO de la transacción que escribe (antes se comprobaba el rol, se escribía con un `batch` y un `batch` no detecta conflictos).
- **M12** ⚠️ **Expulsar de una comunidad pública es definitivo** —decisión de producto de Luis— y no lo era. La regla de salida bloqueaba `banned` y `muted` pero no `removed`, así que el expulsado borraba su propio documento de miembro y lo recreaba como activo: `create` solo exige que no exista. Dos clics y la sanción desaparecía. Cerrado con los tres nombres del estado (`removed`, `kicked`, `expelled`).
- **bajo 13** El espejo de la membresía en `users/{uid}/groupMemberships` copia datos de la comunidad y lo escribe el propio usuario. El rol y el estado ya estaban atados al documento real de miembro —nunca hubo escalada— pero la visibilidad copiada no, y `OwnerSidebar` la usa para esconder las comunidades ocultas de tu lista. Ahora la copia tiene que coincidir con la comunidad real en dueño, visibilidad, actividad y descubribilidad. ⚠️ **`null` se acepta a propósito**: cuando el cliente no puede leer la comunidad, `getGroupMembershipSummary` devuelve null entero y el alta legítima escribe null en todos. El nombre y las imágenes se dejan libres: son cosméticos y fijarlos tumbaría las altas en vuelo al renombrar.
- **bajo 14** Edad, etiquetas y el índice de búsqueda tenían sus límites de verdad solo en el cliente, y el `update` de la comunidad **no comprobaba ninguno de los tres**: se podía crear con una edad válida y corregirla después a lo que fuera. Fijados en las reglas los topes que ya usaba el código (18–99 con `ageMin <= ageMax`, 10 etiquetas, 20 etiquetas normalizadas, 40 tokens, 80 prefijos) y aplicados también al `update`. ⚠️ Las reglas **no saben recorrer una lista**: solo se puede comprobar el tamaño, el tipo de cada elemento sigue dependiendo del cliente.

**Cobertura:** `groupModeration.emulator.test.ts` (14) en el backend; `groupMembers.rules.test.ts` y el nuevo `groupMetadataIntegrity.rules.test.ts` en las reglas. Suite de reglas: 268 verdes.

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
