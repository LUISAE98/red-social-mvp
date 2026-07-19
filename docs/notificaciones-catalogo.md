# Vibra — Catálogo de acciones notificables

> Revisión exhaustiva de la plataforma (2026-07-18). Inventario de todas las acciones que
> deberían generar una notificación, su punto de disparo en el código, el destinatario y los
> datos disponibles. Base para la implementación del sistema de notificaciones.

## Estado actual (punto de partida)

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
| ⬜ | Rechazar membresía | `backend/src/joinRequests.ts` `rejectJoinRequest` (258) — borra el joinRequest, sin trigger de notificación | solicitante (`userId`) | `userId`, `groupId`, `callerUid` |
| ✅ | Unirse directo (público/hidden) | `lib/groups/membership.ts` `joinGroup*` + `inviteLinks.ts` (hidden) → trigger `onGroupMemberCreated` (rama directa) | owner del grupo | `uid`, `groupId`, `ownerId` |
| ✅ | Consumo de invitación | `backend/src/inviteLinks.ts` `consumeInviteLink` (326) → cubierto por `onJoinRequestCreated` / `onGroupMemberCreated` | owner del grupo | `callerUid`, `groupId`, `ownerId`, `outcome` |
| ⬜ | Nuevo post (fan-out) | `post-service.ts` `createTextPost`/`createImagePost`/`createMediaPost`/`createVideoPost`/`createLivePost` | seguidores (perfil) / miembros (grupo) | `author.uid`, `groupId`/`profileId`, `postId` |
| ➖ | ~~Guardar post~~ (**NO notificar** — decisión de producto 2026-07-18: acción privada, genera ruido) | `backend/src/postSaves.ts` `togglePostSave` (289) | — | — |
| ⬜ | Pin de un post | `backend/src/postPins.ts` `toggleGroupPostPin`/`toggleProfilePostPin` | autor del post fijado | `postId`, actor mod/owner |
| ⬜ | Moderación de grupo (mute/ban/kick) | `backend/src/groupModeration.ts` | miembro afectado | `groupId`, `targetUid` |
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
| Donación en perfil | `onProfileDonationLedger` (261) | vendedor (+ recibo comprador) | No |
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

### KYC (Didit) — `backend/src/kyc.ts` `diditWebhook` (286)

| Evento | Estado | Destinatario |
|---|---|---|
| KYC aprobado (habilita retiros) | `approved`, `kycApproved:true` | creador |
| KYC rechazado | `declined` (+ `reason`) | creador |
| KYC en revisión manual | `in_review` | creador |
| KYC pendiente / reintento | `pending`/`not_started` | creador |

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
