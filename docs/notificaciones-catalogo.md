# Vibra — Catálogo de acciones notificables

> Revisión exhaustiva de la plataforma (2026-07-18). Inventario de todas las acciones que
> deberían generar una notificación, su punto de disparo en el código, el destinatario y los
> datos disponibles. Base para la implementación del sistema de notificaciones.

---

## ✅ Lista maestra por bloques (checklist vivo — act. 2026-07-21)

> ✅ en producción · ⬜ pendiente · ➖ descartada. Los tipos internos viven en
> `backend/src/notifications.ts` y `lib/notifications/types.ts`.

### Bloque 1 — Sociales (interacción con contenido)
1. ✅ Like a tu post (`post_like`)
2. ✅ Like a tu comentario (`comment_like`)
3. ✅ Comentario en tu post (`comment`)
4. ✅ Respuesta a tu comentario (`reply`)
5. ✅ Mención (@) en comentario/respuesta (`mention`)
6. ✅ Nuevo post de quien sigues / de tu comunidad — fan-out (`new_post`, vía Cloud Tasks)
7. ✅ Nuevo seguidor (`follow`)
8. ➖ Guardar post — acción privada, ruido
9. ➖ Compartir — sin destinatario capturable
10. ➖ Pin de post — descartada

### Bloque 2 — Comunidades (membresía + moderación)
1. ✅ Solicitud de unión a tu comunidad (`join_request`, con aceptar/rechazar inline)
2. ✅ Aprobaron tu solicitud (`join_approved`)
3. ✅ Rechazaron tu solicitud (`join_rejected`)
4. ✅ Nuevo miembro gratuito (`group_new_member`)
5. ✅ Nuevo suscriptor (`group_new_subscriber`)
6. ✅ Tu link de invitación caducó — tiempo/usos (`invite_expired`)
7. ✅ Te silenciaron (`group_moderation` action=muted)
8. ✅ Te expulsaron (`group_moderation` action=kicked)
9. ✅ Te bloquearon/ban (`group_moderation` action=banned)
10. ✅ Advertencia de moderación de plataforma (`moderation_warning`)

### Bloque 3 — Monetización / compra-venta 🟡 *(pausado hasta integrar pagos — dLocal)*
> Donaciones YA hechas (ítem 9). El resto **en pausa** hasta integrar monetización.
> **Reglas de agregación acordadas (2026-07-27)** — documentadas aquí para cuando se retome:
> - **Post premium / VOD:** UNA tarjeta **por post**, juntando desbloqueos → "{X} y N más han desbloqueado tu post" (igual VOD y premium normal). Sin monto.
> - **Suscripciones:** juntar TODAS en UNA tarjeta con **ventana de 3 días**; se acumulan 3 días y luego el contador **reinicia desde 0** (nuevo ciclo/tarjeta).
> - **Ticket de live:** regla de agregación **por definir**.
1. ⬜ Vendiste post premium / VOD *(→ vendedor)* — agregada por post (ver regla arriba)
2. ⬜ Recibo de tu compra de post premium / VOD *(→ comprador)*
3. ⬜ Nueva suscripción a tu comunidad *(→ owner)* — agregada, ventana 3 días (ver regla arriba)
4. ⬜ Recibo de tu suscripción *(→ comprador)*
5. ⬜ Baja/churn de suscriptor *(→ owner)*
6. ⬜ Renovación de suscripción *(→ ambos, cuando exista cobro recurrente)*
7. ⬜ Te compraron un supercomentario *(→ vendedor)*
8. ➖ Donación en tu live — **NO** cuenta como donación (decisión 2026-07-27)
9. ✅ **Donación en perfil / comunidad** (`donation`) → creador, en **Sociales**. Agregación por canal: **≤3 separadas, >3 en una sola tarjeta por canal** (perfil/comunidad); sin monto (pendiente de ubicar). Trigger `onDonationNotify` sobre `profileDonations` (con `groupId` para comunidad); fondo `/donacion-perfil.webp`. (2026-07-27)
10. ⬜ Te compraron un ticket de live *(→ vendedor + comprador)* — agregación por definir

