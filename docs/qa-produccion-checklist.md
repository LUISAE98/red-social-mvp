# Vibra — Checklist de QA para producción

> Generado el 2026-08-06 escaneando el repositorio completo.
> Objetivo: enumerar **todos los flujos probables** que hay que ejercitar antes de abrir a producción,
> con sus variantes de dispositivo, sesión, rol, visibilidad y estado de pago.

---

## 0. Cómo usar este documento

### 0.1 Leyenda

| Marca | Significado |
| --- | --- |
| 🔴 | **Roto confirmado** — reportado por el usuario o evidente en el código. |
| 🟠 | **Riesgo detectado** — encontré algo concreto en el código que probablemente falle; hay que verificarlo. |
| 🚀 | **Posible deploy pendiente** — el cambio está en el repo pero puede no estar en producción. |
| 🧹 | **Limpieza pre-producción** — no es un bug funcional, pero no debe llegar a producción así. |
| *(sin marca)* | Por probar. No sé si funciona. |

### 0.2 Matriz base (aplícala a cada flujo marcado con “×MATRIZ”)

**Dispositivo / render**
1. Laptop Chrome (≥1180px)
2. Laptop angosta (769–900px — el header de escritorio se oculta, aparece el móvil)
3. Celular navegador (Safari iOS + Chrome Android)
4. **PWA instalada en iOS** (geometría del viewport y scroll-lock — históricamente frágil; ver `docs/ios-pwa-viewport.md`). ⚠️ iOS guarda la configuración de pantalla **al instalar**: si se toca `appleWebApp` o el manifest, hay que borrar la app de la pantalla de inicio y volver a añadirla — recargar no basta
5. PWA instalada en Android
6. Embebido en iframe (`isEmbed` cambia el layout en `app/[locale]/(protected)/layout.tsx`)

**Sesión**
1. Sin sesión (visitante anónimo real, sin doc de Firebase Auth)
2. Invitado con Firebase Anonymous Auth (`ensureGuestAuth`) — el que se crea al comprar sin login
3. Cuenta con email + contraseña
4. Cuenta con Google
5. Cuenta recién creada sin perfil completo (`/complete-profile`)

**Rol frente al contenido**
1. Autor / dueño del perfil
2. Dueño de la comunidad
3. Moderador de la comunidad
4. Miembro activo
5. Miembro suscrito (de pago)
6. Miembro muteado
7. Ex-miembro / expulsado / baneado
8. No-miembro con sesión
9. Invitado / sin sesión
10. Supermoderador de plataforma (`isPlatformMod`)
11. Usuario que bloqueó al autor / usuario bloqueado por el autor

**Idioma** — `es`, `en`, `pt-BR` (los 3 están activos en `i18n/routing.ts`).

**Moneda / país** — cookie `vibra_currency` + cookie `vibra_country` (impuesto). Hoy solo MX está activo en `COUNTRY_TAX_CONFIG`.

### 0.3 Cuentas de prueba que necesitas tener listas

- A: creador con servicios activos, KYC aprobado, comunidad pública + privada + oculta.
- B: creador sin monetizar.
- C: comprador con sesión (email).
- D: comprador con sesión (Google).
- E: cuenta baneada / bloqueada por A.
- F: supermoderador de plataforma.
- G: navegador en incógnito **sin sesión** (para toda la columna “invitado”).

---

## 1. Autenticación y cuenta

1.1 Registro con email + contraseña ×MATRIZ (laptop / celular)
1.2 Registro con Google (popup en laptop, redirect en celular — verificar cuál usa `LoginClient.tsx` en cada caso)
1.3 Inicio de sesión con email + contraseña ×MATRIZ
1.4 Inicio de sesión con Google ×MATRIZ
1.5 Inicio de sesión con Google **con un email que ya existe registrado por contraseña** (colisión de proveedor)
1.6 Recuperar contraseña: envío de correo, correo recibido en el idioma correcto, link válido, link caducado, link ya usado
1.7 Cambiar contraseña estando dentro
1.8 Cerrar sesión desde el header de escritorio, desde el rail de wallet, desde el nav móvil
1.9 🟠 **Transición de salida** — `authTransitionMode === "exiting"` pinta un shell negro; verificar que no se quede colgado ni parpadee al cerrar sesión desde una ruta profunda
1.10 Persistencia de sesión al cerrar/reabrir la PWA
1.11 Sesión expirada / token revocado a mitad de una acción de escritura
1.12 🟠 **Race auth ⇄ Firestore** — cualquier pantalla que escriba antes de `authStateReady()` manda `request.auth = null`. Probar: entrar directo por URL profunda (ej. `/wallet/historial`) recién abierto el navegador y hacer una acción de escritura inmediata
1.13 Sesiones activas: ver dispositivos, cerrar uno, “cerrar todas las demás” (no debe cerrar la actual), geo-IP correcto
1.14 Borrar cuenta (si existe el flujo) — qué pasa con posts, comunidades que posee, saldo de wallet pendiente
1.15 Verificación de correo (si aplica): usuario sin verificar, ¿qué puede y qué no?
1.16 Login estando ya logueado en otra pestaña (sincronización entre pestañas)
1.17 🟠 **Invitado anónimo no debe verse logueado** — `providers.tsx` filtra `isAnonymous → null`. Probar: comprar sin login, luego navegar; el header NO debe mostrar campana / logout / wallet
1.18 🚀 Confirmar que **Anonymous Auth está habilitado en Firebase Console** (sin esto, toda la compra de invitado falla en producción)

---

## 2. Onboarding y perfil

