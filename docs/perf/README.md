# Rendimiento — cómo se mide Vibra

Este directorio es el bloque 0 del plan de rendimiento: los instrumentos con los
que se demuestra que los bloques 1 a 5 sirvieron de algo. Sin un «antes»
guardado, cualquier mejora es una opinión.

Hay tres medidas y cada una responde a una pregunta distinta:

| Medida | Pregunta que responde | Dónde vive |
| --- | --- | --- |
| Peso de JavaScript por pantalla | ¿Cuánto código descarga y ejecuta cada pantalla? | `npm run perf:baseline` → `baseline.md` |
| Lecturas de Firestore por pantalla | ¿Cuántas consultas abre cada pantalla y cuántas salen de caché? | Medidor en desarrollo, ver abajo |
| Métricas de campo (LCP, INP, TTFB) | ¿Qué experimenta la gente de verdad? | Sentry, ya desplegado |

---

## 1. Peso de JavaScript por pantalla

```bash
npm run build          # obligatorio: el script lee de .next, no compila
npm run perf:baseline  # mide y guarda baseline.json + baseline.md
npm run perf:compare   # mide y muestra la diferencia contra lo guardado
```

`perf:compare` es lo que se corre al cerrar cada bloque. Imprime una columna
`Δ gzip` por pantalla: verde si bajó, rojo si subió.

**Qué cuenta exactamente.** El script suma los fragmentos únicos que el
manifiesto de cliente de Next asocia a cada ruta. Es una medida comparativa
fiable —se calcula idéntica antes y después— pero **no** es exactamente lo que
descarga el navegador: el manifiesto puede seguir listando un fragmento que
`next/dynamic` ya aplazó. Cuando el cambio va de importaciones estáticas a
dinámicas, conviene confirmarlo contra el HTML servido (receta abajo).

### Verdad de campo: qué descarga el navegador de verdad

```bash
npm run build
npx next start -p 3013          # en otra terminal
curl -s http://localhost:3013/es -o /tmp/home.html
```

Y sumar los `<script src="/_next/static/...">` de ese HTML. Eso es el paquete
inicial real. Sirve además para responder «¿sigue entrando esta librería?»
buscando una marca suya dentro de los fragmentos.

### Línea base del 3 de septiembre de 2026

Build `3TS0TQroBF-dLk-CLF3VL`. Es el «antes» contra el que compara
`npm run perf:compare`; **no sobrescribir** sin querer (`--save` lo hace).

| | gzip | en disco |
| --- | ---: | ---: |
| **Compartido por todas las pantallas** | **477 KB** | **1 680 KB** |
| Inicio (`/`) | 1 019 KB | 3 657 KB |
| Comunidad (`/groups/[groupId]`) | 1 089 KB | 3 966 KB |
| Perfil (`/u/[handle]`) | 1 077 KB | 3 900 KB |
| Wallet (`/wallet/finanzas`) | 932 KB | 3 331 KB |
| Login (`/login`) | 508 KB | 1 803 KB |

Los 477 KB compartidos son el suelo: cualquier pantalla los paga antes de pintar
nada propio.

### Después del bloque 1 — carga bajo demanda

| | antes | después | |
| --- | ---: | ---: | ---: |
| **Compartido por todas** | 477 KB | **319 KB** | −33 % |
| Inicio (`/`) | 1 019 KB | **641 KB** | −37 % |
| Guardados (`/saved`) | 988 KB | 600 KB | −39 % |
| Publicación (`/post/[postId]`) | 981 KB | 601 KB | −39 % |
| Comunidad (`/groups/[groupId]`) | 1 089 KB | 865 KB | −21 % |
| Perfil (`/u/[handle]`) | 1 077 KB | 853 KB | −21 % |
| Login (`/login`) | 508 KB | 350 KB | −31 % |

Confirmado contra el HTML servido: el paquete inicial real de `/` pasó de
**1 242 KB a 917 KB** comprimidos, y ni `hls.js` ni LiveKit aparecen ya entre
los scripts iniciales.

Lo que se movió, y por qué estaba donde estaba:

- **hls.js (154 KB)** — lo importaban en estático `GroupPostCard.tsx` y su
  hermano `GroupPostCard.components.tsx`, que se pintan en cada publicación del
  feed. Ahora se trae dentro del efecto y solo para las fuentes `.m3u8`.
- **LiveKit (152 KB)** — llegaba por `MeetGreetPreparationFullscreen`, colgado
  del `OwnerSidebar` y del banner de cuenta atrás, o sea de TODA pantalla
  autenticada. Dos de sus siete importaciones ni siquiera se usaban.
- **Paneles de la tarjeta** — `PostImageViewer` (2 782 líneas),
  `StripePaymentModal`, `LiveComposerModal` y `LiveStreamSetup`. Todos reciben
  `open` y arrancan cerrados.