### Bloque 4 — Servicios "request" (saludo, consejo, sesión exclusiva, meet & greet) 🟡
> ⚠️ **El tab "Experiencias"** (en notificaciones) ya muestra las solicitudes **ENTRANTES al creador**
> (saludo, consejo, sesión exclusiva, tiempo contigo) como **inbox EN VIVO** —no docs de notificación—,
> reusando el pipeline del sidebar: `lib/experiences/useExperienceRequestsInbox.ts` +
> `app/components/Notifications/ExperienceRequestsInbox.tsx` + overlays (`GreetingReviewOverlay`,
> `SessionRequestOverlay`). El subnav Experiencias/Sociales aparece solo si hay pendientes vivas.
> Las 9 notificaciones de abajo son las **CARA-COMPRADOR** (avisos al comprador), que **siguen pendientes**.
1. ⬜ Nueva solicitud de servicio *(→ creador)*
2. ⬜ Aceptaron tu solicitud *(→ comprador)*
3. ⬜ Rechazaron tu solicitud *(→ comprador)*
4. ⬜ Te propusieron / agendaron fecha *(→ comprador)*
5. ⬜ El comprador pidió reagenda *(→ creador)*
6. ⬜ El creador declinó la reagenda *(→ comprador)*
7. ⬜ Servicio entregado — video de saludo/consejo listo *(→ comprador)*
8. ⬜ Reembolso solicitado / procesado *(→ ambos)*
9. ⬜ Tu solicitud pendiente expiró (2 meses) *(→ comprador)*

### Bloque 5 — Sesiones 1-a-1 en vivo (LiveKit) ✅
> Un solo tipo `session_event` con `action`. Helper `notifySessionEvent`. Cubre exclusive_session y meet_greet. **Clic (todas) → `/sessions`** (panel existente: entrar, descargar grabación, ver estado).

| # | Notificación (`action`) | A quién | Disparo | Clic |
|---|---|---|---|---|
| 1 | Recordatorio pre-sesión (`reminder`) | Ambos | Cron `sessionPreSessionReminders` (~15 min antes; marca `reminderSentAt`) | `/sessions` |
| 2 | La otra parte está lista (`partner_ready`) | La otra parte | `setExclusiveSessionPreparing` / `setMeetGreetPreparing` | `/sessions` |
| 3 | La otra parte se unió (`partner_joined`) | La otra parte | `joinSession` (al entrar la 1ª parte) | `/sessions` |
| 4 | Sesión terminó / incompleta (`ended`/`incomplete`) | Ambos | `endSession` + `forceCompleteSession` | `/sessions` |
| 5 | No-show / auto-rechazo (`no_show`/`no_show_both`) | Afectado(s) | Handlers de no-show (crons) | `/sessions` |
| 6 | Grabación lista (`recording_ready`) | Ambos | `livekitWebhook` egress_ended | `/sessions` |
| 7 | Grabación falló (`recording_failed`) | Creador | `livekitWebhook` egress failed | `/sessions` |

### Bloque 6 — Lives / Streaming (Cloudflare Stream)
1. ✅ "{Creador} está en vivo" (`live_started`) → seguidores (live de perfil) / miembros (live de comunidad + `broadcastGroupIds`). Fan-out vía Cloud Tasks. Disparo: `cfWebhooks.ts` rama `live-inprogress`.
2. ➖ El live terminó — descartada (2026-07-24)
3. ✅ El VOD del live ya está listo (`live_vod_ready`) → creador (aviso directo) + seguidores/miembros (fan-out). Disparo: `cfWebhooks.ts` rama `ready` (vodStatus→ready).

### Bloque 7 — KYC / Verificación (Didit) ✅
1. ✅ KYC aprobado — retiros habilitados (`kyc_update` action=approved)
2. ✅ KYC rechazado + motivo (`kyc_update` action=declined)
3. ✅ KYC en revisión manual (`kyc_update` action=in_review)
4. ✅ KYC pendiente / reintento (`kyc_update` action=pending)
> Disparo: `kyc.ts` `diditWebhook` → `notifyKycStatus` (solo si cambia el estado). Clic → `/wallet/finanzas`.

