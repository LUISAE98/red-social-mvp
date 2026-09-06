# El escalón negro de la PWA iOS

**Resuelto y verificado en el aparato el 2026-09-03.**

Este documento existe porque el fallo se arregló cuatro veces antes y volvió cuatro veces, y
porque dentro de la sesión que lo cerró hubo **tres diagnósticos equivocados** más. Se deja
constancia de todos, con lo que los desmintió: son más útiles que el resultado, porque enseñan
qué clase de evidencia parecía concluyente y no lo era.

Resumen en una línea: **el número venía de ARRIBA aunque el hueco se viera ABAJO.**

---

## El síntoma

En la **app instalada en iPhone** aparecía una franja negra pegada al borde inferior. Lo que
la hacía escurridiza:

* **Era pasajera.** Se ponía y se quitaba sola. En el splash de refresco se veía aparecer y
  desaparecer durante la propia animación.
* **Salía en superficies sin nada en común aparente**: el hilo de mensajes directos, las
  pasarelas de pago, los paneles de solicitud de experiencias, el splash.
* **Las capturas salían limpias.** Para cuando el dedo llegaba al botón, ya se había
  enderezado.
* En Safari normal no se reproducía. Solo en la app instalada, y **solo en iPhone**: el
  interruptor que lo causa es un meta exclusivo de Apple.

## Por qué fallaron los cuatro intentos previos

Todos dieron por hecho que era espacio reservado para el safe-area inferior y fueron a
quitarlo. **No había nada que quitar:**

* `env(safe-area-inset-bottom)`: cero usos activos. Las apariciones en `globals.css` estaban
  todas dentro de comentarios.
* `--vb-safe-bottom`: definida una sola vez, como `0px`, nunca redefinida, nunca escrita desde
  JavaScript. Sus ~111 consumidores evaluaban a cero.

El barrido que se iba a hacer por quinta vez no habría cambiado un solo píxel.

## El instrumento

El fallo solo se reproduce en un iPhone físico **con la app instalada**, así que no se podía
mirar desde el escritorio. Se construyó un lector de geometría dentro de la propia pantalla de
mensajes. Cuatro cosas resultaron imprescindibles, y **las cuatro se descubrieron fallando**:

1. **Leer la geometría VIVA del navegador, no la copia en el estado de React.** La primera
   versión enseñaba `viewport.height`, que es nuestra copia; y la pregunta era justamente si
   esa copia coincidía con el navegador. Con el valor de antes, las dos hipótesis contrarias
   se veían idénticas y el lector **confirmaba la que uno ya trajera puesta**.
2. **Poder encenderlo desde dentro de la app instalada.** Solo se encendía con `?vv=1` en la
   URL, y en la PWA no hay barra de direcciones: el único sitio donde se podía medir el fallo
   era el único sitio donde no se podía encender el instrumento. Se le añadió un **pulsado
   largo sobre la cabecera del chat**.
3. **Retener la peor lectura, fotograma a fotograma.** El encogimiento dura menos que una
   captura, y muestrear cada 250 ms lo dejaba pasar entre dos medidas.
4. **Enseñar si el arreglo se está EJECUTANDO, no solo si funciona.** Ver el tercer
   diagnóstico fallido, más abajo. Sin esta línea, "no funciona" y "no se ejecuta" se ven
   exactamente igual.

## La medida

iPhone 16 Pro, app instalada:

```
copia 812 @0        ← nuestra copia del viewport visual
vivo  812 @0        ← lo que dice el navegador: IGUALES, y sin desplazamiento
alto win 812        ← el área de dibujo
pantalla 874        ← la pantalla física
seguro ↑62 ↓34      ← los márgenes que reporta iOS
lvh 874  dvh 812    ← lvh aguanta el alto real; dvh se hunde con el área
falta 62
PEOR win 471  lvh 874  dvh 812   ← con el teclado abierto, lvh SIGUE en 874
```

Tres conclusiones inmediatas, las tres contra lo que se suponía:

* **No había ningún desplazamiento del viewport visual** (`@0`), y nuestra copia no iba
  atrasada (`copia == vivo`). Las dos hipótesis de partida, muertas.
* **El teclado no tenía nada que ver.** El escalón estaba con `teclado 0`, `foco no` y cero
  eventos de viewport.
