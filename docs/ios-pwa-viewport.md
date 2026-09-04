# El escalón negro de la PWA iOS

Resuelto el **2026-09-03**, tras cuatro intentos fallidos previos y dos diagnósticos
equivocados durante el propio arreglo.

Este documento existe porque el fallo se arregló cuatro veces y volvió cuatro veces. Los tres
primeros intentos están documentados en comentarios del código. Todos buscaron en el sitio
equivocado, y por una razón que merece quedar escrita.

Se deja también constancia de los dos diagnósticos que fallaron **dentro** de esta sesión, con
lo que los desmintió. Son más útiles que el resultado: enseñan qué clase de evidencia parecía
concluyente y no lo era.

---

## El síntoma

En la **app instalada en iPhone** aparecía una franja negra pegada al borde inferior. Las
características que la hacían escurridiza:

* **Era pasajera.** Se ponía y se quitaba sola. En el splash de refresco se veía aparecer y
  desaparecer durante la propia animación.
* **Salía en superficies sin nada en común aparente**: el hilo de mensajes directos, las
  pasarelas de pago, los paneles de solicitud de experiencias, el splash.
* **Las capturas de pantalla salían limpias.** Para cuando el dedo llegaba al botón de
  capturar, ya se había enderezado.
* En Safari normal no se reproducía. Solo en la app instalada.

## Por qué fallaron los cuatro intentos

Porque **el número viene de arriba aunque el hueco se vea abajo.**

Todos los intentos —incluido el primero de esta sesión— dieron por hecho que era espacio
reservado para el safe-area inferior, y fueron a quitarlo. No había nada que quitar:

* `env(safe-area-inset-bottom)`: **cero usos activos**. Las apariciones en `globals.css`
  estaban todas dentro de comentarios.
* `--vb-safe-bottom`: definida **una sola vez, como `0px`**, nunca redefinida, nunca escrita
  desde JavaScript. Sus ~111 consumidores evaluaban a cero.

El barrido que se iba a hacer no habría cambiado un solo píxel.

## El instrumento

El fallo solo se reproduce en un iPhone físico **con la app instalada**, así que no se podía
mirar desde el escritorio. Se construyó un lector de geometría dentro de la propia pantalla
de mensajes. Tres cosas resultaron imprescindibles, y las tres se descubrieron fallando:

1. **Leer la geometría VIVA del navegador, no la copia en el estado de React.** La primera
   versión enseñaba `viewport.height`, que es nuestra copia; y la pregunta era justamente si
   esa copia coincidía con el navegador. Con el valor de antes, las dos hipótesis contrarias
   se veían idénticas y el lector confirmaba la que uno ya trajera puesta.
2. **Poder encenderlo desde dentro de la app instalada.** Solo se encendía con `?vv=1` en la
   URL, y en la PWA no hay barra de direcciones: el único sitio donde se podía medir el fallo
   era el único sitio donde no se podía encender el instrumento. Se le añadió un **pulsado
   largo sobre la cabecera del chat**.
3. **Retener la peor lectura, fotograma a fotograma.** El encogimiento dura menos que una
   captura, y muestrear cada 250 ms lo dejaba pasar entre dos medidas.

## La medida

iPhone 16 Pro, app instalada, 2026-09-03:

```
copia 812 @0        ← nuestra copia del viewport visual
vivo  812 @0        ← lo que dice el navegador: IGUALES, y sin desplazamiento
alto win 812        ← el área de dibujo
pantalla 874        ← la pantalla física
seguro ↑62 ↓34      ← los márgenes que reporta iOS
lvh 874  dvh 812    ← lvh aguanta el alto real; dvh se hunde
falta 62
PEOR win 471  lvh 874  dvh 812   ← con el teclado abierto, lvh SIGUE en 874
```

Tres conclusiones inmediatas:

* **No había ningún desplazamiento del viewport visual** (`@0`), y nuestra copia no iba
  atrasada (`copia == vivo`). Las dos hipótesis de partida, muertas.
* **El teclado no tenía nada que ver.** El escalón estaba con `teclado 0`, `foco no` y cero
  eventos de viewport.
* **iOS reportaba los márgenes de una pantalla de 874 mientras entregaba un área de 812.**
  Un inset superior de 62 con el área anclada arriba, y un inset inferior de 34 que solo
  tiene sentido si el área llegara a 874. Eso no es una unidad de CSS mal elegida: es una
  contradicción.

Y 874 − 812 = **62**, que es exactamente lo que ocupa la barra de estado.

## La causa

**`statusBarStyle: "black-translucent"` mete el lienzo por debajo de la barra de estado, y iOS
no le suma esos píxeles al área de dibujo.**