2.1 `/complete-profile` tras registro: nombre, handle, avatar ×MATRIZ
2.2 Handle duplicado / handle con caracteres inválidos / handle reservado
2.3 Saltarse `/complete-profile` navegando a otra URL — ¿queda un usuario a medias?
2.4 Editar perfil: nombre, bio, avatar, portada, enlaces
2.5 Subida de avatar y portada: imagen enorme, HEIC de iPhone, GIF, archivo no-imagen
2.6 Ver perfil propio ×MATRIZ
2.7 Ver perfil ajeno con sesión ×MATRIZ
2.8 **Ver perfil ajeno sin sesión** (shell público) ×MATRIZ
2.9 Perfil con `showPosts = false` — no debe listar posts a nadie externo
2.10 Perfil con `profileRestricted = true` — verificar en las 3 vías: feed, `/u/[handle]`, link compartido `/p/[postId]`
2.11 Seguir / dejar de seguir; contadores de seguidores/seguidos
2.12 Overlay de seguidores/seguidos (paginación, búsqueda)
2.13 Comunidades compartidas (`SharedCommunitiesBadge` / `Overlay`) — **no debe filtrar comunidades ocultas**
2.14 Pestañas del subnav de perfil: Publicaciones, Comunidades, Servicios, Configuración
2.15 Sub-subnav de galerías: Fotos / Videos / En vivo (el VOD de live solo en “En vivo”)
2.16 Lightbox de galería (GroupPostCard headless con `autoOpenMediaUrl`) ×MATRIZ
2.17 Bloquear usuario desde `ProfileMoreMenu`; overlay de cuentas bloqueadas; desbloquear
2.18 Reportar perfil
2.19 Header móvil contextual (avatar + nombre al hacer scroll) — histéresis correcta al subir

---

## 3. Navegación, shell y estados de error

3.1 Home logueado (`/`) — feed, historias, recomendaciones ×MATRIZ
3.2 Home sin sesión — qué se ve exactamente ×MATRIZ
3.3 OwnerSidebar (laptop): mis comunidades, otras comunidades, servicios, saludos
3.4 Nav inferior móvil: pestañas, badges, safe-area
3.5 Rail de wallet en laptop: se muestra a todos; versión “presentación” si no monetiza, completa si sí
3.6 Botón atrás del navegador entre home ⇄ perfil ⇄ comunidad ⇄ post (restauración de scroll)
3.7 Animación de slide de navegación (`consumeNavSlideDir`) — que no rompa los `position:fixed` en iOS
3.8 Deep link directo a cada ruta con y sin sesión (nada debe pantalla-blanca)
3.9 404 / ruta inexistente con locale y sin locale
3.10 `error.tsx` de cada segmento: protected, groups, profile, group
3.11 `global-error.tsx`
3.12 Sin conexión / conexión intermitente a media carga de feed
3.13 ScrollToTopFAB
3.14 🟠 **Hidratación** — el layout protegido gatea con `mounted`; verificar que no haya parpadeo de shell público→autenticado en recargas duras

---

## 4. Comunidades — creación y administración

4.1 Crear comunidad pública ×MATRIZ
4.2 Crear comunidad privada ×MATRIZ
4.3 Crear comunidad oculta ×MATRIZ
4.4 Crear comunidad de **suscripción** (precio, moneda, periodo)
4.5 Subir avatar y portada de comunidad + recorte (`GroupImageCropModal`)
4.6 Editar datos generales (`OwnerAdminGeneral`)
4.7 **Cambiar visibilidad** pública → privada → oculta → pública (`setGroupVisibility`)
  - 4.7.1 🟠 Verificar que `groupPostsVisibilitySync` propague `groupVisibility` a **todos** los posts (es la copia denormalizada de la que dependen las rules; si se queda a medias, hay fuga)
  - 4.7.2 Verificar que los posts salgan/entren del home feed de los miembros
  - 4.7.3 Verificar que los links compartidos `/p/[postId]` dejen de funcionar al pasar a oculta
4.8 Configurar servicios de la comunidad (`OwnerAdminServices`)
4.9 Zona de peligro: eliminar comunidad (`groupDeletion`) — qué pasa con posts, miembros, suscripciones activas y saldo
4.10 Invitar moderadores (`moderatorInvites`), aceptar/rechazar invitación, revocar moderador
4.11 Permisos de moderador vs. dueño: qué puede tocar cada uno
4.12 Solicitudes de ingreso (`GroupJoinRequestsSection`): aceptar, rechazar, en lote
4.13 Enlaces de invitación (`inviteLinks`): crear, límite de usos, caducidad, revocar
4.14 Pestaña Miembros: buscar, ordenar, expulsar, banear, mutear, promover
4.15 Bloqueos entre miembros (`groupMemberBlocks`)
4.16 Transferir propiedad de la comunidad (si existe)

---

## 5. Comunidades — descubrimiento, ingreso y membresía

5.1 Buscar comunidades desde el buscador del header ×MATRIZ
5.2 🟠 Buscar comunidades **sin sesión** — las ocultas NO deben aparecer nunca (ni en índice de búsqueda, ni en recomendaciones, ni en “comunidades compartidas”)
5.3 Rail de recomendaciones de comunidades (`GroupRecommendationsRail`) con y sin sesión
5.4 Entrar a comunidad **pública** siendo no-miembro con sesión
5.5 Entrar a comunidad **pública** siendo invitado sin sesión
5.6 Entrar a comunidad **privada** siendo no-miembro (debe ver landing, no contenido)
5.7 Entrar a comunidad **oculta** siendo no-miembro (debe ser indistinguible de inexistente)
5.8 Unirse a comunidad pública gratis
5.9 Solicitar ingreso a comunidad privada → aprobado / rechazado / pendiente
5.10 Entrar por enlace de invitación (`/invite/[token]`): válido, caducado, revocado, ya usado, estando sin sesión, estando logueado con otra cuenta
5.11 Suscribirse a comunidad de pago desde la landing ×MATRIZ
5.12 Suscribirse desde el rail / desde `OwnerSidebarOtherGroups` (botón “Suscribirme · $total”)
5.13 🟠 **Doble camino de suscripción** — el repo tuvo un camino que escribía membresía directo desde cliente y otro vía `consumeInviteLink`. Verificar que hoy TODO pase por el callable server-authoritative y que las rules cierren la escritura directa
5.14 Renovación automática de la suscripción (esperar/forzar un ciclo)
5.15 Cancelar suscripción → acceso hasta fin de periodo → pérdida de acceso (`subscriptionTransitions`)
5.16 Fallo de cobro de renovación (tarjeta rechazada) → estado del miembro
5.17 🟠 **Guard anti-doble-suscripción** — intentar suscribirse dos veces (dos pestañas, doble clic)
5.18 Salirse de la comunidad voluntariamente estando suscrito (¿se cancela el cobro?)
5.19 Ser expulsado estando suscrito (¿reembolso? ¿se corta el cobro?)
5.20 Al unirse: `onHomeFeedMembershipCreated` sincroniza los últimos 100 posts. Probar con comunidad de >100 posts
5.21 Al salir/ser expulsado: `onHomeFeedMembershipDeleted` borra el feed. Verificar que no queden restos