### Bloque 9 — Mensajes directos (DM) ✅ *(push sí, campanita NO)*
1. ✅ Mensaje directo recibido → **push directo al dispositivo, SIN entrada en la campanita**. Es la única notificación del producto que no pasa por `users/{uid}/notifications`: el DM ya tiene su propia bandeja (pestaña de Mensajes, con su contador de no leídos) y duplicarlo en la campanita sería ruido. Se envía con `sendPushToUser()` de `push.ts`, con `tag = dm_{conversationId}` para que los avisos seguidos del mismo hilo se colapsen.
2. ➖ Solicitud de mensaje — **deliberadamente NO empuja**. Un desconocido no debe sonar en el teléfono de nadie; la solicitud se ve al entrar a la bandeja.
> Disparo: `directMessages.ts` `onDirectMessageCreated`, solo si el hilo está en `active` (nunca en `request` ni `blocked`). El mismo trigger denormaliza `lastMessage`/`unread`. Clic → `/groups?dm={conversationId}`, que abre el hilo en el OwnerSidebar.
> Solo perfil ↔ perfil: las comunidades no tienen mensajería.

### Bloque 8 — Wallet / Finanzas ⬜ *(dependen de Mercado Pago / features por construir)*
1. ⬜ Recarga de saldo exitosa — top-up *(→ comprador)*
2. ⬜ Retiro solicitado *(→ creador/admin)*
3. ⬜ Retiro aprobado / procesado *(→ creador)*
4. ⬜ Retiro rechazado *(→ creador)*
5. ⬜ Pago acreditado en tu wallet *(genérico MP)*

**Estado (act. 2026-07-27):**
- ✅ **Hechos:** Bloques 1, 2, 5, 6, 7 + **donaciones perfil/comunidad** (Sociales) + **push FCM** (entrega OS + activación).
- 🟡 **Experiencias:** tab creador-facing en vivo (saludo/consejo/sesión exclusiva/tiempo contigo). Falta el ciclo **cara-comprador** (Bloque 4).
- ⬜ **Pendientes, PAUSADOS hasta integrar pagos (dLocal):** resto del Bloque 3 (premium post/VOD, suscripciones, supercomentario, ticket) y Bloque 8 (wallet: recargas, retiros).
- 🗒️ Reglas de agregación de monetización ya acordadas y documentadas arriba (premium/VOD por post; suscripciones ventana 3 días).

> **Notificaciones EN PAUSA** (decisión 2026-07-27): se retoman cuando esté integrada la monetización con **dLocal**.

---

## Estado actual (punto de partida)

> 🕰️ **HISTÓRICO (2026-07-18).** Ya NO aplica: el sistema de notificaciones se construyó
> (hook `useNotifications`, `NotificationBell`, badge, tipos TS, FCM/push, subnav Experiencias/Sociales,
> regla `match /users/{uid}/notifications`). Se conserva como registro del punto de partida.

**No existe un sistema de notificaciones real.** Solo hay piezas sueltas:

- Subcolección Firestore `users/{uid}/notifications/{autoId}` con forma `{ type, ...payload, read, createdAt }`.
  Es el molde a reutilizar. Hoy solo la escriben **2** lugares:
  - `backend/src/moderation.ts:445` (`warnUser`) → `type: "moderation_warning"`.
  - `app/components/OwnerSidebar/OwnerSidebarMyGroups.tsx:928` → `type: "session_rescheduled"` (al comprador).
- Página placeholder vacía: `app/[locale]/(protected)/notifications/page.tsx` (solo renderiza `t("placeholder")`).
- Icono de campanita en la nav (`MobileBottomNav.tsx`, `VibraNavigationIcons.tsx`) → **sin badge de conteo**.
- Service worker `public/sw.js` = solo caché/offline PWA, **sin** handlers `push`.

**No existe:** componente `NotificationBell`/`NotificationCenter`, badge de no-leídas, hook `useNotifications`,
servicio central, tipos TS (`NotificationType`), **FCM/push**, ni **emails transaccionales**.
No hay regla explícita `match /users/{uid}/notifications` en `firestore.rules`.

**Contexto financiero:** los pagos son **simulados** (`paymentStatus: "simulated_paid"`); Mercado Pago aún no
está integrado. Retiros (withdrawals) y recargas (top-up) **no existen** como flujo real todavía.

---

## Convención a reutilizar

Documento: `users/{destinatarioUid}/notifications/{autoId}`
```
{ type, actorId?, actorName?, actorAvatarUrl?, targetType?, targetId?, message?, read: false, createdAt: serverTimestamp() }
```
Por seguridad, las notificaciones a **otros** usuarios deben escribirse desde **backend** (Cloud Functions),
no desde el cliente (las Firestore Rules no deben permitir que un usuario escriba en la subcolección de otro).