Es un solo interruptor con dos consecuencias, y ahí está el nudo del problema: **es
exactamente el mismo que da el efecto traslúcido de arriba.** No son dos ajustes peleándose;
son la misma decisión vista por sus dos caras.

* **El lienzo** —la superficie física donde se pinta— pasa a medir la pantalla entera, 874.
  Eso es lo que le da a `.safeAreaGlass` un inset que cubrir, y lo que hace que el reloj y la
  batería se lean sobre el cristal.
* **El área de dibujo** —contra la que resuelven `inset: 0`, `bottom: 0` y `100dvh`— se queda
  en 812.

Los 62px de diferencia son la barra de estado. Como el área queda anclada arriba, sobran por
abajo y dejan ver el lienzo desnudo, que es negro.

Era pasajero porque iOS rehace esa cuenta en cada transición —el splash al refrescar, abrir
un panel, cerrar el teclado— y tarda unos fotogramas en cuadrarla. Lo que se pintara dentro
de esa ventana salía 62px corto y se quedaba así.

### La tabla de verdad, medida en el aparato

Tres ciclos de instalación, tres experimentos:

| | `display` | `statusBarStyle` | Traslúcido | Escalón |
|---|---|---|---|---|
| **A** (original) | `fullscreen` | `black-translucent` | ✅ | ❌ |
| **B** | `fullscreen` | `black` | ❌ | ✅ sin escalón |
| **C** | `standalone` | `black-translucent` | ✅ | ❌ |

**El manifest no era la causa.** C lo demuestra: `fullscreen` → `standalone` y el escalón
volvió igual. Lo que manda es `black-translucent`, y las dos columnas de la derecha se mueven
siempre juntas.

### Dos diagnósticos equivocados por el camino, y por qué

Este documento llegó a afirmar, en dos versiones distintas, dos causas que no lo eran:

1. **«Es `black-translucent`, sobra el mecanismo viejo.»** Quitarlo (estado B) hizo
   desaparecer el escalón, y eso se tomó por prueba. Pero funcionó por reducción, no por
   arreglo: al quitarlo iOS pasó a insetar el lienzo bajo una barra opaca y todo quedó
   coherente **a costa de media pantalla**. Se llevó por delante `.safeAreaGlass`, que es
   diseño deliberado, y el traslúcido de arriba se cortó en seco.
2. **«Es el `display: fullscreen` del manifest.»** Encajaba bien con los números —iOS daba al
   lienzo el tamaño de fullscreen y hacía las cuentas de standalone— y además era un residual
   que este mismo documento había descartado por inofensivo. El estado C lo desmintió.

**La lección, dos veces aprendida: que un síntoma desaparezca no demuestra que hayas
encontrado la causa.** La primera vez pasó por exceso —el arreglo apagaba de más—, la segunda
por coincidencia.

## El arreglo

Se conserva `black-translucent`, y se compensa la diferencia donde importa. En
`app/globals.css`:

```css
:root {
  --vb-lienzo-extra: 0px;
  --vb-alto-pantalla: calc(100dvh + var(--vb-lienzo-extra));
}

@media (display-mode: standalone) {
  :root { --vb-lienzo-extra: calc(100lvh - 100dvh); }
}
```

Funciona porque **`lvh` sí midió el lienzo de verdad en todas las lecturas**: 874 incluso con
el teclado abierto y el área hundida a 471. No se movió ni una vez. Por eso la diferencia se
puede calcular en vez de adivinar, y por eso esto no es un número mágico.

Se aplica de dos formas, según cómo esté anclada cada superficie:

| Anclaje | Antes | Ahora |
|---|---|---|
| Por alto | `100dvh` | `var(--vb-alto-pantalla)` — 76 sitios en 45 archivos |
| Por abajo | `bottom: 0` | `bottom: calc(0px - var(--vb-lienzo-extra))` — 7 sitios |
| Con `inset: 0` | *(nada)* | se le añade `height: var(--vb-alto-pantalla)` — 7 superficies estructurales |

En el tercer caso el elemento queda sobre-restringido —`top`, `bottom` y `height` a la vez— y
CSS descarta `bottom`. Es justo lo que se busca: manda el alto, y el borde inferior cae donde
de verdad acaba la pantalla.

⚠️ **La compensación va acotada a `display-mode: standalone` a propósito.** En Safari normal
`lvh` ignora la barra del navegador, así que fuera de la app instalada esa resta valdría el
alto de esa barra y escondería contenido por debajo. Fuera de la PWA, `--vb-alto-pantalla` es
exactamente `100dvh` y no cambia absolutamente nada.

**Se cura sola.** El día que Apple cuadre las dos cuentas, la resta da 0 y no hay nada que
revertir.

### El splash, que es la excepción