---

## 6. Publicaciones (contenido)

6.1 Crear post de texto en comunidad, desde laptop (`PostComposerDesktopOverlay`) ×MATRIZ
6.2 Crear post de texto desde celular (`PostComposerMobileOverlay`) ×MATRIZ
6.3 Crear post con 1 imagen / varias imágenes / video / mezcla
6.4 Crear post en el perfil (no en comunidad)
6.5 Crear post premium (`ComposerPremiumPanel` + `useComposerPremium`): precio, moneda, alcance `members_only` vs `public`
6.6 Crear post programado (`scheduledData`)
6.7 Editar post; eliminar post (soft delete `isDeleted`)
6.8 Fijar post en la comunidad / fijar en el perfil
6.9 Compartir post: link `/p/[postId]`, Open Graph (título, descripción, imagen), copiar link
6.10 Abrir `/p/[postId]` sin sesión, con sesión no-miembro, con sesión miembro
6.11 Reaccionar (flama), quitar reacción, contador
6.12 Guardar post; ver `/saved`
  - 6.12.1 🟠 **Bug conocido de cuota de rules** — `where(documentId(), "in", [...])` sobre `posts` supera el límite de 10 `get()`/`exists()` del evaluador de `allow list` y deja el feed de guardados vacío en silencio. Probar con ≥11 guardados
6.13 Comentar; responder comentario; eliminar comentario propio; moderar comentario ajeno
6.14 Menciones `@` en comentarios — **nunca sugerir comunidades ocultas**; en post de comunidad oculta el `@` debe estar deshabilitado por completo
6.15 Imagen en comentario: subir, ver miniatura, abrir lightbox, comentario solo-imagen
6.16 Reportar post / reportar comentario
6.17 Contador de vistas de video/VOD (`postViews` — únicas por usuario)
6.18 Post de un autor que te bloqueó (o que bloqueaste) — no debe aparecer en ningún feed
6.19 Post de un miembro muteado
6.20 Feed de comunidad: paginación, cursor, scroll infinito, pull-to-refresh
6.21 Feed de perfil: mismo
6.22 Home feed: orden, mezcla perfil+comunidad, semilla estable durante la sesión
6.23 Post con media aún procesando (`processing.status`) — placeholder correcto, y actualización al terminar
6.24 Post con media que **falló** el procesamiento — mensaje de error, no un reproductor roto

---

## 7. Historias

7.1 Crear historia desde perfil ×MATRIZ
7.2 Crear historia en comunidad ×MATRIZ
7.3 Portada de historia (`StoryCoverPicker`)
7.4 Ver historias: carrusel de escritorio, fila móvil, círculos de comunidad
7.5 Anillo de “sin ver” / “ya visto”; ocultar contenedores ya vistos
7.6 Caducidad de la historia (24h) y limpieza
7.7 Historia de comunidad privada/oculta — no debe verla un no-miembro
7.8 Historias de un usuario bloqueado
7.9 🟠 Compra desde `StoryViewer` (el cargo de +$3 se corrigió aquí) — reprobar el precio mostrado vs. cobrado
7.10 🚀 Memoria del proyecto indica que **el frontend de historias del algoritmo de descubrimiento quedó sin desplegar** — confirmar

---

## 8. Video bajo demanda (Mux)

8.1 Subir video a un post: laptop y celular ×MATRIZ
8.2 Video largo / archivo grande / formato raro / vertical vs horizontal
8.3 Estado “procesando” → “listo” (webhook `muxWebhooks`)
8.4 Fallo de procesamiento en Mux
8.5 Reproducción en el feed, en el lightbox, en `/p/[postId]`
8.6 **Reproducción protegida** (`muxSignedAssets` / `muxPlaybackToken` / `useProtectedPlayback`): que el `playbackId` firmado caduque y no sea reutilizable por alguien sin acceso
8.7 VOD de pago (`vod_ticket`): comprado / no comprado / comprado por invitado
8.8 Contador de vistas
8.9 Autoplay, silencio por defecto, controles en iOS

---

## 9. Live streaming (Cloudflare Stream)

> Esta es la zona con bugs confirmados. Ver también §10.

9.1 Programar un live (`upcoming`) desde el composer ×MATRIZ
9.2 Iniciar transmisión desde navegador (WHIP/WebRTC, `whip-proxy`) ×MATRIZ
9.3 Iniciar transmisión desde OBS / RTMP
9.4 Permisos de cámara/micrófono denegados; cambiar de cámara; sin cámara
9.5 Live en curso: aro en el home, tarjeta en el feed, reproductor inline, modal de visor
9.6 Terminar live → generación del VOD → el post cambia de estado
9.7 Live caído / desconexión del creador (`liveHeartbeatCleanup`, `liveViewersCleanup`)
9.8 Contador de espectadores (`liveViewerSampler`) — subida y bajada
9.9 Chat del live: enviar, moderar, mutear, bloquear, invitado sin sesión
9.10 Supercomentario de pago (`SuperCommentModal`) — precio mostrado = precio cobrado, con y sin sesión
9.11 Donación durante el live (`LiveChatViewer` / `liveDonationStripeIntent`)
9.12 Live con **boleto de pago** (`live_ticket`): comprar, entrar, intentar entrar sin comprar, intentar entrar con boleto de otro
9.13 Overlay del live (`/live-overlay/[postId]`, `live-overlay-config/poll/ready`)
9.14 Grabación/VOD del live: quién puede verlo, herencia de las reglas de visibilidad
9.15 Multi-dispositivo: creador transmite desde celular y ve el chat en laptop
9.16 Dos lives simultáneos del mismo creador (¿se permite? ¿qué pasa?)

---

## 10. ⭐ Matriz maestra de visibilidad ⇄ feed

> **Esta es la sección crítica.** Los dos bugs que ya detectaste viven aquí.
> Cada celda es una prueba: *publico X con la regla Y, y lo veo/no lo veo desde Z*.