* **iOS reportaba los márgenes de una pantalla de 874 mientras entregaba un área de 812.**
  Un inset superior de 62 con el área anclada arriba, y uno inferior de 34 que solo tiene
  sentido si el área llegara a 874.

Y 874 − 812 = **62**, exactamente lo que ocupa la barra de estado.

## La causa

**`statusBarStyle: "black-translucent"` mete el lienzo por debajo de la barra de estado, y iOS
no le suma esos píxeles al área de dibujo.**

Es un solo interruptor con dos consecuencias, y ahí está el nudo: **es el mismo que da el
efecto traslúcido de arriba.** No son dos ajustes peleándose; es una decisión vista por sus
dos caras.

* **El lienzo** —la superficie física donde se pinta— mide la pantalla entera, 874. Eso es lo
  que le da a `.safeAreaGlass` un inset que cubrir, y lo que hace que el reloj y la batería se
  lean sobre el cristal.
* **El área de dibujo** —contra la que resuelven `inset: 0`, `bottom: 0` y `100dvh`— se queda
  en 812.

Los 62px de diferencia sobran por abajo y dejan ver el lienzo desnudo, que es negro.

Era pasajero porque iOS rehace esa cuenta en cada transición —el splash al refrescar, abrir un
panel, cerrar el teclado— y tarda unos fotogramas en cuadrarla. Lo que se pintara dentro de
esa ventana salía 62px corto y se quedaba así.

### La tabla de verdad, medida en el aparato

Tres ciclos de instalación, tres experimentos:

| | `display` | `statusBarStyle` | Traslúcido arriba | Escalón abajo |
|---|---|---|---|---|
| **A** (original) | `fullscreen` | `black-translucent` | ✅ | ❌ presente |
| **B** | `fullscreen` | `black` | ❌ cortado | ✅ ausente |
| **C** | `standalone` | `black-translucent` | ✅ | ❌ presente |

Las dos columnas de la derecha **se mueven siempre juntas**. No existe configuración que dé
las dos cosas: por eso el arreglo final no elige, compensa.

## Los tres diagnósticos equivocados, y qué los desmintió

**1. «Es `black-translucent`, sobra el mecanismo viejo.»**
Quitarlo (estado B) hizo desaparecer el escalón, y eso se tomó por prueba. Funcionó por
reducción, no por arreglo: iOS pasó a insetar el lienzo bajo una barra opaca y todo quedó
coherente **a costa de media pantalla**. Se llevó por delante `.safeAreaGlass`, que es diseño
deliberado, y el traslúcido se cortó en seco.
→ *Desmentido por el usuario, que vio el corte de arriba.*

**2. «Es el `display: fullscreen` del manifest.»**
Encajaba con los números —iOS daba al lienzo el tamaño de fullscreen y hacía las cuentas de
standalone— y además era un residual que este mismo documento había descartado por inofensivo.
→ *Desmentido por el estado C: se cambió a `standalone` y el escalón volvió igual.*

**3. «La compensación no sirve.»**
El primer intento de compensar no cambió nada, y pareció que el enfoque estaba mal. No lo
estaba: la regla iba dentro de `@media (display-mode: standalone)` y **iOS reporta
`fullscreen`** aunque enseñe la barra de estado. La media query no casaba nunca, la variable
se quedaba en `0px` y no se ejecutaba nada.
→ *El dato llevaba horas en el lector —`modo fullscreen`— sin que nadie lo atara.*

> **La lección, tres veces aprendida:** que un síntoma desaparezca no demuestra que hayas
> encontrado la causa, y que un arreglo no cambie nada no demuestra que sea incorrecto.
> Antes de descartar un enfoque, comprobar que **se está ejecutando**.

## El arreglo

Se conserva `black-translucent` —el traslúcido es diseño deliberado— y se compensa la
diferencia. En `app/globals.css`:

```css
:root {
  --vb-lienzo-extra: 0px;
  --vb-alto-pantalla: calc(100dvh + var(--vb-lienzo-extra));
  /* La misma resta, con topes, para lo que se ancla con `bottom`. */
  --vb-anclaje-abajo: clamp(0px, var(--vb-lienzo-extra), 120px);
}

/* 🚨 LOS DOS MODOS. Cubrir solo `standalone` costó un ciclo entero. */
@media (display-mode: standalone), (display-mode: fullscreen) {
  :root { --vb-lienzo-extra: calc(100lvh - 100dvh); }
}
```

