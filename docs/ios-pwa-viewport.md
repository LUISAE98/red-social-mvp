# El escalón negro de la PWA iOS

Resuelto el **2026-09-03**, tras cuatro intentos fallidos.

Este documento existe porque el fallo se arregló cuatro veces y volvió cuatro veces. Los tres
primeros intentos están documentados en comentarios del código. Todos buscaron en el sitio
equivocado, y por una razón que merece quedar escrita.

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

`app/layout.tsx` declaraba **los dos mecanismos de pantalla completa a la vez**:

| Declaración | Qué es |
|---|---|
| `statusBarStyle: "black-translucent"` | El mecanismo **viejo** de Apple, anterior a que existieran los safe-area |
| `viewportFit: "cover"` | El mecanismo **moderno** |

Piden lo mismo por caminos distintos. Juntos, iOS estiraba el lienzo a la pantalla entera
(874) pero calculaba el área de dibujo como si no lo hubiera estirado (812). El área quedaba
anclada arriba, así que esos 62px huérfanos **se caían por abajo** y dejaban ver el fondo
negro del lienzo.

Era pasajero porque iOS rehace esa cuenta en cada transición —el splash al refrescar, abrir
un panel, cerrar el teclado— y tarda unos fotogramas en cuadrarla. Lo que se pintara dentro
de esa ventana salía 62px corto y se quedaba así.

## El arreglo

Una línea: se quitó el mecanismo viejo.

```ts
// app/layout.tsx
appleWebApp: {
  capable: true,
  statusBarStyle: "black",   // era "black-translucent"
  title: "Vibra",
},
```

⚠️ **iOS guarda esta preferencia al INSTALAR.** Para ver el cambio hay que borrar la app de la
pantalla de inicio y volver a añadirla. Recargar no basta, y eso hizo perder tiempo.

Efecto secundario aceptado: el degradado morado ya no se ve por detrás de la barra de estado,
que pasa a ser negra opaca. Sobre fondo negro no se distingue.

## Lo que deliberadamente NO se hizo

**No se convirtieron a `100lvh` las 127 superficies `position: fixed` con `inset: 0`**
repartidas en 70 archivos, ni las ~60 lecturas de `window.innerHeight`. `lvh` sí se mantuvo
fiable en las medidas (874 incluso con el teclado abierto), así que la conversión habría
funcionado — y habría sido un parche en 70 archivos que deja el viewport mal por debajo. Esas
superficies eran **víctimas, no causas**: con la raíz arreglada, `inset: 0` vuelve a
significar "la pantalla".

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

### Residuales conocidos, a propósito sin tocar

1. **`display: "fullscreen"` en `public/manifest.json`.** iOS no lo cumple —lo reporta como
   fullscreen mientras enseña la barra de estado— así que `matchMedia("(display-mode: ...)")`
   miente en iOS. Hoy no lo consulta nadie, así que no rompe nada. **No se cambió porque
   Android sí lo cumple**, y ponerlo en `standalone` devolvería la barra de estado allí. Si
   algún día hace falta consultar el modo, hay que resolver esto primero.
2. **`orientation: "portrait"` en el manifest** frente al código que sí maneja horizontal
   (`LiveViewerModal`, `PostImageViewer`, `MeetGreetPreparationFullscreen`, `ReelStorySlide`).
   Android respeta el bloqueo y iOS no, así que ese código solo corre en iOS. Es una decisión
   de producto, no un fallo.

## Seguro contra la quinta vez

`test/unit/pantallaCompleta.test.ts` falla si:

* reaparece `black-translucent` en algún sitio activo,
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