### 10.1 Ejes

- **Contenedor**: perfil · comunidad pública · comunidad privada · comunidad oculta · comunidad de suscripción
- **Tipo**: post normal · post premium · live · VOD de live · historia
- **Alcance elegido al publicar**: `everyone` (todos, incl. no logueados) · `logged_in_only` (solo con cuenta) · `members_only` (solo miembros)
- **Superficie donde se comprueba** (¡las 8!):
  1. Home feed logueado
  2. Home / landing sin sesión
  3. Feed de la comunidad
  4. Feed del perfil del autor
  5. Galerías (Fotos / Videos / En vivo)
  6. Link compartido `/p/[postId]`
  7. Buscador y recomendaciones
  8. Aro de live / fila de historias
- **Espectador**: invitado sin sesión · invitado anónimo · con cuenta no-miembro · miembro · miembro suscrito · autor · moderador · supermod

### 10.2 Bugs confirmados

10.2.1 🔴 **Live con alcance `logged_in_only` se muestra en el feed de no logueados.**
  - Causa candidata A: `guestAllowedForLive()` en `firestore.rules:2654` usa `resource.data.liveData.get('allowLoggedOutViewers', true)` — el **default es `true`**. Cualquier live cuyo doc no tenga escrito el campo (lives creados antes del fix, o una ruta de creación que no lo escriba) queda **abierto a invitados**.
  - Causa candidata B: inconsistencia entre las 3 rutas que escriben el flag:
    - `lib/posts/post-service.create.ts:480` → `effectiveMode === "everyone" && !isHiddenGroupLive`
    - `lib/posts/post-service.ts:671` → igual
    - `app/components/LiveComposer/LiveComposerModal.tsx:360` → `effectiveMode === "everyone"` **sin** el guard de comunidad oculta
  - Causa candidata C: las reglas de listado `canListPublicShareableGroupPost` / `canReadPublicShareableGroupPost` / `canReadPaidShareableGroupPost` (`firestore.rules:2199-2251`) **no miran `visibilityMode`**; dependen 100% del flag denormalizado.
  - Causa candidata D: 🚀 `firestore.rules` está modificado sin commitear → puede no estar desplegado.
  - **Pruebas mínimas**: publicar un live `logged_in_only` en comunidad pública, en privada y en el perfil, y comprobar las 8 superficies desde incógnito.

10.2.2 🔴 **Post premium publicado en comunidad de suscripción con alcance público no aparece en el feed.**
  - Causa candidata A: 🚀 el índice compuesto que necesita `fetchGroupPublicPremiumPostsPage` (`lib/posts/post-service.queries.ts:147`) existe en `firestore.indexes.json:174` pero **el archivo está modificado sin desplegar** → la query falla y el feed sale vacío **en silencio**.
  - Causa candidata B: la regla `canListPublicPremiumGroupPost` exige `isShareable == true`; si el composer no marca el post como compartible al elegir alcance público, la query se deniega.
  - Causa candidata C: si el post lleva `requiresSubscription == true` heredado de la comunidad, cae fuera de todas las cláusulas de listado público.
  - **Prueba mínima**: publicar el post, luego mirar en la consola del navegador si hay un error de índice/permiso de Firestore; y revisar en Firestore el doc del post (`isShareable`, `groupVisibility`, `premium.enabled`, `premium.accessMode`, `requiresSubscription`).

### 10.3 Casos que hay que probar aunque no estén reportados

10.3.1 Post gratis en comunidad **privada** — invitado NO debe verlo en ninguna superficie
10.3.2 Post gratis en comunidad **oculta** — invisible para todos menos miembros y supermod (incluye imágenes en Storage por URL directa: fuga residual conocida)
10.3.3 Live `everyone` en comunidad **privada** — SÍ debe verse por link compartido (es intencional, `isFreePublicGroupPost` lo contempla)
10.3.4 Live `everyone` en comunidad **oculta** — NUNCA debe verse (el guard `isHiddenGroupLive`)
10.3.5 Post premium `members_only` — el no-miembro no debe verlo ni bloqueado
10.3.6 Post premium `public` en comunidad **privada** — debe verse bloqueado y ser comprable desde fuera
10.3.7 VOD de un live restringido — hereda el flag; probar los 3 estados (programado / en vivo / VOD)
10.3.8 Post de perfil con `profileRestricted` — las 8 superficies
10.3.9 Cambiar la visibilidad de la comunidad **después** de publicar — el contenido debe reevaluarse (§4.7)
10.3.10 Cambiar el alcance de un live ya publicado
10.3.11 Contenido de un autor que bloqueó al espectador
10.3.12 Post de comunidad donde el espectador fue expulsado — debe desaparecer del home feed inmediatamente

---

## 11. Sesiones exclusivas y Tiempo contigo (LiveKit)

11.1 Configurar el servicio “Sesión exclusiva” (precio, duración, disponibilidad)
11.2 Configurar “Tiempo contigo” / meet & greet
11.3 Comprar una sesión desde el perfil ×MATRIZ
11.4 Comprar desde una comunidad
11.5 Flujo de solicitud: pendiente → aceptada → agendada → realizada
11.6 Rechazo por el creador → reembolso
11.7 Caducidad automática de solicitudes (`autoExpirePendingServiceRequests`)
11.8 Recordatorios previos a la sesión (`sessionPreSessionReminders`)
11.9 Entrar a la sala (`/sessions/[sessionId]/call`) ×MATRIZ
11.10 ⚠️ **Contador dentro de la videollamada** — es crítico y NO debe eliminarse ni ocultarse; `joinSession` debe arrancar el timer en transacción; no debe adelantar el cierre a t=0
11.11 Solo llega el comprador / solo llega el creador / no llega nadie (`expireScheduledServiceNoShows`)
11.12 Corte al terminar el tiempo; ampliar tiempo (si existe)
11.13 Grabación (egress) con plantilla custom `app/[locale]/egress/session/` — creador grande + comprador PiP, fijada por prefijo `creator_`/`buyer_`. **Solo funciona desplegada en producción**
11.14 Descarga de la grabación (`recordingDownload`, URL prefirmada de 1h desde R2) — solo creador o comprador; probar link caducado y link de otro usuario
11.15 Webhooks de LiveKit (`livekitWebhook`): sala creada, participante entra/sale, egress terminado
11.16 Permisos de cámara/micrófono; red mala; reconexión; cambiar de red móvil↔wifi a media llamada
11.17 Banner de cuenta regresiva fuera de la llamada (`SessionCountdownBanner`)

