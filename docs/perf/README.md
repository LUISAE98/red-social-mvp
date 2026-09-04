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

⚠️ **El bloque 1.1 (partir las traducciones) se pospone hasta después del bloque
2.** Los espacios de nombres pesados —`services` 38,5 KB y `wallet` 32,5 KB— se
usan dentro de `OwnerSidebar`, que vive en el layout autenticado: mientras ese
componente siga en el camino crítico, cortarlos por ruta no ahorra nada en la
app logueada. El bloque 2 lo saca de ahí y entonces el corte sí rinde.

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