---

## 1. Acciones sociales

> Estado: ✅ integrada (fase 1, 2026-07-18) · ⬜ pendiente · ➖ descartada.
> Los triggers de fase 1 viven en `backend/src/notifications.ts` (7 triggers `onDocumentCreated` con agregación).

| Estado | Acción | Punto de disparo (archivo:función) | Destinatario | Datos disponibles |
|---|---|---|---|---|
| ✅ | Like a post | `backend/src/postReactions.ts` `togglePostFlame` → trigger `onPostReactionCreated` | autor del post (`postData.authorId`) | `uid`, `postId`, `authorId`, `contextType`, `groupId` |
| ✅ | Like a comentario | `backend/src/postComments.ts` `toggleCommentFlame` → trigger `onCommentReactionCreated` | autor del comentario (`commentData.authorId`) | `uid`, `postId`, `commentId` |
| ✅ | Comentario en post | `lib/posts/post-service.ts` `createPostComment` → trigger `onPostCommentCreated` | autor del post / dueño perfil | `author.uid`, `postId`, `authorId`/`profileId`, `mentions` |
| ✅ | Respuesta a comentario | `lib/posts/post-service.ts` `createPostCommentReply` → trigger `onPostCommentReplyCreated` | autor del comentario padre (`commentAuthorId`) | `author.uid`, `postId`, `commentId` |
| ✅ | Mención @ (comentario/respuesta) | `post-service.ts` (3808/4079) → triggers de comentario/respuesta | usuario mencionado (`mention.id`, `type==="profile"`) | `mentions[]`, `author.uid`, `postId`/`commentId` |
| ✅ | Follow / seguir | `lib/social/social-service.ts` `followUser` → trigger `onFollowerCreated` | usuario seguido (`targetUserId`) | `currentUserId`, `targetUserId` |
| ✅ | Solicitud de unirse a comunidad | `lib/groups/joinRequests.ts` `requestToJoin` + `inviteLinks.ts` (private) → trigger `onJoinRequestCreated` | owner/mods del grupo (`group.ownerId`) | `uid`, `groupId`, `ownerId` |
| ✅ | Aprobar membresía | `backend/src/joinRequests.ts` `approveJoinRequest` → trigger `onGroupMemberCreated` (rama `approvedBy`) | solicitante (`userId`) | `userId`, `groupId`, `callerUid` |
| ✅ | Rechazar membresía (`join_rejected`) | `backend/src/joinRequests.ts` `rejectJoinRequest` → `notifyJoinRejected` (server-side, la comunidad hace de actor) | solicitante (`userId`) | `userId`, `groupId`, `callerUid` |
| ✅ | Unirse directo (público/hidden) | `lib/groups/membership.ts` `joinGroup*` + `inviteLinks.ts` (hidden) → trigger `onGroupMemberCreated` (rama directa) | owner del grupo | `uid`, `groupId`, `ownerId` |
| ✅ | Nuevo suscriptor (`group_new_subscriber`) | `inviteLinks.ts` (hidden+sub) + `joinGroupWithSubscription` → `onGroupMemberCreated` detecta `accessType:"subscription"` | owner del grupo | `uid`, `groupId`, `accessType` |
| ✅ | Consumo de invitación | `backend/src/inviteLinks.ts` `consumeInviteLink` (326) → cubierto por `onJoinRequestCreated` / `onGroupMemberCreated` | owner del grupo | `callerUid`, `groupId`, `ownerId`, `outcome` |
| ✅ | Nuevo post (fan-out) (`new_post`) | trigger `onPostCreated` (`posts/{postId}`) → fan-out a seguidores/miembros; agregado por autor; omite lives y borrados | seguidores (perfil) / miembros (grupo) | `authorId`, `contextType`, `groupId`, `postId` |
| ➖ | ~~Guardar post~~ (**NO notificar** — decisión de producto 2026-07-18: acción privada, genera ruido) | `backend/src/postSaves.ts` `togglePostSave` (289) | — | — |
| ➖ | ~~Pin de un post~~ (**NO notificar** — decisión de producto 2026-07-20) | `backend/src/postPins.ts` | — | — |
| ✅ | Moderación de grupo (mute/kick/ban) (`group_moderation`) | `backend/src/groupModeration.ts` `muteGroupMember`/`removeGroupMember`/`banGroupMember` → `notifyGroupModeration` con `action` | miembro afectado | `groupId`, `targetUid`, `action` |
| ✅ | Link de invitación caducó (`invite_expired`) | `onInviteLinkUpdated` (max_uses) + cron `expireInviteLinks` (tiempo) → `emitInviteEnded` | owner que creó el link | `groupId`, `inviteId`, `createdBy`, `reason` |
| ✅ | Advertencia de moderación | `backend/src/moderation.ts` `warnUser` (445) — ya escribía; ahora con `updatedAt` para salir en la campanita | usuario advertido | — |
| ➖ | Compartir | metadata en post (`buildShareMetadata` 1070) | — sin destinatario capturable | (no hay doc por-share) |