### Después del bloque 2.1 — el envoltorio deja de montarse en celular

| | línea base | ahora | |
| --- | ---: | ---: | ---: |
| **Compartido por todas** | 477 KB | **319 KB** | −33 % |
| Inicio (`/`) | 1 019 KB | **589 KB** | −42 % |
| Perfil (`/u/[handle]`) | 1 077 KB | 808 KB | −25 % |
| Wallet (`/wallet/finanzas`) | 932 KB | 721 KB | −23 % |
| Comunidad (`/groups/[groupId]`) | 1 089 KB | 866 KB | −20 % |

Paquete inicial real del inicio, medido sobre el HTML servido:
**1 242 KB → 864 KB** comprimidos.

`OwnerSidebar` y `WalletDesktopRail` ya no se montan en celular ni tablet. Antes
se montaban siempre y en compacto se ocultaban con `display: none` — pero oculto
costaba lo mismo: unas veinte escuchas de Firestore por pantalla para una
interfaz que en el teléfono no se ve nunca.

⚠️ **Lo que había que comprobar antes de desmontarlo:** el sidebar sacaba dos
cosas fuera de su columna por portal, los banners de cuenta atrás de sesión, y
esos SÍ se veían en celular pese al `display: none`. No se pierden:
`GlobalSessionCard` —montado en `app/[locale]/layout.tsx`— renderiza esos mismos
dos banners y lo hace exactamente cuando el viewport es compacto. El reparto ya
estaba pensado así en el código.

También `useWalletVisibility`, que cuesta **seis consultas por montaje**, pasa a
recibir `null` en celular: su único consumidor es el `showWallet` del rail de
escritorio.

Se mantienen en celular, porque el header móvil los usa de verdad:
`useHasPurchasedExperiences` y el badge de la estrella
(`useBuyerExperienceActivity` + `useBuyerExperiencesSeen`).

> La bajada de **consultas** no está medida todavía: hace falta el medidor con
> una sesión real en el navegador. Lo de arriba es la bajada de **bytes**, que sí
> está medida.

### Bloque 2.2 y 2.4 — menos escuchas, no menos bytes

Estos dos no mueven el peso del paquete: quitan **escuchas de Firestore**, que
es lo que hace lento el cambio de pantalla y lo que engorda la factura.

**Solicitudes de ingreso — de N escuchas a ninguna.** El menú lateral abría UNA
escucha por comunidad sobre `groups/{id}/joinRequests` solo para pintar el
globito. Ahora el número vive en el propio documento del grupo
(`pendingJoinRequestsCount`), que el menú YA escucha para dibujarse. Las filas —
quién pidió entrar— se traen únicamente de la comunidad que el creador tenga
desplegada.

- Trigger: `backend/src/entityCounters.ts` → `onJoinRequestsPendingCount`
- Backfill: `npx tsx scripts/backfill-pending-join-requests.ts`
- Reglas: **no hacía falta tocarlas.** El `allow update` de `groups` acota con
  `hasOnly([...])` y el campo nuevo no está en esa lista, así que el cliente no
  puede escribirlo. Mismo caso que `membersCount` y `postsCount`.

**Señales de los rails — solo la mitad se agrupa, y es deliberado.**

- **Perfiles:** una sola consulta por lote en vez de treinta escuchas. La regla
  de `/users/{uid}` es `get, list: if true`, así que agrupar no cuesta nada.
- **Comunidades:** sigue una escucha por documento. La regla `list` de `/groups`
  termina en `isMember()`, `isOwner()`, `isModerator()` e `isPlatformMod()`, que
  hacen llamadas a `get()`. Por lote, **una sola comunidad oculta** basta para que
  la evaluación caiga hasta ahí, se pase del límite de `get()` y Firestore niegue
  la consulta **entera** — no solo esa comunidad. Es un fallo que este repositorio
  ya se comió una vez. Sale más caro y se queda así a propósito.

**De paso:** `OwnerSidebar.parts.tsx` tenía **56 vinculaciones importadas y sin
usar** —el árbol entero del menú, Firestore, auth— en un archivo que solo exporta
tres componentes de presentación y tipos. Quedaron ahí al partir el componente
original.

### Bloque 3 — la caché que sobrevive a la recarga

**Los TTL viven ahora en un solo sitio: [`lib/cache/ttl.ts`](../../lib/cache/ttl.ts).**
Antes cada lista declaraba el suyo y ninguno decía por qué; el resultado era que
volver recargaba en unas pantallas y en otras no, sin patrón. El criterio no es
lo cara que sea la consulta, es **quién puede cambiar el dato**:

| Nivel | Dura | Para qué |
| --- | ---: | --- |
| `CONTENIDO_PROPIO` | 30 min | Feeds: inicio, guardados, perfil, comunidad |
| `CATALOGO` | 10 min | Búsqueda de comunidades, recomendaciones, a quién sigues |
| `TERCEROS` | 1 min | Membresía, solicitud pendiente, bloqueos |

Lo que se corrigió, con los valores que tenía antes:

| | antes | ahora |
| --- | ---: | ---: |
| Búsqueda de comunidades | **30 s** | 10 min |
| Perfiles del rail de recomendaciones | **90 s** | 10 min |
| Comunidades de un perfil · badge de comunes | 3 min | 10 min |
| A quién sigues (historias) | 5 min | 10 min |
| Feed de perfil · de comunidad · guardados | **5 min** | 30 min |
| Inicio | 30 min | 30 min (sin cambio) |
| Estado de membresía en el buscador | 60 s | **60 s — no se toca** |

🚨 **Un TTL corto no es siempre un error.** El estado de membresía lo cambia
*otra persona* —un moderador aprueba tu solicitud desde su teléfono— y esta
pestaña no se entera. Subirlo no haría la app más rápida, la haría mentir.

Subir los feeds a 30 min es seguro porque **los cinco están suscritos al bus de
`lib/posts/post-feed-cache.ts`**: publicar, editar o borrar se propaga al
instante a todas las listas abiertas, caduque o no la caché.

**La caché baja a disco:** [`lib/cache/persistentCache.ts`](../../lib/cache/persistentCache.ts),
sobre IndexedDB. El `Map` de módulo sigue siendo el primer nivel; esto se lee
cuando está vacío, que es exactamente el caso de una recarga o de volver de una
pasarela de pago. El feed se pinta al instante con lo guardado y la consulta sale
detrás para refrescar.

- **Se guardan las publicaciones, no el cursor.** El cursor de Firestore es una
  instantánea viva, no un dato: no se serializa. Por eso al restaurar se lanza
  igualmente la primera página — esa consulta trae el cursor y con él vuelve el
  desplazamiento infinito.
- **Los `Timestamp` se marcan y se reconstruyen a mano.** IndexedDB clona con el
  algoritmo estructurado, que no sabe de clases: un `Timestamp` entraría y
  saldría sin `toDate()`, y reventaría al pintar una fecha — solo en la segunda
  visita, que es el fallo más difícil de reproducir. Cubierto por 8 tests.
- **Se vacía al cerrar sesión**, en `clearClientSession`. En un equipo compartido
  el feed de quien acaba de salir no puede quedarse en disco.

**El scroll se restaura al volver atrás.** Antes solo lo guardaba el nav inferior
al tocarlo, y solo se restauraba en el subnav — así que la vía más común de
todas (bajar por el feed, abrir una publicación, volver) dejaba la lista arriba
del todo. Ahora la posición se guarda de forma continua y el «atrás» la
recupera.

### Dónde está puesta la caché de disco, y dónde NO

La lógica vive en **un** sitio, [`lib/cache/feedPersistence.ts`](../../lib/cache/feedPersistence.ts),
no copiada en cada feed.

| Pantalla | Estado |
| --- | --- |
| Inicio | ✅ |
| Guardados | ✅ |
| Publicaciones de un perfil | ✅ |
| Publicaciones de una comunidad | ✅ |
| Wallet · comunidades de suscripción y canales | ✅ |
| Wallet · saldo, ledger y movimientos | ⛔ **a propósito** |

🚨 **Por qué el saldo NO lleva caché nuestra.** El saldo y los movimientos llegan
por `onSnapshot`, y la caché persistente de Firestore —ya activa en
`lib/firebase.ts`— entrega la primera emisión desde IndexedDB al instante en una
recarga. Poner encima una segunda caché no lo haría más rápido: solo abriría la
puerta a enseñar un saldo **más viejo del que Firestore ya tiene**. Con dinero
eso no se hace.

Lo que sí se arregló de la wallet es lo que Firestore no puede cachear: las
comunidades de suscripción y los canales se cargan con `getDocs` —que espera al
servidor— y la primera suma además un **`getCountFromServer` por comunidad**, que
por definición no se sirve desde ninguna caché. Ahí es donde la pantalla se
quedaba en blanco. Lo guardado son cifras para mostrar (precio publicado,
cuántos suscriptores hay), no dinero sobre el que se pueda actuar.

**Regla general que se siguió:** `onSnapshot` ya está cubierto por Firestore;
lo que merece caché nuestra es lo que se pide con `getDocs` o
`getCountFromServer`.

⚠️ **Pendiente del bloque 3:** el cliente de datos único (3.2). Sigue habiendo
un `useEffect` por lista en vez de una capa que deduplique y revalide sola. Es
un refactor grande y va aparte.

