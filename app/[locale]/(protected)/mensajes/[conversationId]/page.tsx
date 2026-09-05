"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlurFade, IconButton } from "@/components/ui";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useVisualViewport } from "@/lib/hooks/useVisualViewport";
import { resettleVisualViewport } from "@/lib/hooks/resettleVisualViewport";
import { useAuth } from "@/app/providers";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import ProfileMoreMenu from "@/app/[locale]/(protected)/u/[handle]/components/ProfileMoreMenu";
import ConversationThread from "@/components/chat/ConversationThread";
import {
  ChatConversationMenuItems,
  ChatRemoveConversationDialog,
} from "@/components/chat/ChatConversationActions";
import { useConversationDoc } from "@/lib/chat/useConversationDoc";
import { useProfileMini } from "@/lib/chat/useProfileMini";
import { getOtherParticipant } from "@/lib/chat/types";
import { useScreenReady } from "@/lib/useScreenReady";

/**
 * Conversación a pantalla completa (celular).
 *
 * Se pinta en un PORTAL a `document.body`, no en su sitio del árbol. El layout
 * protegido aplica un `transform` a `.mainInner`, y eso crea un contexto de
 * apilamiento que atrapa a los `position: fixed` descendientes: por muy alto que
 * fuera el z-index, la barra inferior de navegación seguiría tapando el campo de
 * escritura. El portal es lo único que escapa de ese contexto.
 *
 * El interlocutor se deduce del propio ID del hilo (`uidA_uidB`, ordenado), así
 * que la URL no necesita llevarlo y el enlace se puede compartir tal cual.
 */
/** Misma duración que la animación de navegación global de `globals.css`. */
const NAV_ANIM_MS = 280;

/**
 * Cuánto BAJA el desenfoque de la cabecera dentro del hilo, y cuánto dura el
 * fundido. Ahí es donde el mensaje que sube se disuelve en vez de cortarse
 * contra una línea de 1px.
 */
const HEADER_FADE_OVERHANG = 26;
const HEADER_FADE_LENGTH = 40;

/**
 * Interruptor del lector de geometria, guardado para que aguante una recarga.
 *
 * Vive fuera del componente porque lo leen dos sitios (el valor inicial y el
 * pulsado largo) y no depende de ningun render.
 */
const LECTOR_LLAVE = "vb:lector-viewport";

function leerLector(): boolean {
  if (new URLSearchParams(window.location.search).has("vv")) return true;
  try {
    return window.localStorage.getItem(LECTOR_LLAVE) === "1";
  } catch {
    return false;
  }
}

function guardarLector(valor: boolean): void {
  try {
    window.localStorage.setItem(LECTOR_LLAVE, valor ? "1" : "0");
  } catch {
    // Navegacion privada de iOS: el lector sigue encendido en esta pantalla,
    // solo que no sobrevive a recargar. Sirve igual para tomar la medida.
  }
}

/**
 * ¿Este elemento hace salir el teclado?
 *
 * Solo lo que acepta texto: un `<textarea>`, un `<input>` de escribir o algo
 * editable. Un botón, un enlace o un globo de mensaje con `tabIndex` reciben el
 * foco igual, pero NO abren teclado, y confundirlos con el campo de escritura es
 * lo que dejaba la pantalla calzada a media altura.
 *
 * `input type="file"` queda fuera a propósito: es el botón de la foto.
 */
const TIPOS_SIN_TECLADO = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "image",
]);

function abreTeclado(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !TIPOS_SIN_TECLADO.has(target.type);
  return target.isContentEditable;
}