`#desktop-refresh-splash` se pinta desde un `<style>` en el `<head>`, **antes de que cargue
`globals.css`**. Ahí la variable llegaría vacía, así que lleva su propia
`@media (display-mode: standalone)` escrita a mano. Es el único sitio donde la regla está
duplicada, y es donde más falta hace que valga desde el primer fotograma.

⚠️ Ese bloque vive dentro de un template literal: **un acento invertido en un comentario lo
parte en seco.** Ya pasó al escribir esto.

### Si el escalón vuelve

Medir primero con el lector (abajo). Si `alto win` se separa de `pantalla`, la compensación
dejó de aplicarse: comprobar que la pantalla en cuestión no use `100dvh` suelto ni
`bottom: 0` sin la resta. La prueba automática cubre el primer caso.

El estado de emergencia conocido es `statusBarStyle: "black"`: quita el escalón con
seguridad, a costa del traslúcido. Es una línea, y requiere reinstalar.

## Lo que deliberadamente NO se hizo

**No se convirtieron las 127 superficies `position: fixed` con `inset: 0`** que encontró el
barrido, solo 7. Un scrim de modal que quede 62px corto deja ver lo que hay detrás, no negro;
las que se tocaron son las que SON la pantalla —el shell, los overlays de pantalla completa y
el panel compartido— porque esas dejan ver el lienzo.

Tampoco se tocaron las ~60 lecturas de `window.innerHeight`. Sirven para medir el área de
dibujo, que es lo que quieren medir.


## Auditoría posterior (2026-09-03)

Se barrió la plataforma buscando el mismo patrón —superficies que deben alcanzar un borde
físico ancladas a una geometría que no es la pantalla— y otras declaraciones que se
contradigan sobre geometría:

| Comprobación | Resultado |
|---|---|
| Otros `export const viewport` | ✅ solo `app/layout.tsx` |
| Otras declaraciones `appleWebApp` / `statusBarStyle` | ✅ solo `app/layout.tsx` |
| `<meta viewport>` crudos en el árbol | ✅ ninguno |
| `100vh` (4 apariciones) | ✅ son respaldos de un degradado, no anclajes |
| Consumidores de `env(safe-area-inset-top)` (68) | ✅ 48 con base propia; los 20 restantes no se solapan con la barra opaca |
| `env(safe-area-inset-bottom)` activo | ✅ ninguno |
| Código que consulta `display-mode` | ✅ ninguno, aparte del propio lector |

Ninguna de esas comprobaciones destapó un segundo caso: el fallo tenía **una sola fuente**.
Las 127 superficies y las ~60 lecturas de `innerHeight` eran víctimas.

### Residuales conocidos, a propósito sin tocar

1. **`display` del manifest.** Está en `standalone`. Se cambió desde `fullscreen` creyendo
   que era la causa; no lo era (ver la tabla de verdad), pero se deja así porque iOS nunca
   implementó `fullscreen` —lo reportaba por `display-mode` mientras enseñaba la barra de
   estado— y `standalone` es el valor honesto. **Coste:** en Android la app deja de ser
   fullscreen y reaparece la barra de estado allí. Volver a `fullscreen` es seguro para el
   escalón; es una decisión de producto sobre Android, no técnica.
2. **`orientation: "portrait"` en el manifest** frente al código que sí maneja horizontal
   (`LiveViewerModal`, `PostImageViewer`, `MeetGreetPreparationFullscreen`, `ReelStorySlide`).
   Android respeta el bloqueo y iOS no, así que ese código solo corre en iOS. Es una decisión
   de producto, no un fallo.

## Seguro contra la quinta vez

`test/unit/pantallaCompleta.test.ts` falla si:

* alguien reintroduce `100dvh` suelto en vez de `var(--vb-alto-pantalla)`,
* la compensación deja de definirse una sola vez, o de valer `0px` por defecto,
* la compensación deja de estar acotada a `display-mode: standalone`,
* desaparece `black-translucent`, que es lo que da el traslúcido de arriba,
* se declara `viewport` o `appleWebApp` fuera de `app/layout.tsx`,
* desaparece `viewportFit: "cover"`,
* alguien vuelve a usar `env(safe-area-inset-bottom)`,
* `--vb-safe-bottom` deja de definirse una sola vez en cero.

## Cómo volver a medir

El lector sigue en la pantalla de mensajes directos. Se enciende con `?vv=1` en la URL o con
un **pulsado largo sobre la cabecera del chat**, y queda guardado. La lectura sana es:

```
alto win 874   pantalla 874   falta 0   PEOR win 874
```

Si `PEOR win` baja de 874 de forma estable, el viewport volvió a descuadrarse: mirar **primero
el inset de arriba**, no el de abajo.