## 2. Monetización (todo converge en el ledger)

Chokepoint ideal para notificar compra/venta: `backend/src/wallet/ledgerTriggers.ts` (siempre con
`buyerId`, `creatorId`, `grossAmount`, `currency:"MXN"`, `type` = `LedgerServiceType`, `channelType/channelId`).
Núcleo: `backend/src/wallet/ledger.ts` (`recordEarning` :147, `settleEarning` :243, `reverseEarning` :278;
comisión plataforma 23%). 11 servicios: `supercomment, profile_donation, live_donation, live_ticket,
premium_post, greeting, advice, exclusive_session, live_session, subscription, vod_ticket`.

| Acción | Trigger (ledgerTriggers.ts) | Destinatario | ¿Notifica hoy? |
|---|---|---|---|
| Compra post premium / VOD | `onPostAccessLedger` (124) | vendedor (+ comprador) | No |
| Nueva suscripción a comunidad | `onGroupSubscriptionLedger` (185) | ambos | No |
| Baja de suscripción (churn) | `onGroupSubscriptionChurn` (228) | vendedor (owner) | No |
| Renovación de suscripción | — (no hay ciclo recurrente aún) | — | No |
| Super comentario | `onSuperCommentLedger` (59) | vendedor (autor) | No |
| Donación en vivo | `onSuperCommentLedger` (sin texto) / live | vendedor | No |
| Donación en perfil / comunidad | trigger `onDonationNotify` sobre `profileDonations` (con `groupId`) | creador (vendedor) | **Sí** ✅ — en Sociales, agregada por canal (≤3 sep., >3 juntas) |
| Ticket de acceso a live | `onLiveAccessLedger` (96) | ambos | No |

### Servicios "request" (pagan → pending → earned al entregar) — alta densidad de eventos

| Servicio | Archivo | Eventos notificables |
|---|---|---|
| Saludo / consejo (`greeting`/`advice`) | `backend/src/greetingRequests.ts` | solicitud creada→vendedor; aceptado/rechazado→comprador; **entregado**→comprador; expira→ambos |
| Sesión exclusiva (`exclusive_session`) | `backend/src/exclusiveSessionRequests.ts` | solicitud→vendedor; aceptar/rechazar→comprador; agendar/reagendar→contraparte; reembolso→ambos; recordatorio→ambos |
| Meet & greet (`live_session`) | `backend/src/meetGreetRequests.ts` | igual que sesión exclusiva + no-show→afectado |

Ciclo compartido: `handleRequestLifecycle` en `ledgerTriggers.ts:298`. Cierre/settlement de sesiones:
`backend/src/sessionLifecycle.ts` (`endSession`, `forceCompleteSession`).

## 3. Ciclo de vida: sesiones 1-a-1, lives, KYC

### Sesiones 1-a-1 (LiveKit) — `exclusiveSessionRequests.ts` / `meetGreetRequests.ts` / `sessionLifecycle.ts` / `livekitWebhook.ts`