export default function ConversationPage() {
  const params = useParams<{ conversationId?: string | string[] }>();
  const router = useRouter();
  const tCommon = useTranslations("common");
  const { user } = useAuth();

  const raw = params?.conversationId;
  const conversationId = Array.isArray(raw) ? raw[0] : (raw ?? null);
  const selfUid = user?.uid ?? null;

  const otherUid =
    conversationId && selfUid
      ? getOtherParticipant(conversationId.split("_"), selfUid)
      : null;

  const { profile } = useProfileMini(otherUid);
  // Solo para saber si el hilo está silenciado; el propio hilo ya se suscribe
  // por su cuenta y el listener es el mismo documento.
  const { conversation } = useConversationDoc(conversationId);

  /**
   * Avisa al splash de arranque en cuanto la cabecera tiene nombre.
   *
   * Es la pantalla a la que lleva la notificación de un mensaje, así que es
   * también la que más se abre en frío. Sin este aviso el splash esperaba al
   * respaldo de DesktopRefreshSplash, y entrar desde un aviso era mirar el
   * splash sin motivo. No se espera a los mensajes: llegan por onSnapshot y el
   * hilo ya tiene su propio esqueleto.
   */
  useScreenReady(!!profile || !conversationId);
  const displayName = profile?.displayName || tCommon("user");

  /**
   * Hacia dónde se va la pantalla al salir.
   *  - "back": atrás, se va por la derecha.
   *  - "forward": al perfil, se va por la izquierda y el perfil entra desde la
   *    derecha, que es como se lee una navegación hacia adelante.
   */
  const [closing, setClosing] = useState<null | "back" | "forward">(null);
  /**
   * Vive AQUÍ y no dentro del menú: el menú se desmonta al cerrarse, y con él
   * se llevaba el panel de confirmación a los pocos milisegundos de abrirlo.
   */
  const [removeOpen, setRemoveOpen] = useState(false);

  // El portal solo puede montarse en cliente. Mismo patrón (y misma excepción
  // de lint) que en el resto de páginas que detectan el montaje.
  const [mounted, setMounted] = useState(false);
  /**
   * Alto real de la cabecera. Va SUPERPUESTA al hilo —los mensajes tienen que
   * pasarle por detrás para que el desenfoque tenga algo que difuminar—, así
   * que el hilo necesita ese hueco arriba y un margen negativo que lo suba.
   * Se mide en vivo y no se fija: aquí el relleno superior lleva el safe-area,
   * que cambia de un aparato a otro.
   */
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(60);

  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      // El BORDE, no `contentRect`: el relleno propio de la cabecera es justo
      // lo que hay que reservar, y `contentRect` lo excluye.
      const border = entries[0]?.borderBoxSize?.[0]?.blockSize;
      const next = Math.ceil(border ?? node.getBoundingClientRect().height);
      // Cero significa que está oculta, no que mida cero. Guardarlo dejaría el
      // hueco del hilo en nada y el efecto sin tamaño hasta la siguiente medida.
      if (next > 0) setHeaderHeight(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
    // ⚠️ `mounted`, no `[]`. La pantalla entera sale por un portal y hasta que
    // no monta hay un `return null` por delante: con dependencias vacías el
    // efecto corría UNA vez con la referencia todavía en null y no volvía a
    // correr nunca, así que la cabecera nunca se llegaba a medir.
  }, [mounted]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  /**
   * El fondo no se mueve mientras el chat está abierto.
   *
   * No es solo higiene: si el documento de debajo puede desplazarse, iOS lo
   * desplaza al enfocar el campo de escritura para "hacer sitio" al teclado, y
   * entonces la compensación del visual viewport pelea contra ese movimiento.
   * Con el fondo quieto, lo único que se mueve es el viewport visual, que es
   * justo lo que el efecto de abajo sabe seguir.
   */
  useBodyScrollLock(mounted);

  /**
   * Geometría de la pantalla frente al teclado.
   *
   * En iOS el teclado NO encoge el viewport de LAYOUT, que es contra el que se
   * ancla un "position: fixed": solo encoge el VISUAL y lo desplaza dentro del
   * otro. Sin compensarlo, la cabecera se sale por arriba y el campo de
   * escritura queda debajo del teclado.
   *
   * Se resuelve con "useVisualViewport" y con la MISMA forma que el panel de
   * comentarios, que es el patrón que ya funciona en el resto de la plataforma:
   *
   *  - Con teclado: "top"/"height" del viewport visual, así la pantalla calza
   *    exactamente el área que se ve.
   *  - Sin teclado: "inset: 0" y NINGÚN número. Estira el propio viewport.
   *
   * Ese segundo punto es el que estaba roto. Antes se escribía un alto medido (o
   * "100dvh") también al cerrar, y a mano sobre el nodo. Como React no reescribe
   * un estilo que no cambia entre renders, ese valor se quedaba pegado y salía la
   * franja negra abajo. Declarándolo, cerrar el teclado BORRA "top"/"height" en
   * vez de recalcularlos: no queda número que pueda envejecer.
   */
  /**
   * Y ADEMÁS el campo tiene que tener el foco.
   *
   * Sin esta segunda condición seguía apareciendo la franja negra en Safari: si
   * iOS no emite el evento de `visualViewport` al retirarse el teclado — y a
   * veces no lo emite —, la geometría se queda con el alto de cuando estaba
   * abierto y la pantalla no vuelve al borde. El foco no depende de ese evento:
   * si el campo se soltó, no hay teclado, punto. Da igual lo que diga la
   * geometría rezagada.
   */
  const [composerFocused, setComposerFocused] = useState(false);

  // El foco se le pasa al hook como aviso: es la señal de que la geometría va a
  // moverse, y con ella el hook vuelve a leerla varias veces mientras el teclado
  // se va, en vez de esperar un evento que iOS puede no mandar.
  const viewport = useVisualViewport(composerFocused);
  const keyboardPx =
    viewport != null && typeof window !== "undefined"
      ? Math.max(0, Math.round(window.innerHeight - viewport.height))
      : 0;
  // Mismo umbral que el resto del producto: la barra del navegador ya deja
  // 40-80px de diferencia sin que haya ningún teclado.
  const keyboardFitsGeometry = keyboardPx > 120;

  const keyboardOpen = composerFocused && keyboardFitsGeometry;

  /**
   * El viewport visual puede quedarse CORRIDO aunque no haya teclado.
   *
   * Mientras el chat está abierto el fondo va bloqueado con `overflow: hidden`,
   * así que iOS no puede desplazar el DOCUMENTO para hacerle sitio al teclado y
   * desplaza el viewport VISUAL dentro del de layout. Al cerrarse no siempre lo
   * devuelve a cero.
   *
   * Antes, sin teclado se caía a `inset: 0` sin mirar esto, y `inset: 0` ancla al
   * viewport de LAYOUT: la pantalla quedaba calzada contra un área distinta de la
   * que se ve, el campo de escritura no volvía abajo y salía la franja. Mientras
   * siga corrido hay que seguir calzando el área visible, haya teclado o no.
   */
  const viewportCorrido = viewport != null && viewport.offsetTop > 0;

  /**
   * ⚠️ Desplazar la pantalla hacia abajo SOLO con el teclado abierto de verdad.
   *
   * Esto es lo que abría el chat a media pantalla, con el feed asomando arriba.
   * `viewportCorrido` también encendía el calzado, y calzar escribe
   * `top: offsetTop`: si esa lectura venía de cuando el teclado estaba abierto
   * —iOS no siempre avisa de que se fue, y con el fondo bloqueado tampoco tiene
   * dónde devolver el viewport—, el chat se dibujaba empezando a media altura y
   * ahí se quedaba.
   *
   * El propio archivo ya tenía la respuesta unas líneas más arriba, para el
   * teclado: si el campo no tiene el foco, no hay teclado, diga lo que diga una
   * geometría rezagada. Faltaba aplicarlo también aquí.
   */
  const calzarConTeclado = keyboardOpen && viewport != null;

  /**
   * Sin teclado, el viewport corrido se compensa ALARGANDO, nunca bajando.
   *
   * El motivo de calzar sin teclado sigue siendo válido: con el fondo bloqueado,
   * iOS mueve el viewport visual y un `position: fixed` —anclado al de layout—
   * termina por debajo de lo que se ve, y sale la franja. Pero para eso basta con
   * que el borde de ABAJO caiga donde acaba el área visible; el de arriba no
   * tiene por qué moverse nunca.
   *
   * Y si la lectura estaba rezagada, `offsetTop + height` suma la pantalla
   * entera, así que el peor caso pasa a ser el correcto: pantalla completa.
   */
  const calzarSinTeclado = !calzarConTeclado && viewportCorrido && viewport != null;

  /**
   * Lector de geometría en pantalla. Ver más abajo.
   *
   * Se enciende de dos formas: con `?vv=1` en la URL, o dejando el dedo apretado
   * un segundo sobre la cabecera del chat.
   *
   * ⚠️ Lo segundo NO es un adorno. Este fallo solo se reproduce en la app
   * INSTALADA, y ahí no hay barra de direcciones donde escribir el parámetro: sin
   * un interruptor que viva dentro de la propia pantalla, el lector no se puede
   * encender justo donde hace falta.
   *
   * `null` significa "lo que diga la URL o lo guardado"; en cuanto se pulsa
   * largo pasa a mandar la elección. Se deriva en el render, no se mete en un
   * efecto, para no acabar en un `setState` dentro de `useEffect`.
   */
  const [lectorManual, setLectorManual] = useState<boolean | null>(null);

  const depurarViewport = useMemo(() => {
    if (!mounted || typeof window === "undefined") return false;
    if (lectorManual !== null) return lectorManual;
    return leerLector();
  }, [mounted, lectorManual]);

  /**
   * Pulsado largo sobre la cabecera para encender y apagar el lector.
   *
   * Es un temporizador y no un contador de toques porque la cabecera está
   * ocupada por dos botones que NAVEGAN —volver y abrir el perfil—, y a base de
   * toques sueltos el primero se llevaría la pantalla por delante antes de
   * llegar al último. `tragarClicDelPulsado` es lo que evita que el dedo, al
   * levantarse, abra además el perfil.
   */
  const pulsadoRef = useRef<{ temporizador: number | null; disparado: boolean }>({
    temporizador: null,
    disparado: false,
  });

  const soltarPulsado = useCallback(() => {
    const p = pulsadoRef.current;
    if (p.temporizador === null) return;
    window.clearTimeout(p.temporizador);
    p.temporizador = null;
  }, []);

  const empezarPulsado = useCallback(() => {
    const p = pulsadoRef.current;
    p.disparado = false;
    if (p.temporizador !== null) window.clearTimeout(p.temporizador);
    p.temporizador = window.setTimeout(() => {
      p.temporizador = null;
      p.disparado = true;
      setLectorManual((prev) => {
        const nuevo = !(prev ?? leerLector());
        guardarLector(nuevo);
        return nuevo;
      });
    }, 700);
  }, []);

  const tragarClicDelPulsado = useCallback((e: React.MouseEvent) => {
    if (!pulsadoRef.current.disparado) return;
    pulsadoRef.current.disparado = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Geometría VIVA, leída del navegador y no de nuestro estado.
   *
   * 🚨 SIN ESTO EL LECTOR NO SIRVE PARA LO QUE SE HIZO. Enseñaba `viewport.height`,
   * que es NUESTRA copia; y la pregunta que hay que responder es precisamente si
   * esa copia coincide con lo que dice el navegador:
   *
   *   · copia ≠ vivo  → el navegador ya se reasentó y los que vamos viejos somos
   *     nosotros. Se arregla en `useVisualViewport`.
   *   · copia = vivo, y vivo sigue corto o corrido → WebKit no ha devuelto el
   *     viewport a su sitio. Eso no se arregla releyendo: hay que forzar el
   *     reasiento.
   *
   * Con el valor de antes las dos ramas se veían idénticas, así que el lector
   * confirmaba cualquier hipótesis que uno ya trajera puesta.
   *
   * `eventos` cuenta lo que iOS emite: si no sube al cerrar el teclado, queda
   * demostrado que no avisa, que es la premisa de la que cuelgan las relecturas.
   *
   * Se relee por temporizador y no por evento a propósito — depender del evento
   * es justo lo que se está poniendo en duda. Solo corre con `?vv=1`.
   */
  const [vvVivo, setVvVivo] = useState<{
    alto: number;
    corrido: number;
    eventos: number;
    desdeUltimoMs: number;
    foco: string;
    /** `env(safe-area-inset-top)` y `-bottom`, medidos con una sonda. */
    segArriba: number;
    segAbajo: number;
    /** Lo que CSS cree que mide la pantalla, frente a `window.innerHeight`. */
    lvh: number;
    dvh: number;
    /** Lo que vale de verdad `--vb-alto-pantalla`. Si no iguala a `lvh` dentro
     *  de la app instalada, la compensación no se está aplicando. */
    varAlto: number;
    /**
     * La PEOR lectura vista, retenida.
     *
     * 🚨 ES LA ÚNICA FORMA DE VER ESTE FALLO. El encogimiento dura unos pocos
     * fotogramas: para cuando el dedo llega al botón de capturar, el viewport ya
     * volvió a su sitio y la foto sale limpia. Reteniendo el mínimo, basta con
     * provocar el fallo y capturar cuando se pueda.
     */
    peor: {
      win: number;
      lvh: number;
      dvh: number;
      vv: number;
      corrido: number;
      haceMs: number;
    } | null;
  } | null>(null);

  useEffect(() => {
    if (!depurarViewport) return;
    const vv = window.visualViewport;
    if (!vv) return;

    let eventos = 0;
    let ultimo = performance.now();
    const marcar = () => {
      eventos += 1;
      ultimo = performance.now();
    };
    vv.addEventListener("resize", marcar);
    vv.addEventListener("scroll", marcar);

    /**
     * Sonda para leer desde JavaScript cosas que solo existen en CSS.
     *
     * Los `env(safe-area-inset-*)` y las unidades `lvh`/`dvh` no se pueden
     * consultar con ninguna API; la única forma de saber cuánto valen es
     * pintarlas en un elemento y medirlo. Va oculto y fuera del flujo, así que
     * no puede mover nada de lo que se está midiendo.
     *
     * Son los números que separan las dos formas del fallo: si el inset de
     * ARRIBA vale lo mismo que le falta a `window.innerHeight` para llegar a la
     * pantalla, el viewport está anclado bajo la barra de estado y lo que sobra
     * queda fuera POR ABAJO.
     */
    const sonda = document.createElement("div");
    sonda.style.cssText =
      "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top,0px);" +
      "padding-bottom:env(safe-area-inset-bottom,0px);";
    const sondaLvh = document.createElement("div");
    sondaLvh.style.cssText = "width:0;height:100lvh;";
    const sondaDvh = document.createElement("div");
    // 🚨 `100dvh` A PELO, A PROPÓSITO. Aquí no se consume la unidad para
    // maquetar: se MIDE, para poder compararla con `lvh` y con la variable. Si
    // se cambia por `var(--vb-alto-pantalla)` el lector deja de poder distinguir
    // "la compensación no se aplicó" de "se aplicó y aun así queda corto".
    sondaDvh.style.cssText = "width:0;height:100dvh;";
    // Lo que de verdad está usando la plataforma. Si esto no vale lo mismo que
    // `lvh` dentro de la app instalada, la regla no se está aplicando.
    const sondaVar = document.createElement("div");
    sondaVar.style.cssText = "width:0;height:var(--vb-alto-pantalla);";
    sonda.append(sondaVar);
    sonda.append(sondaLvh, sondaDvh);
    document.body.appendChild(sonda);

    /**
     * Vigilancia fotograma a fotograma.
     *
     * Se mira en cada `requestAnimationFrame` y no en el temporizador de 250ms
     * porque el encogimiento puede durar menos que un tic: muestreando cada
     * cuarto de segundo se cuela entre dos medidas y parece que nunca pasó.
     */
    let peor: {
      win: number;
      lvh: number;
      dvh: number;
      vv: number;
      corrido: number;
      cuando: number;
    } | null = null;
    let raf = 0;
    const vigilar = () => {
      const win = window.innerHeight;
      if (!peor || win < peor.win) {
        peor = {
          win,
          lvh: Math.round(sondaLvh.getBoundingClientRect().height),
          dvh: Math.round(sondaDvh.getBoundingClientRect().height),
          vv: Math.round(vv.height),
          corrido: Math.round(vv.offsetTop),
          cuando: performance.now(),
        };
      }
      raf = requestAnimationFrame(vigilar);
    };
    raf = requestAnimationFrame(vigilar);

    const id = setInterval(() => {
      const activo = document.activeElement;
      setVvVivo({
        alto: Math.round(vv.height),
        corrido: Math.round(vv.offsetTop),
        eventos,
        desdeUltimoMs: Math.round(performance.now() - ultimo),
        foco: activo ? activo.tagName.toLowerCase() : "—",
        segArriba: Math.round(parseFloat(getComputedStyle(sonda).paddingTop) || 0),
        segAbajo: Math.round(parseFloat(getComputedStyle(sonda).paddingBottom) || 0),
        lvh: Math.round(sondaLvh.getBoundingClientRect().height),
        dvh: Math.round(sondaDvh.getBoundingClientRect().height),
        varAlto: Math.round(sondaVar.getBoundingClientRect().height),
        peor: peor
          ? {
              win: peor.win,
              lvh: peor.lvh,
              dvh: peor.dvh,
              vv: peor.vv,
              corrido: peor.corrido,
              haceMs: Math.round(performance.now() - peor.cuando),
            }
          : null,
      });
    }, 250);

    return () => {
      clearInterval(id);
      cancelAnimationFrame(raf);
      sonda.remove();
      vv.removeEventListener("resize", marcar);
      vv.removeEventListener("scroll", marcar);
    };
  }, [depurarViewport]);

  /** Dónde estaba el documento al entrar. Es el sitio al que hay que devolverlo. */
  const baseScrollRef = useRef(0);
  useEffect(() => {
    baseScrollRef.current = window.scrollY;
  }, []);

  /**
   * Devuelve el DOCUMENTO a su sitio cuando el teclado se retira.
   *
   * Esta es la causa de la franja que aparece SOLO tras abrir y cerrar el
   * teclado, y que no está al entrar: iOS desplaza el documento al enfocar el
   * campo, para "hacer sitio", y al cerrarse no siempre lo devuelve. Un
   * `position: fixed` se ancla al viewport de LAYOUT, así que ese desplazamiento
   * sobrante se ve como un hueco bajo el panel — aunque el panel siga midiendo
   * exactamente lo que debe.
   *
   * No basta con corregirlo una vez al perder el foco: iOS termina de mover las
   * cosas DESPUÉS, mientras el teclado se va. Por eso se queda escuchando el
   * viewport hasta que deja de moverse.
   *
   * Se devuelve a la posición que tenía al entrar, NO a cero: así el feed que
   * hay debajo no pierde dónde estaba al salir del chat.
   *
   * ⚠️ Ojo con lo que este efecto puede y no puede arreglar. Mientras el chat está
   * abierto el fondo va bloqueado con `overflow: hidden`, así que el documento NO
   * se puede desplazar y `window.scrollY` se queda en su valor de entrada pase lo
   * que pase: aquí dentro esto casi nunca tiene nada que hacer. Lo que iOS mueve
   * en ese caso es el viewport VISUAL, y eso no se corrige desplazando el
   * documento sino calzando la pantalla al área visible (`calzarConTeclado` y
   * Este efecto cubre el otro escenario, el de que el documento sí se haya
   * movido, y sobre todo la salida (ver el efecto de desmontaje de abajo).
   */
  useEffect(() => {
    if (!mounted) return;

    const restore = () => {
      // Con el teclado abierto ese desplazamiento es de iOS y hace falta.
      if (composerFocused) return;
      if (window.scrollY === baseScrollRef.current) return;
      window.scrollTo(0, baseScrollRef.current);
    };


    restore();

    const vv = window.visualViewport;
    vv?.addEventListener("scroll", restore);
    vv?.addEventListener("resize", restore);
    window.addEventListener("scroll", restore);

    return () => {
      vv?.removeEventListener("scroll", restore);
      vv?.removeEventListener("resize", restore);
      window.removeEventListener("scroll", restore);
    };
  }, [mounted, composerFocused]);

  /**
   * Al SALIR del chat, devolver el documento a su sitio pase lo que pase.
   *
   * El efecto de arriba se sale por el guard de foco, así que si se navega con el
   * campo todavía enfocado —que es justo lo que pasa al darle a atrás nada más
   * escribir— nunca llegaba a corregir nada, y el desplazamiento que había puesto
   * iOS se arrastraba a la lista de chats: el nav aparecía impulsado hacia arriba
   * como si hubiera un segundo safe-area, y no se enderezaba hasta navegar a otra
   * sección.
   *
   * Va SIN dependencias para que corra solo al desmontar, y DESPUÉS del
   * `useBodyScrollLock` de arriba: React limpia los efectos en el orden en que se
   * declararon, así que para cuando esto corre el fondo ya está desbloqueado y el
   * documento vuelve a poder desplazarse.
   */
  useEffect(() => {
    return () => {
      /* Sin condición, a propósito.
       *
       * Antes esto solo actuaba si `window.scrollY` se había movido — y con el
       * fondo bloqueado por `overflow: hidden` NUNCA se mueve, así que la
       * corrección no llegaba a ejecutarse justo en el caso para el que se
       * escribió. Lo que iOS deja torcido no es el scroll del documento sino el
       * viewport VISUAL, y eso hay que reasentarlo aparte: si no, al volver a la
       * lista de chats la barra inferior aparece más arriba de donde toca y no se
       * endereza hasta cambiar de sección. */
      resettleVisualViewport(baseScrollRef.current);
    };
  }, []);

  /**
   * Y también CON la pantalla abierta, no solo al salir.
   *
   * Si el viewport se queda corrido sin teclado —lo típico al entrar al chat
   * justo después de cerrar uno en otra pantalla—, compensarlo estirando el alto
   * evita que se vea mal, pero el desfase sigue ahí y arrastra a todo lo demás.
   * Este es el momento de deshacerlo de verdad, con la misma herramienta que ya
   * usa la salida.
   *
   * ⚠️ Solo sin foco. `resettleVisualViewport` suelta el foco del campo de texto
   * para forzar el reasiento, y hacerlo mientras alguien escribe le cerraría el
   * teclado en la cara.
   */
  useEffect(() => {
    if (!mounted || composerFocused || !viewportCorrido) return;
    resettleVisualViewport(baseScrollRef.current);
  }, [mounted, composerFocused, viewportCorrido]);

  /**
   * Salir: la pantalla se va deslizando a la derecha y la página de destino
   * entra desde la izquierda. Next desmonta el portal en cuanto navegas, así que
   * la salida hay que animarla ANTES de navegar — el patrón `isClosing` +
   * setTimeout de `VibraResponsivePanel`, que es la referencia de la guía.
   */
  function handleBack() {
    if (closing) return;
    setClosing("back");
    setNavSlideDir("left");
    setTimeout(() => router.back(), NAV_ANIM_MS);
  }

  /**
   * Al perfil de la otra persona, desde su nombre o su avatar.
   *
   * Es una navegación hacia ADELANTE, así que se mueve al revés que salir: esta
   * pantalla se va por la izquierda y el perfil entra desde la derecha. Sin
   * animar la salida se vería un corte seco — este portal va por encima de todo,
   * o sea que la página nueva no puede taparlo: tiene que quitarse él.
   */
  function handleOpenProfile() {
    if (closing || !profile?.handle) return;
    setClosing("forward");
    setNavSlideDir("right");
    setTimeout(() => router.push(`/u/${profile.handle}`), NAV_ANIM_MS);
  }

  if (!mounted) return null;

  const screen = (
    <div
      // Entrada: misma animación que el resto de la navegación. Se aplica aquí
      // y no en el layout porque el portal vive fuera de `.mainInner`, que es
      // donde el layout pone este atributo. La regla global
      // `[data-nav-enter="right"]` de globals.css hace el resto.
      data-nav-enter={closing ? undefined : "right"}
      // `onFocus`/`onBlur` de React son focusin/focusout: burbujean, así que se
      // enteran del campo de escritura sin tener que pasarle nada al hilo.
      //
      // ⚠️ Y justo por eso hay que filtrar QUÉ recibió el foco. Burbujea TODO lo
      // enfocable del hilo, y cada globo de mensaje es un `role="button"` con
      // `tabIndex={0}`: tocar un mensaje contaba como "el campo tiene el foco".
      //
      // El daño estaba al cerrar el teclado tocando un mensaje. Salía
      // `focusout` del campo y acto seguido `focusin` del globo, así que la
      // bandera volvía a `true` mientras el teclado se iba: la pantalla seguía
      // calzada al área visible de cuando el teclado estaba abierto y se quedaba
      // a MEDIA PANTALLA hasta que algo más forzara otra medición. Y de paso
      // cada toque en un mensaje disparaba una ráfaga de relecturas de
      // geometría, que es parte de lo que se sentía como tirones.
      onFocus={(e) => {
        if (abreTeclado(e.target)) setComposerFocused(true);
      }}
      onBlur={(e) => {
        if (abreTeclado(e.target)) setComposerFocused(false);
      }}
      style={{
        // La salida va inline para que gane a la regla del atributo.
        ...(closing
          ? {
              animation: `${
                closing === "back" ? "vibraChatExitRight" : "vibraChatExitLeft"
              } ${NAV_ANIM_MS}ms ease-in both`,
            }
          : null),
        position: "fixed",
        // Con teclado, el área visible exacta. Sin teclado pero con el viewport
        // corrido, desde arriba del todo hasta donde acaba lo que se ve. Y si no,
        // `inset: 0` y ni un número: es la diferencia entre que al cerrar el
        // teclado vuelva al borde o se quede una franja negra abajo.
        ...(calzarConTeclado && viewport
          ? {
              top: viewport.offsetTop,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              height: viewport.height,
              bottom: "auto" as const,
            }
          : calzarSinTeclado && viewport
          ? {
              // `top: 0` SIEMPRE. Bajar el borde de arriba sin teclado es lo que
              // dejaba el chat a media pantalla.
              top: 0,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              height: viewport.offsetTop + viewport.height,
              bottom: "auto" as const,
            }
          : {
              inset: 0,
              // `inset: 0` se resuelve contra el área de dibujo, que en la PWA
              // de iPhone mide menos que el lienzo. Con el alto puesto gana el
              // alto, y el borde inferior cae donde de verdad acaba la pantalla.
              height: "var(--vb-alto-pantalla)",
            }),
        // Por encima de MobileBottomNav (9999): la barra inferior taparía justo
        // el campo de escritura.
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      {/* Lector de geometría para depurar el teclado en iOS. Se enciende con
          `?vv=1` en la URL o con un pulsado largo en la cabecera, porque este
          fallo únicamente se reproduce en un iPhone de verdad —y en la app
          INSTALADA, donde no hay barra de direcciones— y desde el escritorio no
          hay forma de mirarlo. Si `corrido` se queda en un número distinto de 0
          con el teclado ya cerrado, es que iOS no devolvió el viewport visual a
          su sitio. */}
      {depurarViewport ? (
        <div
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 4px)",
            insetInlineEnd: 4,
            zIndex: 10001,
            pointerEvents: "none",
            background: "rgba(0,0,0,0.72)",
            color: "#0f0",
            font: "600 10px/1.35 ui-monospace, monospace",
            padding: "4px 6px",
            borderRadius: 6,
            whiteSpace: "pre",
          }}
        >
          {[
            // LAS DOS QUE DECIDEN. Si no coinciden, el navegador está bien y
            // nosotros vamos viejos; si coinciden y el alto sigue corto, es
            // WebKit el que no ha vuelto a su sitio.
            `copia ${viewport?.height ?? "—"} @${viewport?.offsetTop ?? "—"}`,
            `vivo  ${vvVivo?.alto ?? "—"} @${vvVivo?.corrido ?? "—"}`,
            `IGUAL ${
              vvVivo && viewport
                ? vvVivo.alto === Math.round(viewport.height) &&
                  vvVivo.corrido === Math.round(viewport.offsetTop)
                  ? "sí → (B) WebKit"
                  : "NO → (A) copia vieja"
                : "—"
            }`,
            // Si esto no sube al cerrar el teclado, iOS no avisó.
            `eventos ${vvVivo?.eventos ?? "—"} hace ${vvVivo?.desdeUltimoMs ?? "—"}ms`,
            `activo ${vvVivo?.foco ?? "—"}`,
            `alto win ${typeof window !== "undefined" ? window.innerHeight : "—"}`,
            // La comparacion que importa: si "alto win" se queda por debajo de
            // "pantalla" con el teclado ya cerrado, el viewport de LAYOUT sigue
            // encogido y ese es el hueco negro de abajo.
            `pantalla ${typeof window !== "undefined" ? window.screen.height : "—"}`,
            // LO QUE DECIDE DÓNDE ESTÁ ANCLADO EL VIEWPORT. Si el inset de
            // arriba vale lo mismo que "pantalla - alto win", el área de dibujo
            // empieza DEBAJO de la barra de estado y lo que le falta se queda
            // fuera por abajo: ese es el escalón negro, y el número viene de
            // ARRIBA aunque se vea abajo.
            `seguro ↑${vvVivo?.segArriba ?? "—"} ↓${vvVivo?.segAbajo ?? "—"}`,
            `lvh ${vvVivo?.lvh ?? "—"}  dvh ${vvVivo?.dvh ?? "—"}`,
            // LA LÍNEA QUE DICE SI EL ARREGLO SE ESTÁ EJECUTANDO. Dentro de la
            // app instalada tiene que valer lo mismo que `lvh`. Si vale lo
            // mismo que `dvh`, la regla `@media (display-mode: ...)` no está
            // casando y no se ha probado nada.
            `VAR ${vvVivo?.varAlto ?? "—"}  ${
              vvVivo
                ? vvVivo.varAlto === vvVivo.lvh
                  ? "→ aplicada"
                  : "→ NO APLICADA"
                : ""
            }`,
            `falta ${
              typeof window !== "undefined"
                ? window.screen.height - window.innerHeight
                : "—"
            }`,
            // LA LÍNEA QUE DECIDE EL ARREGLO. Si en el peor momento `lvh` se
            // mantuvo en el alto de la pantalla mientras `win` se hundía, basta
            // con anclar las superficies a `lvh`. Si `lvh` se hundió también,
            // no hay unidad que salve nada y hay que quitar el conflicto de
            // raíz, en el manifest y en la barra de estado.
            `PEOR win ${vvVivo?.peor?.win ?? "—"} lvh ${
              vvVivo?.peor?.lvh ?? "—"
            } dvh ${vvVivo?.peor?.dvh ?? "—"}`,
            `     vv ${vvVivo?.peor?.vv ?? "—"}@${
              vvVivo?.peor?.corrido ?? "—"
            } hace ${vvVivo?.peor?.haceMs ?? "—"}ms`,
            // Modo real en el que se esta ejecutando la app instalada. Si aqui
            // pone "standalone" cuando el manifest pide "fullscreen", el
            // WebAPK de Android sigue con la copia vieja del manifest y ningun
            // cambio de codigo va a servir hasta que Chrome lo actualice.
            `modo ${
              typeof window !== "undefined"
                ? (["fullscreen", "standalone", "minimal-ui", "browser"].find((m) =>
                    window.matchMedia(`(display-mode: ${m})`).matches
                  ) ?? "—")
                : "—"
            }`,
            `teclado ${keyboardPx}`,
            `foco ${composerFocused ? "sí" : "no"}`,
            `calza ${calzarConTeclado ? "teclado" : calzarSinTeclado ? "alto" : "no"}`,
          ].join("\n")}
        </div>
      ) : null}

      {/* Global: los keyframes de entrada viven en globals.css, pero el de
          salida solo lo usa esta pantalla. */}
      <style jsx global>{`
        @keyframes vibraChatExitRight {
          from {
            transform: translateX(0);
          }
          to {
            /* El signo sale de --vb-dir (globals.css): en árabe y dhivehi la
               pantalla tiene que salir hacia la izquierda para que se lea como
               retroceder. translateX no se voltea solo, no es una propiedad
               lógica. */
            transform: translateX(calc(100% * var(--vb-dir, 1)));
          }
        }

        /* Hacia adelante: se va al lado contrario, dejando sitio al perfil que
           entra. Mismo respeto por --vb-dir. */
        @keyframes vibraChatExitLeft {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(calc(-100% * var(--vb-dir, 1)));
          }
        }
      `}</style>

      <header
        ref={headerRef}
        onPointerDown={empezarPulsado}
        onPointerUp={soltarPulsado}
        onPointerCancel={soltarPulsado}
        onPointerLeave={soltarPulsado}
        onClickCapture={tragarClicDelPulsado}
        style={{
          position: "relative",
          // Por encima del hilo, que es el hermano de abajo: así los mensajes
          // quedan DETRÁS y entran en lo que difumina el cristal.
          zIndex: 2,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "calc(10px + env(safe-area-inset-top, 0px)) 12px 10px",
        }}
      >
        {/* El canto duro se sustituye por un fundido: el mensaje que sube se
            disuelve en vez de cortarse contra una línea de 1px. El velo lleva el
            MISMO negro del fondo de la pantalla.

            ⚠️ Aquí el velo va MÁS BAJO que en laptop. El fondo de esta pantalla
            es negro puro, así que un velo negro al 86% no se leía como cristal
            sino como una tapa: no se distinguía del fondo y el efecto se perdía.
            A la mitad se ve pasar el mensaje, y el desenfoque sube a 22 para que
            lo que pasa sea mancha y no texto legible a medias. */}
        <BlurFade
          side="top"
          size={headerHeight + HEADER_FADE_OVERHANG}
          fade={HEADER_FADE_LENGTH}
          blur={22}
          veil="rgba(0,0,0,0.52)"
        />
        <IconButton label={tCommon("back")} size="sm" tone="bare" style={{ position: "relative", zIndex: 1, placeItems: "center" }} onClick={handleBack}>
          <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M15 5L8 12L15 19"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>

        {/* El avatar NO va envuelto en un botón: se pinta él uno propio, y
            anidarlos es HTML inválido.
            Su `onClick` es el último recurso de una cadena que ya trae hecha —
            si hay live abre el live (aro rojo), si hay historias las abre, y
            solo si no hay ninguno cae aquí y va al perfil. */}
        <LiveRingAvatar
          entityId={otherUid ?? conversationId ?? ""}
          entityType="profile"
          currentUserId={selfUid}
          photoURL={profile?.photoURL ?? null}
          displayName={displayName}
          // Sube con los de la lista, para que abrir una conversacion no
          // encoja de golpe la foto de la persona.
          size={41}
          onClick={handleOpenProfile}
          style={{ position: "relative", zIndex: 1 }}
        />

        <button
          type="button"
          onClick={handleOpenProfile}
          disabled={!profile?.handle}
          style={{
            flex: 1,
            minWidth: 0,
            display: "block",
            border: "none",
            background: "transparent",
            padding: 0,
            textAlign: "start",
            font: "inherit",
            color: "inherit",
            cursor: profile?.handle ? "pointer" : "default",
            WebkitTapHighlightColor: "transparent",
            position: "relative",
            zIndex: 1,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
              // El cristal deja pasar bastante de lo de detrás; esta sombra es
              // el seguro para cuando lo de detrás es un globo morado.
              textShadow: "0 1px 3px rgba(0,0,0,0.7)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {displayName}
          </span>
          {profile?.handle ? (
            <span
              style={{
                display: "block",
                fontSize: 11.5,
                color: "rgba(255,255,255,0.45)",
                textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              @{profile.handle}
            </span>
          ) : null}
        </button>

        {/* A la derecha, pero SEPARADO del borde: pegado a él el dedo se sale de
            la pantalla al intentar darle. Los 6px de margen más el relleno
            propio del botón dejan un blanco cómodo.
            En la pestaña de laptop sigue a la izquierda del avatar: allí la
            cabecera es estrecha y el borde derecho lo ocupan minimizar y cerrar. */}
        {otherUid && conversationId ? (
          <ProfileMoreMenu
            viewerUid={selfUid}
            profileUid={otherUid}
            // Bloquear/desbloquear NO se cablea aquí: el estado del hilo lo
            // sincroniza `useSocialRelationship`, que es por donde pasan todos
            // los bloqueos. Hacerlo también aquí sería escribir dos veces.
            reportTarget={{
              targetType: "conversation",
              targetId: conversationId,
              targetOwnerId: otherUid,
            }}
            buttonStyle={{ padding: "0 8px", marginInlineEnd: 6, position: "relative", zIndex: 1 }}
            extraItems={({ close, itemStyle }) =>
              selfUid ? (
                <ChatConversationMenuItems
                  conversationId={conversationId}
                  selfUid={selfUid}
                  muted={(conversation?.mutedBy ?? []).includes(selfUid)}
                  itemStyle={itemStyle}
                  onCloseMenu={close}
                  onRequestRemove={() => setRemoveOpen(true)}
                />
              ) : null
            }
          />
        ) : null}
      </header>

      {selfUid && conversationId ? (
        <ChatRemoveConversationDialog
          open={removeOpen}
          conversationId={conversationId}
          selfUid={selfUid}
          onClose={() => setRemoveOpen(false)}
          // Quitada de la bandeja, quedarse dentro del hilo no tiene sentido.
          onRemoved={handleBack}
        />
      ) : null}

      {/* El margen negativo mete el hilo POR DEBAJO de la cabecera. Al ser
          `flex: 1` recupera solo esos píxeles, así que la pantalla sigue
          midiendo lo mismo y el compositor no se va por debajo del borde. */}
      <div style={{ flex: 1, minHeight: 0, marginTop: -headerHeight }}>
        <ConversationThread
          conversationId={conversationId}
          otherUid={otherUid}
          profile={profile}
          selfUid={selfUid}
          // Lo que le tapa la cabecera superpuesta. Sin esto, el mensaje más
          // antiguo se quedaría escondido detrás de ella al llegar arriba.
          // ⚠️ La barra MÁS el sobresaliente: el fundido baja
          // HEADER_FADE_OVERHANG más adentro y, reservando solo la barra, el
          // primer mensaje nacía ya difuminado.
          topInset={headerHeight + HEADER_FADE_OVERHANG}
          safeAreaBottom
        />
      </div>
    </div>
  );

  return createPortal(screen, document.body);
}