---

## 12. Saludos y Consejos (experiencias asíncronas)

12.1 Configurar el servicio de saludo / consejo (precio, plazo)
12.2 Comprar un saludo desde el perfil, desde una comunidad y desde una historia (los 3 puntos de entrada)
12.3 Grabar y entregar el saludo (`GreetingReviewOverlay`)
12.4 Render del video con outro y subida a R2 (`greetingRender`, `app/[locale]/egress/greeting/`)
12.5 Rechazar la solicitud → reembolso
12.6 🚀 **Ventana del creador 60→90 días y expiración a `rejected` (sin reembolso)** en los 4 handlers — memoria del proyecto indica **deploy de functions pendiente**
12.7 Página `/experiencias` del comprador: pendientes, entregados, rechazados; badge de novedad
12.8 Descargar el saludo entregado
12.9 🟠 `paymentMode: "mercadopago"` está **hardcodeado** en `greetingRequests.ts:320,387`, `exclusiveSessionRequests.ts:722` y `meetGreetRequests.ts:772` aunque el cobro ya sea Stripe → etiqueta engañosa en datos financieros. Verificar y corregir

---

## 13. Servicios del creador — configuración

13.1 Menú de servicios en el perfil (`CreatorServicesMenu`) ×MATRIZ
13.2 Menú de servicios en la comunidad (`OwnerAdminServices`)
13.3 Activar/desactivar cada uno de los 11 tipos del ledger: `supercomment`, `profile_donation`, `live_donation`, `live_ticket`, `premium_post`, `greeting`, `advice`, `exclusive_session`, `live_session`, `subscription`, `vod_ticket`
13.4 Kit compartido de configuración perfil ⇄ comunidad (`components/services/config`) — que el mismo card se vea igual en ambos scopes
13.5 Card de donación único por `scope`
13.6 Card de suscripción (quedó plana, pendiente de rediseño)
13.7 Full-bleed móvil por card (`.services-tab-margins`)
13.8 Vista previa del servicio (`ServiceFeaturePreview`, `ServicePreviewReveal`)
13.9 Pantalla de éxito al publicar (`ServicePublishedSuccess`)
13.10 Precio mínimo, precio máximo, precio 0, precio con decimales, cambio de moneda
13.11 Activar un servicio sin KYC aprobado — ¿qué mensaje sale?
13.12 Visibilidad de los servicios para un visitante sin sesión

---

## 14. Pagos — Stripe

14.1 Pasarela (`StripePaymentModal`) ×MATRIZ — especialmente teclado móvil y PWA iOS
14.2 Pago con tarjeta que requiere **3DS** (autenticación) en cada uno de los servicios
14.3 Tarjeta rechazada, fondos insuficientes, tarjeta caducada, CVC incorrecto
14.4 Cerrar el modal a media autenticación 3DS
14.5 Doble clic en “Pagar” / dos pestañas (idempotencia)
14.6 Webhook `stripeWebhook`: evento duplicado (dedup `stripeEvents/{id}`), evento fuera de orden, evento tardío
14.7 🟠 **Gotcha `dahlia`** — `invoice.subscription` se movió a `invoice.parent.subscription_details`. Verificar que las renovaciones sí den acceso y sí acuñen ledger
14.8 `reconcile.ts` — reconciliación de un pago cuyo webhook nunca llegó
14.9 Cargo off-session (`offSessionCharge`) para renovaciones
14.10 Cada intent por separado, extremo a extremo (precio mostrado = precio cobrado = ledger):
  - 14.10.1 `donationStripeIntent` (donación a perfil / comunidad)
  - 14.10.2 `liveDonationStripeIntent`
  - 14.10.3 `superCommentStripeIntent`
  - 14.10.4 `liveAccessStripeIntent` (boleto de live y VOD)
  - 14.10.5 `premiumPostStripeIntent`
  - 14.10.6 `greetingStripeIntent`
  - 14.10.7 `serviceStripeIntent` (sesión / tiempo contigo)
  - 14.10.8 `groupSubscriptionStripe` + `groupSubscriptionStripeSync`
14.11 Fórmula de precio: `(base + $3) × IVA` — verificar que sea idéntica en el botón, en la pasarela y en el cargo real, en los 8 intents
14.12 `stripeHealthcheck`
14.13 Reembolso desde Stripe → efecto en el ledger y en el acceso del comprador
14.14 Disputa / chargeback
14.15 🟠 **Route Handlers de `app/api/` usan Admin SDK y bypasean las rules.** Auditar una por una: `super-comment-submit`, `registrar-compra-geo`, `cf-broadcast`, `cf-viewer-proxy`, `whip-proxy`, `livekit-broadcast`, `live-overlay-*`, `tts`, `proxy-avatar`, `auth`
14.16 🟠 **Caso #12(b) abierto a propósito**: un miembro con acceso gratis puede ser cobrado por llamada directa a la API (auto-infligido, gateado solo por UI). Decidir si se cierra antes de producción

---

## 15. Compras sin login (invitado)

15.1 Donación a perfil sin sesión ×MATRIZ
15.2 Donación a comunidad sin sesión
15.3 Donación durante un live sin sesión
15.4 Supercomentario sin sesión
15.5 Boleto de live sin sesión
15.6 Boleto de VOD sin sesión
15.7 Post premium sin sesión
15.8 Apodo del invitado: input en la pasarela (`collectNickname`) + persistencia en `localStorage`
15.9 🟠 **El acceso comprado NUNCA debe ser device-wide** — probar: comprar como invitado, luego abrir el mismo navegador en otra pestaña/incógnito y comprobar que no hereda el acceso
15.10 Invitado que compra y **luego se registra** — ¿se migra la compra a la cuenta real?
15.11 Invitado que compra dos veces — ¿mismo `buyerId` anónimo o dos?
15.12 El invitado no debe ver UI de sesión (campana, wallet, logout) — ver §1.17
15.13 🟠 **Geo de la compra**: el planeta 3D de compras usa geo client-side por celda IP. Confirmado arreglado para invitado premium/VOD y etiquetas `live_ticket`/`vod_ticket`; **pendiente el geo de las renovaciones de suscripción** (server-side sin IP)

