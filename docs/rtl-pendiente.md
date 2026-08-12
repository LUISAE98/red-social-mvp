# RTL: qué está hecho y qué falta

Estado al integrar el árabe (`ar`), el primer y único locale de derecha a izquierda
de Vibra. Lo escribo porque el trabajo quedó **a medias a propósito**, y sin este
documento la mitad hecha parece la totalidad.

## Qué está hecho

**La capa de texto.** `<html dir="rtl">` sale de `RTL_LOCALES` en `i18n/locales.ts`
a través de `localeDir()`, y lo consume `app/layout.tsx`. Eso arregla lo que el
navegador resuelve solo:

- orden de los caracteres y de las palabras dentro de cada bloque de texto;
- posición de los signos de puntuación (el punto va a la izquierda, no a la derecha);
- dirección de escritura dentro de `<input>` y `<textarea>`;
- alineación por defecto del texto;
- orden de los números mezclados con texto árabe (algoritmo bidi de Unicode).

Esto **no era opcional**. Sin `dir`, el árabe no se ve "sin espejar": se ve mal a
nivel de carácter, que es un fallo mucho más grave que una barra lateral en el lado
equivocado.

**La traducción.** `messages/ar.json`, 2540 claves, con las 6 categorías de plural
que exige CLDR para el árabe (`zero`, `one`, `two`, `few`, `many`, `other`) en los
40 mensajes con plural. Ningún otro idioma de Vibra usa más de 3.

## Qué NO está hecho

**El espejado visual de la interfaz.** La app posiciona con propiedades **físicas**
(`left`, `right`, `marginLeft`, `paddingRight`…) en estilos inline de TSX, no con
propiedades lógicas (`inset-inline-start`, `margin-inline-start`…). Las físicas
**no** se voltean con `dir="rtl"`: son literalmente "izquierda" y "derecha", no
"inicio" y "fin".

Inventario real, medido sobre `app/`, `components/` y `lib/`:

| Propiedad | Ocurrencias | Riesgo al convertir |
|---|---|---|
| `left:` / `right:` (posicionamiento) | 554 | **Alto.** Cada una hay que leerla: no todas son direccionales (hay gradientes, `transform`, overlays centrados) y el intento a ciegas rompe LTR sin dar error |
| `textAlign: "left" \| "right"` | 83 | Bajo. `start` / `end` son equivalentes exactos |
| `marginLeft` / `marginRight` | 85 | Bajo. `marginInlineStart` / `End` |
| `paddingLeft` / `paddingRight` | 70 | Bajo |
| `borderLeft` / `borderRight` | 15 | Bajo |

Total ≈ 807 puntos, repartidos en unos 140 archivos.

**Los 253 de riesgo bajo** (`textAlign`, `margin`, `padding`, `border`) son una
conversión mecánica y segura: la propiedad lógica se comporta igual que la física
en LTR, así que convertirlas no cambia nada para los otros 40 idiomas.

**Los 554 `left:`/`right:`** son el trabajo de verdad y no se pueden barrer con un
regex. Hay que abrir cada uno y decidir si es dirección de lectura (botón de cerrar,
badge, cajón lateral → `inset-inline-*`) o geometría absoluta que debe quedarse
donde está (un degradado, un `transform`, un overlay a pantalla completa).

### Archivos con más carga, por si se ataca por partes

| Archivo | Puntos |
|---|---|
| `app/[locale]/groups/[groupId]/components/posts/PostImageViewer.tsx` | 31 |
| `app/[locale]/(protected)/u/[handle]/ProfileClient.tsx` | 31 |
| `app/[locale]/groups/[groupId]/components/posts/GroupPostCard.tsx` | 30 |
| `app/[locale]/(protected)/layout.tsx` | 30 |
| `app/components/LiveViewerModal/LiveViewerModal.tsx` | 28 |
| `app/[locale]/groups/layout.tsx` | 25 |
| `app/[locale]/(protected)/SavedPostsFeed.tsx` | 21 |
| `app/components/OwnerSidebar/GreetingReviewOverlay.tsx` | 18 |
| `app/components/LiveChat/LiveCreatorPanel.tsx` | 18 |

## Qué ve hoy un usuario en árabe

Los textos se leen correctamente y los formularios funcionan. Pero la **maquetación
sigue siendo de izquierda a derecha**: la barra lateral queda donde estaba, los
botones de cerrar en la esquina de siempre, las flechas de "siguiente/anterior"
apuntan al lado contrario del sentido de lectura, y las sangrías de los hilos de
comentarios crecen hacia el lado equivocado.

Es utilizable y es honesto llamarlo incompleto. **No es el estado final.**

## Cómo comprobarlo sin ser hablante de árabe

`dir="rtl"` no depende del idioma. Para ver la maquetación espejada sin leer árabe,
fuerza el atributo desde la consola del navegador en cualquier locale:

```js
document.documentElement.dir = "rtl";
```

Todo lo que se desmonte ahí es exactamente lo que le pasa a un usuario árabe.
