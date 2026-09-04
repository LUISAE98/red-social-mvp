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
manifiesto de cliente de Next asocia a cada ruta. Es el JavaScript *atribuido a
la pantalla*, que es una cota superior de lo que se ejecuta en la primera
pintura: un componente cargado con `next/dynamic` puede seguir apareciendo en el
conjunto de la ruta aunque su descarga se aplace. Sirve igual como instrumento
comparativo —se mide idéntico antes y después— pero **el efecto de pasar algo a
`next/dynamic` se lee mejor en la fila `compartido por todas`** que en la fila de
una ruta suelta.

### Línea base del 3 de septiembre de 2026

Build `3TS0TQroBF-dLk-CLF3VL`. Las cifras completas están en `baseline.md`.

| | gzip | en disco |
| --- | ---: | ---: |
| **Compartido por todas las pantallas** | **477 KB** | **1 680 KB** |
| Inicio (`/`) | 1 019 KB | 3 657 KB |
| Comunidad (`/groups/[groupId]`) | 1 089 KB | 3 966 KB |
| Perfil (`/u/[handle]`) | 1 077 KB | 3 900 KB |
| Wallet (`/wallet/finanzas`) | 932 KB | 3 331 KB |
| Login (`/login`) | 508 KB | 1 803 KB |

Los 477 KB compartidos son el suelo: cualquier pantalla los paga antes de pintar
nada propio. Bajarlos es el objetivo de los bloques 1 y 2.

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