---

## 16. Wallet y ledger

16.1 Wallet vista “presentación” (usuario que no monetiza) ×MATRIZ
16.2 Wallet vista completa (creador que monetiza) ×MATRIZ
16.3 Entrada a la wallet: rail derecho en laptop, subnav en celular (el header ya no la tiene)
16.4 Saldo disponible vs. pendiente; ocultar saldo (`useBalanceHidden` / `MaskedAmount`)
16.5 `/wallet/historial` — paginación, filtros, cada uno de los 11 tipos de servicio
16.6 `/wallet/pendientes`
16.7 `/wallet/calendario`
16.8 `/wallet/estadisticas`
16.9 `/wallet/finanzas`
16.10 Planeta 3D de compras por geo
16.11 Ledger: idempotencia (un pago = un asiento), estados `pending → earned`, `refunded`, `rejected`
16.12 Reparto: neto 75 % / comisión 25 % (`WALLET_NET_RATE`), redondeo a 2 decimales
16.13 🟠 **Moneda** — todo debe ser MXN canónico y **cada display debe llevar `baseCurrency`** (el bug histórico de mostrar MXN como si fuera USD, ×17.6)
16.14 🧹 **Limpiar movimientos de prueba viejos** (con `currency: USD` y comisión 23 %) antes de validar cifras
16.15 Canal de la venta: perfil vs. comunidad (`channelType` / `groupId`)
16.16 Trigger de earnings duplicado (dos webhooks del mismo pago)
16.17 Wallet de un creador con 0 ventas; con 1 venta; con cientos

---

## 17. KYC y retiros

> ✅ **Didit está VIGENTE** (act. 2026-08-31). Se eliminó el 2026-08-13 y se **reintegró el**
> **2026-08-27**, al elegir Global Payouts en vez de Connect: Connect traía el KYC incluido,
> Global Payouts no. `backend/src/kyc.ts` existe y lo usan ocho módulos.
>
> Esta nota afirmaba lo contrario. El KYC es de los **89 países pagables sin excepción**, y el
> **país del documento** decide, junto con el de la cuenta de cobro, si el creador necesita
> datos fiscales y sello.

17.1 Iniciar verificación desde la wallet ×MATRIZ
17.2 Estados: no iniciado, en revisión, aprobado, rechazado, expirado
17.3 Webhook de Didit (`diditWebhook`): firma HMAC válida, firma inválida, reintento del mismo evento
17.4 Reintento tras rechazo
17.5 **Gate de retiro**: creador sin KYC aprobado no debe poder retirar
17.6 Panel fiscal de retiro (`WithdrawFiscalPanel`): datos completos, datos incompletos, copiar datos
17.7 **Flujo de retiro con revisión humana** — el creador solicita, la petición cae en la pestaña «Retiros» del superadministrador, y ahí se acepta o se rechaza con motivo. Al aceptar, la ruta de Stripe envía por `OutboundPayment` y la de Wallbit pasa a «pendiente de pago» para transferir a mano. Verificar que el estado queda registrado y es auditable, y que un rechazo devuelve el saldo y las retenciones íntegros
17.8 Retiro por más del saldo disponible; retiro del saldo pendiente; retiro mínimo
17.9 Consumo del free tier de Didit (500 verificaciones al mes) y qué pasa al agotarlo

---

## 18. Facturación (Facturapi / SAT)

18.1 Comprador pide factura (`BuyerInvoicePanel` / `generateBuyerInvoice`)
18.2 Perfil fiscal del comprador (`buyerBillingProfiles`, `buyerTaxProfile`): RFC, régimen, uso de CFDI, CP
18.3 RFC inválido / RFC de persona moral / RFC genérico
18.4 🟠 **La validación de RFC contra el SAT SOLO funciona con llave LIVE.** En sandbox no valida — hay que reprobar todo con llaves de producción
18.5 🚀 Pendientes de producción: cambiar keys a LIVE, subir **CSD real de Vibra**, resolver el 401 de API key por organización
18.6 Perfil fiscal del creador (`creatorTaxProfile`), subida de CSD (`uploadCreatorCsd`)
18.7 Catálogo de productos SAT (`satProductCatalog`) — clave correcta por tipo de servicio
18.8 `facturapiHealthcheck`
18.9 🟠 `invoiceHooks.ts` — los `TODO` de Bloques 2 y 3 quedaron **superados por el modelo de intermediación**: la venta la emite Vibra por cuenta del creador y el self-billing del creador a Vibra desapareció. Limpiar los comentarios.
18.10 Descarga del PDF/XML; reenvío por correo
18.11 Cancelación de factura
18.12 🔴 **Antes de encender `TIMBRAR`** (`runCreatorMonthlyDocs.ts:48`): el grupo A de
`pendientesimpuestos.md` — moneda del CFDI (hoy manda USD etiquetado MXN), cadencia de 24 h de la
global, marca de las ventas cubiertas, candado del doble timbrado y clave de retención. **Timbrar
es irreversible.**
18.13 🟡 Factura global: verificar que un creador **sin sello** no la genera y que el mes se
cuenta aparte (`globalesSinSello`), no como error.
18.14 ⬜ Comprador extranjero: hoy no recibe **ningún** comprobante. Ver `pendientesimpuestos.md` §B8.

---

## 19. Moderación, seguridad y reportes