Funciona porque **`lvh` midió el lienzo de verdad en todas las lecturas**: 874 incluso con el
teclado abierto y el área hundida a 471. No se movió ni una vez. Por eso la diferencia se
calcula en vez de adivinarse, y por eso esto no es un número mágico.

Se aplica de tres formas, según cómo esté anclada cada superficie:

| Anclaje | Antes | Ahora | Sitios |
|---|---|---|---|
| Por alto | `100dvh` | `var(--vb-alto-pantalla)` | 76 en 45 archivos |
| Por abajo | `bottom: 0` | `bottom: calc(0px - var(--vb-anclaje-abajo))` | 7 |

### 🚨 Lo que se ancla abajo va ACOTADO, y lo que mide la pantalla no

La resta es correcta en reposo, pero **no es estable**: como ya se cuenta más arriba, iOS
rehace la cuenta del área de dibujo en cada transición y tarda unos fotogramas. Eso afecta
distinto a las dos formas de usarla:

* **Por alto** (`--vb-alto-pantalla`): sale un alto raro un instante y se corrige solo. Se
  queda **sin topes**, porque ahí el valor grande es el correcto — con el teclado abierto, lo
  que mide la pantalla entera sigue siendo el lienzo entero.
* **Por abajo** (`--vb-anclaje-abajo`): un valor absurdo manda la superficie fuera de sitio
  y **ahí se queda**. Le pasó al nav inferior, que aparecía a media pantalla en la app
  instalada. Por eso va con `clamp`.

Los dos extremos que cierra el `clamp`:

* **Por abajo, negativos.** `lvh` nunca debería ser menor que `dvh`, pero si iOS lo reporta
  al revés un solo fotograma, la resta se vuelve negativa y el ancla **sube**.
* **Por arriba, el teclado.** Con el teclado abierto `dvh` se desploma a 471 contra los 874
  de `lvh`: 400px de resta, cuando lo que hay que compensar es la barra de estado, 62px.

El tope de 120px es holgado para cualquier barra de estado de iOS —la mayor ronda los 59— y
queda muy por debajo de cualquier desplome de teclado.
| Con `inset: 0` | *(nada)* | se le añade `height: var(--vb-alto-pantalla)` | 7 estructurales |

En el tercer caso el elemento queda sobre-restringido —`top`, `bottom` y `height` a la vez— y
CSS descarta `bottom`. Es justo lo que se busca: manda el alto, y el borde inferior cae donde
de verdad acaba la pantalla.

### Por qué va acotado a la app instalada

⚠️ **A propósito.** En Safari normal `lvh` ignora la barra del navegador, así que fuera de la
app instalada esa resta valdría el alto de esa barra y escondería contenido por debajo. Fuera
de la PWA, `--vb-alto-pantalla` es exactamente `100dvh` y no cambia absolutamente nada.

`minimal-ui` **no** se incluye: ahí sí hay barra de navegador.

**Se cura sola.** El día que Apple cuadre las dos cuentas, la resta da 0 y no hay nada que
revertir.

### El splash, que es la excepción

`#desktop-refresh-splash` se pinta desde un `<style>` en el `<head>`, **antes de que cargue
`globals.css`**. Ahí la variable llegaría vacía, así que lleva su propia media query escrita a
mano. Es el único sitio donde la regla está duplicada, y es donde más falta hace que valga
desde el primer fotograma.

⚠️ Ese bloque vive dentro de un template literal: **un acento invertido en un comentario lo
parte en seco.** Ya pasó al escribir esto.

## Lo que deliberadamente NO se hizo

**No se convirtieron las 127 superficies `position: fixed` con `inset: 0`** que encontró el
barrido, solo 7. Un scrim de modal que quede 62px corto deja ver lo que hay detrás, no negro;
las que se tocaron son las que **SON** la pantalla —el shell, los overlays de pantalla
completa y el panel compartido— porque esas dejan ver el lienzo.

Tampoco se tocaron las ~60 lecturas de `window.innerHeight`: sirven para medir el área de
dibujo, que es lo que quieren medir.

## Auditoría de la plataforma

Se barrió buscando el mismo patrón —superficies que deben alcanzar un borde físico ancladas a
una geometría que no es la pantalla— y otras declaraciones que se contradigan sobre geometría:

| Comprobación | Resultado |
|---|---|
| Otros `export const viewport` | ✅ solo `app/layout.tsx` |
| Otras declaraciones `appleWebApp` / `statusBarStyle` | ✅ solo `app/layout.tsx` |
| `<meta viewport>` crudos en el árbol | ✅ ninguno |
| `100vh` (4 apariciones) | ✅ son respaldos de un degradado, no anclajes |
| Consumidores de `env(safe-area-inset-top)` (68) | ✅ 48 con base propia, el resto sin solape |
| `env(safe-area-inset-bottom)` activo | ✅ ninguno |
| Código que consulta `display-mode` | ✅ ninguno, aparte del propio lector |

El fallo tenía **una sola fuente**. Las 127 superficies y las ~60 lecturas de `innerHeight`
eran víctimas, no causas.

### Residuales conocidos, a propósito sin tocar

1. **`display` del manifest.** Está en `standalone`. Se cambió desde `fullscreen` creyendo que
   era la causa; no lo era. Se deja así porque iOS nunca implementó `fullscreen` —lo reporta
   por `display-mode` mientras enseña la barra de estado— y `standalone` es el valor honesto.
   **Coste:** en Android la app deja de ser fullscreen y reaparece la barra de estado allí.
   Volver a `fullscreen` es seguro para el escalón, porque la compensación cubre los dos
   modos. Es una decisión de producto sobre Android, no técnica.
2. **`orientation: "portrait"` en el manifest** frente al código que sí maneja horizontal
   (`LiveViewerModal`, `PostImageViewer`, `MeetGreetPreparationFullscreen`, `ReelStorySlide`).
   Android respeta el bloqueo y iOS no, así que ese código solo corre en iOS. Decisión de
   producto, no fallo.

## Seguro contra la quinta vez

`test/unit/pantallaCompleta.test.ts` falla si:

* alguien reintroduce `100dvh` suelto en vez de `var(--vb-alto-pantalla)`,
* la compensación deja de definirse una sola vez, o de valer `0px` por defecto,
* la media query deja de cubrir **los dos** modos de app instalada,
* desaparece `black-translucent`, que es lo que da el traslúcido de arriba,
* desaparece `viewportFit: "cover"`,
* se declara `viewport` o `appleWebApp` fuera de `app/layout.tsx`,
* alguien vuelve a usar `env(safe-area-inset-bottom)`,
* `--vb-safe-bottom` deja de definirse una sola vez en cero.

El lector del DM está eximido de los vetos a `100dvh` y a `env(safe-area-inset-bottom)`: ahí
esas unidades **no se consumen para maquetar, se miden**.

## Cómo volver a medir

El lector sigue en la pantalla de mensajes directos. Se enciende con `?vv=1` en la URL o con
un **pulsado largo sobre la cabecera del chat**, y queda guardado. La lectura sana es:

```
alto win 812   pantalla 874   falta 62     ← esto es NORMAL y no se va a arreglar
lvh 874  dvh 812
VAR 874  → aplicada                        ← ESTA es la que importa
PEOR win 874 …
```

`falta 62` es el fallo de iOS, y ahí seguirá. Lo que dice que estamos bien es **`VAR`**: dentro
de la app instalada tiene que valer lo mismo que `lvh`. Si vale lo mismo que `dvh`, la media
query no está casando y la compensación no se está ejecutando.

### Si el escalón vuelve

1. **Mirar `VAR` primero.** Si dice `NO APLICADA`, el problema es el interruptor, no la
   aritmética. Es lo que pasó en el tercer diagnóstico fallido.
2. Si dice `aplicada` y aun así hay franja, es que **esa pantalla** usa un anclaje sin cubrir:
   `100dvh` suelto, un `bottom: 0` sin la resta, o un `inset: 0` estructural sin alto. La
   prueba automática cubre el primer caso.
3. Estado de emergencia conocido: `statusBarStyle: "black"` quita el escalón con seguridad, a
   costa del traslúcido de arriba. Es una línea, y **requiere reinstalar la app**.

⚠️ **iOS guarda `appleWebApp` y el manifest al INSTALAR.** Cualquier cambio ahí exige borrar la
app de la pantalla de inicio y volver a añadirla; recargar no basta. La compensación de CSS,
en cambio, se ve recargando.