⚠️ **El bloque 1.1 (partir las traducciones) se pospone hasta después del resto
del bloque 2.** Los espacios de nombres pesados —`services` 38,5 KB y `wallet`
32,5 KB— se usan dentro de `OwnerSidebar`. Ahora que no se monta en celular, el
corte por ruta empieza a tener sentido, pero conviene hacerlo cuando 2.2 y 2.4
hayan terminado de mover lo que queda.

---

## 2. Lecturas de Firestore por pantalla

El medidor cuenta cuántas consultas abre cada pantalla, cuántos documentos
llegan y qué parte se resolvió desde la caché local sin ir a la red.

### Encenderlo

Poner en `.env.local`:

```
NEXT_PUBLIC_FS_METER=1
```

y levantar el dev server (`npm run dev`). Aparece un marcador abajo a la derecha.
La terminal lo confirma con `◉ Medidor de Firestore ACTIVO`.

El marcador colorea el número de consultas: verde hasta 12 (objetivo del bloque
2), ámbar hasta 25 (como estábamos en la auditoría), rojo por encima. El botón
«Ver el desglose en consola» imprime una tabla de qué fichero pidió qué.

Desde la consola del navegador también está `window.__vibraFsMeter`:

```js
__vibraFsMeter.resumen()    // { consultas, escuchasAbiertas, docs, desdeCache }
__vibraFsMeter.porOrigen()  // qué fichero abrió cuántas consultas
__vibraFsMeter.imprimir()   // las dos cosas, formateadas
__vibraFsMeter.reiniciar()  // pone el contador a cero a mano
```

El contador se reinicia solo en cada cambio de pantalla: la pregunta que
responde es «¿cuánto cuesta ESTA pantalla?».

### Cómo funciona

Con la bandera puesta, `next.config.ts` alía `firebase/firestore` a
[`lib/dev/firestoreMeter.ts`](../../lib/dev/firestoreMeter.ts), que reexporta la
API entera y envuelve las cinco funciones que leen (`getDoc`, `getDocs`,
`getDocFromServer`, `getDocsFromServer`, `getCountFromServer`) más `onSnapshot`.

Se alía el paquete en vez de envolver cada llamada porque cualquier otra vía
exige editar los ~126 sitios que abren escuchas y, peor, deja fuera los que se
añadan después: el medidor dejaría de decir la verdad justo cuando más se confía
en él.

`onSnapshot` se cuenta dos veces a propósito. El **alta** mide lo que pide el
bloque 2 —cuántas escuchas abre una pantalla al montarse, se usen o no— y cada
**entrega** mide lo que esa escucha cuesta después, que delata a un listener que
se resuscribe en bucle.

⚠️ El medidor tiene doble candado: la bandera **y** que `NODE_ENV` no sea
producción. Envuelve el camino caliente de toda la base de datos, así que que un
despliegue lo lleve puesto por accidente no puede depender de un solo `if`.

### Línea base pendiente

Las cifras por pantalla hay que tomarlas con una sesión real (el medidor
necesita un usuario con comunidades, mensajes y experiencias para que los conteos
sean representativos). La auditoría ya dejó el número del envoltorio: **~25
consultas antes de que la pantalla pida su primer dato**, entre `OwnerSidebar`
(14 `onSnapshot`), `useWalletVisibility` (6 consultas), `useBuyerExperienceActivity`
(3) y `useRailSignals` (1 por entidad del rail).

---

## 3. Métricas de campo (LCP, INP, TTFB)

**No hace falta instalar nada.** Sentry ya está desplegado con
`tracesSampleRate: 1` en producción, y como `instrumentation-client.ts` pasa
`integrations` como *array*, el SDK conserva sus integraciones por defecto —
incluida `browserTracingIntegration`, que es la que recoge los Web Vitals.

Se decidió **no** añadir `@vercel/speed-insights`: sería un segundo agente RUM
en la misma página que estamos aligerando, midiendo lo que ya medimos.

### Dónde mirar

En Sentry, proyecto `javascript-nextjs` de la organización `programin-social`:

- **Insights → Frontend → Web Vitals** — LCP, CLS, FCP, TTFB e INP agregados,
  con desglose por ruta.
- **Insights → Frontend → Pageloads** — la transacción `pageload` por ruta, que
  es donde se ve el reparto entre TTFB, hidratación y primera consulta.

Anotar aquí abajo las cuatro pantallas del plan al empezar cada bloque:

| Pantalla | LCP | INP | TTFB | Fecha |
| --- | ---: | ---: | ---: | --- |
| `/` | | | | |
| `/u/[handle]` | | | | |
| `/groups/[groupId]` | | | | |
| `/wallet/finanzas` | | | | |

> Vercel Web Analytics está **desactivado** en el proyecto (`red-social-mvp`,
> plan Hobby). No hace falta para esto; si algún día se quiere el desglose de
> tráfico por ruta, se enciende desde el panel de Vercel.