19.1 Reportar: post, comentario, perfil, comunidad, mensaje de live (`ReportModal`)
19.2 Bandeja `/admin/reports`, `/admin/my-reports`, `/admin/other-reports`
19.3 Resolver reporte: descartar, advertir, eliminar contenido, banear
19.4 Baneo de plataforma: el usuario baneado no puede entrar / publicar / comprar
19.5 Bloqueo entre usuarios: efecto en feeds, perfiles, comentarios, follows (se borran las relaciones), chat de live
19.6 Muteo en comunidad: puede leer, no puede escribir
19.7 Expulsión de comunidad
19.8 Supermoderador (`isPlatformMod`): qué ve de más; que **no** pueda saltarse pagos
19.9 `/admin/audit-log` — que registre todas las acciones
19.10 `/admin/hidden-communities` y `/admin/private-communities`
19.11 `/admin/users`, `/admin/profile`
19.12 Acceso a `/admin/*` **sin ser supermod** — debe rebotar (probar por URL directa, no solo por UI)
19.13 🟠 **Reglas de Storage** — probar acceso directo por URL a imágenes de comunidad oculta, `commentImages/`, avatares, grabaciones. Es la fuga residual conocida
19.14 Rate limiting (`rateLimiter.ts`) — spam de comentarios, de reportes, de solicitudes
19.15 Tests de reglas: correr `npm run test:emulator` y `vitest.rules.config.ts` completos antes del cutover

---

## 20. Notificaciones y push

20.1 Campana del header (laptop 769px+) y nav móvil
20.2 `/notifications` — lista, marcar leído, paginación
20.3 Cada tipo del catálogo (`docs/notificaciones-catalogo.md`): reacción, comentario, respuesta, mención, follow, solicitud de comunidad aceptada/rechazada, invitación de moderador, compra recibida, servicio solicitado/entregado/rechazado, live iniciado, suscripción cobrada/cancelada
20.4 🟠 `lib/notifications/types.ts:85` — `TODO(bloque-4): agregar los tipos de servicios`. Confirmar qué notificaciones de servicio **faltan** por implementar
20.5 Push web (`PushEnablePrompt`, `backend/src/push.ts`): pedir permiso, denegar, revocar desde el navegador
20.6 Push en PWA iOS (requiere instalación en pantalla de inicio)
20.7 Push con la app cerrada / en segundo plano
20.8 Deep link desde la notificación al contenido correcto (incl. contenido al que ya no tienes acceso)
20.9 Notificación de un usuario bloqueado
20.10 Badge de novedad de experiencias (la estrella)

---

## 21. Búsqueda y descubrimiento

21.1 Buscador del header en laptop; página completa de búsqueda en móvil
21.2 Buscar comunidades / posts / perfiles / historias
21.3 Búsqueda sin sesión
21.4 Índices de búsqueda (`groupSearchIndex`, `postSearchIndex`, `searchStories`) — que se actualicen al editar/borrar
21.5 “Sugerido para ti”: posts, historias y lives
21.6 🚀 Memoria del proyecto: **el frontend de historias y lives del algoritmo quedó sin desplegar**
21.7 ⏰ Recordatorio del proyecto: **revisión del algoritmo agendada para el 2026-09-14**, incluida la implementación de la medición de conversión (punto G)
21.8 Recomendaciones de comunidades para usuario nuevo (cold start)
21.9 Que la búsqueda **nunca** devuelva comunidades ocultas ni contenido restringido

---

## 22. i18n, moneda e impuestos

22.1 Los 3 idiomas (`es`, `en`, `pt-BR`) en cada pantalla — buscar claves sin traducir
22.2 Detección de idioma por país en la primera visita (cabecera `x-vercel-ip-country`)
22.3 Cambio manual de idioma → cookie `NEXT_LOCALE` → persistencia
22.4 URL con locale explícito vs. sin locale
22.5 Cambio de moneda de visualización (`vibra_currency`) — que **no** cambie la moneda de cobro
22.6 País para impuestos (`vibra_country`) — se refresca en cada visita (un extranjero en México debe pagar IVA)
22.7 `COUNTRY_TAX_CONFIG`: hoy solo MX activo, 16 países LatAm comentados. Confirmar que un comprador de otro país no rompa el checkout
22.8 IVA no evadible desde el cliente (probar manipulando el request)
22.9 Formato de números/fechas por locale
22.10 🟠 Modelo fiscal: Vibra es **intermediaria** (act. 2026-08-26) — el creador vende, Vibra cobra por su cuenta. Impuesto de la venta según país del comprador; retenciones al creador según su residencia y régimen. Exportación a **0%** confirmada por fiscalista para los 11 servicios. Sesión exclusiva y Tiempo contigo **están desbloqueados**. Ver `docs/legal/fiscal-iva-isr-plataforma.md` §0

---

## 23. PWA, responsive y rendimiento

23.1 Instalar la PWA en iOS y Android
23.2 ✅ **Safe-area inferior**: ya no existe ninguno — el subnav es flotante. `--vb-safe-bottom` vale `0px`, se define una sola vez y no se redefine; `env(safe-area-inset-bottom)` no se usa en ningún sitio activo. `test/unit/pantallaCompleta.test.ts` lo vigila. ⛔ Este punto decía "fijo en 20px con `body.vb-authed`": **falso**, corregido el 2026-09-03
23.2b 🟠 **Escalón negro abajo en PWA iOS**: si reaparece, **NO buscarlo en el safe-area inferior** — ahí no hay nada. Viene del inset de ARRIBA: iOS da el lienzo entero pero un área de dibujo 62px más corta, y se compensa con `--vb-lienzo-extra`. Medir con el lector (pulsado largo en la cabecera de un DM) y **mirar la línea `VAR` primero**: dentro de la app tiene que decir `→ aplicada`. Si dice `NO APLICADA`, el fallo es el interruptor, no la aritmética. `falta 62` es normal y no se va a arreglar. Historia completa en `docs/ios-pwa-viewport.md`
23.2c 🟠 **Traslúcido de la barra de estado**: `.safeAreaGlass` pinta el cristal detrás del reloj. Depende de `statusBarStyle: "black-translucent"`; quitarlo lo corta en seco. Probar arriba **y** abajo en la misma pasada — están atados al mismo interruptor
23.3 🟠 **Scroll-lock**: todos los paneles deben usar `useBodyScrollLock` (overflow + touchmove, **nunca `position:fixed`** en el body). ~39 paneles migrados; probar los que no
23.4 Excepciones deliberadas: los locks de gesto de `GroupPostCard` y `GroupPostComposer` no se tocan
23.5 Rotación de pantalla en celular durante un live y durante una videollamada
23.6 Teclado virtual abierto sobre modales y composers
23.7 Service worker (`ServiceWorkerRegister`) — actualización de versión, splash de refresco
23.8 Tiempo de carga del home con feed largo; imágenes grandes
23.9 Modo oscuro / claro del sistema (si aplica)
23.10 Accesibilidad básica: foco visible, `aria-label` en los botones de icono, contraste