| Evento | Punto de disparo | Destinatario |
|---|---|---|
| Reserva/solicitud creada | `create*Request` | creador |
| Aceptada / rechazada | `accept*` / `reject*` | comprador |
| Fecha propuesta / agendada | `propose*Schedule` | comprador |
| Comprador pide reagenda | `request*Reschedule` | creador |
| Creador declina reagenda | `decline*Reschedule` | comprador |
| Preparación abierta (una parte lista) | `set*Preparing` | la otra parte |
| La otra parte se unió (arranca contador) | `sessionLifecycle.ts` `joinSession` (163) + `livekitWebhook.ts` `handleParticipantPresence` | la otra parte |
| **Recordatorio pre-sesión** (no existe hoy) | cron `index.ts:32` `expireScheduledServiceNoShows` (cada 5 min) | ambos |
| Sesión terminó / incompleta | `sessionLifecycle.ts` `endSession` / `livekitWebhook.ts` `handleRoomFinished` | ambos |
| No-show / auto-rechazo | crons `expire*NoShowsHandler` / webhook | afectado |
| Solicitud pendiente expiró (2 meses) | crons `autoExpirePending*` | comprador |
| Reembolso solicitado | `request*Refund` | creador/admin |
| Grabación lista para descargar | `livekitWebhook.ts` `handleEgressEnded` (`egress_ended`) | ambos |
| Grabación falló | `livekitWebhook.ts` `handleEgressUpdated`/`Ended` | ambos |

### Lives (Cloudflare Stream) — `liveCF.ts` / `cfWebhooks.ts`

| Evento | Punto de disparo | Destinatario |
|---|---|---|
| Creador inició el live ("X está en vivo") | `cfWebhooks.ts` `cfWebhook` rama `live-inprogress` (135) | seguidores del creador + miembros de `groupId`/`broadcastGroupIds` |
| Live terminó | `cfWebhooks.ts` rama `live-finished` (177) | espectadores (opcional) |
| VOD del live listo | `cfWebhooks.ts` rama `ready` (263) | creador + compradores/seguidores |

(Pipeline análogo por Mux: `liveMux.ts`, `muxWebhooks.ts`.)

### Saludos (entrega de video) — `greetingRequests.ts` / `muxWebhooks.ts`

| Evento | Punto de disparo | Destinatario |
|---|---|---|
| Solicitud de saludo creada | `greetingRequests.ts` `createGreetingRequest` (212) | creador |
| Aceptó / rechazó | `respondGreetingRequest` (523) | comprador |
| Saludo entregado / video listo | `muxWebhooks.ts` `markGreetingAssetReady` (`asset.ready`) | comprador |
| Solicitud expiró (2 meses) | `autoExpirePendingGreetingRequestsHandler` (591) | comprador |

### KYC (Didit) — `backend/src/kyc.ts` `diditWebhook` (286) — ✅ IMPLEMENTADO

> Tipo `kyc_update` (un solo doc por usuario, refleja el último estado). Emite
> `notifyKycStatus` tras persistir, solo si el estado cambió y no es `not_started`.
> Clic → `/wallet/finanzas`.

| Evento | Estado | Destinatario | ✅ |
|---|---|---|---|
| KYC aprobado (habilita retiros) | `approved`, `kycApproved:true` | creador | ✅ |
| KYC rechazado | `declined` (+ `reason`) | creador | ✅ |
| KYC en revisión manual | `in_review` | creador | ✅ |
| KYC pendiente / reintento | `pending` | creador | ✅ |

## 4. Huecos (features aún inexistentes — notificar cuando se construyan)

- **Recargas de saldo (top-up MP):** no implementado. Notificar comprador cuando exista.
- **Retiros (withdrawals):** stub (`wallet/finanzas/page.tsx` `handleWithdrawClick` → toast `withdrawComingSoon`).
  Notificar creador/admin en solicitud, aprobación, rechazo cuando exista.
- **Renovación de suscripción:** sin ciclo de cobro recurrente todavía.
- **Compartir:** sin doc por-share, no hay evento capturable.

---

## Recomendación de instrumentación

1. **Dinero (compra/venta):** enganchar en `backend/src/wallet/ledgerTriggers.ts` (earned/settle/reverse).
2. **Ciclo no-monetario de servicios** (aceptar/agendar/reagendar/recordatorio): en los callables de
   `*Requests.ts`.
3. **Social directo** (like, comentario, follow, join): triggers `onDocumentCreated` en backend + escritura
   segura a `users/{uid}/notifications` (no desde cliente).
4. **Fan-out** (nuevo post, live iniciado): trigger `onDocumentCreated("posts/{postId}")` que recorra
   seguidores/miembros.
5. **Entrega asíncrona** (grabación lista, saludo listo, VOD listo, KYC): en los webhooks correspondientes.