---

## 24. Legal

24.1 Términos y condiciones, aviso de privacidad, política de contenido accesibles desde la app
24.2 Aceptación en el registro; registro de la aceptación
24.3 🟠 **Nueva LFPDPPP 2025** — el aviso de privacidad debe estar en Art. 15. Confirmar que el texto vigente lo cumple
24.4 Wallet fuera de IFPE por custodia (Mercado Pago) — que la redacción legal siga siendo cierta si se migró a Stripe
24.5 Documentos en los 3 idiomas
24.6 Edad mínima / verificación de edad

---

## 25. Infraestructura y limpieza pre-producción

25.1 🚀 **Desplegar reglas**: `firestore.rules` está modificado sin commitear → `firebase deploy --only firestore:rules`
25.2 🚀 **Desplegar índices**: `firestore.indexes.json` modificado → `firebase deploy --only firestore:indexes` (**candidato directo del bug §10.2.2**)
25.3 🚀 **Desplegar functions** — hay al menos un cambio pendiente conocido (ventana 60→90 días, §12.6)
25.4 🚀 `storage.rules`
25.5 ✅ **Rutas de prueba en producción** — BORRADAS el 2026-08-06:
  - `/stripe-test` y su callable `createStripeCheckoutSession` (nadie lo llamaba desde el front)
  - `/stripe-pasarela-demo`
  - `/api/sentry-example-api`
  - toda la carpeta `app/[locale]/dev/` (`cmptmp`, `live-preview`, `migrate-currency`, `session-panels`, `video-icons`)
  - callable `migrateCurrencyMxnToUsd` + `backend/src/migrateCurrency.ts` (el cutover MXN→USD nunca ocurrió)
  - ⚠️ **Requiere `firebase deploy --only functions`** para que los 2 callables borrados desaparezcan de producción
25.6 ✅ **Basura en el repo** — BORRADA el 2026-08-06: `firestore-debug.log`, `replay_pid48236.log` (1 MB). El `.tmp` de rules ya no existía. Se añadieron al `.gitignore` los patrones `replay_pid*.log`, `hs_err_pid*.log` y `firestore.rules.tmp.*` para que no vuelvan
25.6.1 🟠 `stripeHealthcheck` quedó sin consumidor en el frontend (su única página era `/stripe-test`). Sigue siendo invocable a mano desde la consola de Functions como smoke test de Stripe. Decidir si se conserva así o se borra también
25.7 Variables de entorno y secretos en producción: Stripe (live), Mux, Cloudflare Stream, R2, LiveKit, Facturapi, Sentry
25.8 🟠 Confirmar si queda algo activo de Mercado Pago (`MP_SANDBOX`) o si ya está todo en Stripe — y si MP se desmantela o se deja dormido
25.9 Dominio `vibraon.com` en Vercel: certificado, redirecciones, `www`, sitemap, robots
25.10 Sentry: que `captureError` esté reportando en producción; pendientes de instrumentar `ownerWallet` y `sessions`
25.11 Backups de Firestore y política de retención
25.12 Cuotas y límites: Firestore, Functions, Mux, Cloudflare, LiveKit, Stripe
25.13 Validaciones antes del cutover: `npm run lint`, `npx tsc --noEmit`, `cd backend && npm run build`, `npm run test:emulator`
25.14 Plan de rollback

---

## 26. Resumen de lo que ya sé que está roto o pendiente

| # | Qué | Dónde | Estado |
| --- | --- | --- | --- |
| 1 | Live `logged_in_only` visible para invitados | §10.2.1 | 🔴 confirmado |
| 2 | Post premium público de comunidad de suscripción no aparece en el feed | §10.2.2 | 🔴 confirmado |
| 3 | `guestAllowedForLive()` tiene default `true` → lives sin el campo quedan abiertos | `firestore.rules:2654` | 🟠 |
| 4 | `LiveComposerModal.tsx:360` no aplica el guard `isHiddenGroupLive` | `app/components/LiveComposer/` | 🟠 |
| 5 | Reglas y índices modificados sin desplegar | raíz del repo | 🚀 |
| 6 | Deploy de functions pendiente (ventana 60→90 días de experiencias) | `backend/src/` | 🚀 |
| 7 | Frontend de historias y lives del algoritmo sin desplegar | descubrimiento | 🚀 |
| 8 | `paymentMode: "mercadopago"` hardcodeado en 3 flujos ya migrados a Stripe | `backend/src/*Requests.ts` | 🟠 |
| 9 | Geo de renovaciones de suscripción sin resolver (server-side sin IP) | wallet / planeta | 🟠 |
| 10 | Caso #12(b): miembro con acceso gratis cobrable por llamada API directa | pagos | 🟠 abierto a propósito |
| 11 | Bug de cuota de rules en el feed de guardados (≥11 guardados) | `posts` list | 🟠 |
| 12 | Fuga residual: imágenes de comunidad oculta accesibles por URL de Storage | `storage.rules` | 🟠 |
| 13 | Facturapi en sandbox: RFC no valida; faltan keys LIVE y CSD real | facturación | 🚀 |
| 14 | CFDI Bloques 2 y 3 sin implementar | `invoiceHooks.ts:43-44` | 🟠 |
| 15 | Notificaciones de servicios sin implementar | `lib/notifications/types.ts:85` | 🟠 |
| 16 | Rutas de prueba (`/stripe-test`, `/dev/*`) accesibles en producción | `app/[locale]/` | ✅ borrado 2026-08-06 (falta deploy de functions) |
| 17 | Movimientos de wallet de prueba con moneda/comisión viejas | Firestore | 🧹 |
| 18 | Anonymous Auth debe estar habilitado en Firebase Console | consola | 🚀 verificar |
| 19 | No hay payout automatizado de retiros | wallet / KYC | 🟠 confirmar que es a propósito |
| 20 | Sesión exclusiva y Tiempo contigo marcados como BLOQUEADOS en el modelo fiscal | legal | 🟠 confirmar |
