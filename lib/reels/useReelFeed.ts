"use client";

// Fuente única del feed de historias, para el reel de celular y el rail de
// escritorio. Que las dos superficies enseñen lo mismo no es cosmético: cuando
// cada una tenía su propio modelo, una agrupaba por creador y la otra no, y el
// mismo usuario veía una historia en el móvil y cinco en la laptop.
//
// El orden final es:
//   1. Lo de quien sigues, en su propio orden (sin cuota, tal como se acordó).
//   2. Descubrimiento, rankeado y repartido por cuota entre carriles.
//
// El descubrimiento se pide por TANDAS, no de una en una. Firestore no sabe
// ordenar por una puntuación calculada en el cliente, así que se trae una tanda
// por fecha, se rankea entera y se sirve. Rankear de a una daría un orden que en
// realidad es solo cronológico.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { collection, getDocs, limit, orderBy, query, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getUserTasteVector } from "@/app/components/GroupRecommendations/recommendation-engine";
import type { CanonicalGroupCategory } from "@/types/group";
import type { StoryDoc } from "@/lib/stories/types";
import {
  fetchDiscoveryReelPage,
  fetchFollowedReelStories,
  preferCreatorCopy,
  storyVideoKey,
} from "./reelStories";
import {
  authorOfItem,
  laneOfItem,
  mixByQuota,
  rankLives,
  rankStories,
  spreadByCreator,
  splitLanes,
} from "./reelRanking";
import { dedupeItems, storiesOf, storyItem, type ReelItem } from "./reelItems";
import { fetchReelLivesOnce, subscribeReelLives } from "./reelLives";
import { fetchReelSamples } from "./reelSamples";
import { loadLocalSeen } from "./reelSeenLocal";
import {
  getReelFeedGeneration,
  getReelFeedGenerationServer,
  isReelFeedHeld,
  isReelFeedHeldServer,
  subscribeToReelFeedHold,
  subscribeToReelFeedRefresh,
} from "./reelFeedRefresh";
import {
  applyEngagement,
  loadTermVector,
  saveTermVector,
  termAffinity,
  type ReelEngagement,
  type TermVector,
} from "./reelInterest";

/** Cuántas candidatas se traen por tanda antes de rankear. */
const POOL_SIZE = 60;

/**
 * Cuántas vistas recientes se leen. Es la memoria de "ya lo vi": más allá de
 * esto una historia vuelve a contar como nueva, que para un feed es aceptable y
 * evita arrastrar un historial que solo crece.
 */
const VIEWED_MEMORY = 500;

/** Tandas seguidas sin nada nuevo antes de rendirse hasta el siguiente scroll. */
const MAX_EMPTY_PAGES = 5;

// El estado lleva marcado A QUIÉN pertenece. Así, al cambiar de usuario, lo del
// anterior deja de valer por comparación y no hace falta vaciarlo desde el
// efecto, que provocaría un render en cascada y además enseñaría durante un
// fotograma las historias de la sesión anterior.
type State = {
  uid: string | null;
  items: ReelItem[];
  ready: boolean;
  /**
   * Este feed se armó para un INVITADO.
   *
   * Importa al cambiar de sesión: un feed de invitado no lleva nada personal
   * —no sigue a nadie, no tiene gusto aprendido ni historial—, así que puede
   * seguir en pantalla mientras se arma el de la cuenta nueva sin enseñarle a
   * nadie lo que no es suyo.
   */
  anonimo: boolean;
};

const EMPTY: State = { uid: null, items: [], ready: false, anonimo: true };

async function fetchViewedMap(uid: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!uid) return map;
  try {
    const snap = await getDocs(
      query(
        collection(db, "userStoryViews", uid, "views"),
        orderBy("viewedAt", "desc"),
        limit(VIEWED_MEMORY),
      ),
    );
    for (const d of snap.docs) {
      map.set(d.id, d.data().viewedAt?.toMillis?.() ?? Date.now());
    }
  } catch (err) {
    // Sin historial de vistas el feed sigue funcionando, solo pierde la
    // penalización de lo ya visto.
    console.error("[useReelFeed] viewed", err);
  }
  return map;
}

export function useReelFeed(
  uid: string | null | undefined,
  esAnonimo = false,
  /**
   * Con `false` el feed no se arma: ni consultas, ni escuchas, ni ranking.
   *
   * Lo usa `ReelRailsProvider` en las pantallas donde el rail de reels PUEDE
   * salir pero todavia no hay publicaciones suficientes para hospedar uno. Sin
   * esto, entrar a cualquier perfil pagaba el feed entero por si acaso.
   *
   * Es una pausa, no un desmontaje: el proveedor sigue en su sitio con el mismo
   * arbol debajo, asi que al activarse no se remonta nada de lo que ya se ve.
   */
  activo = true
) {
  // Quien mira es un INVITADO. Sin cuenta de verdad, o con una firmada al vuelo
  // en Vibra Express.
  const esInvitado = !uid || esAnonimo;
  // Quien mira, o NADIE.
  //
  // ⚠️ Se normaliza a null porque el estado se compara con esto para saber si
  // es de esta sesion: sin normalizar, `undefined` (nadie) nunca casaria con
  // el `null` del estado vacio y el feed se quedaria eternamente sin listo.
  const viewerUid = uid ?? null;
  const [state, setState] = useState<State>(EMPTY);

  // Cambia cuando alguien pide refrescar (tirar hacia abajo, publicar, quitar).
  // Entra en las dependencias del efecto de carga, así que rearma el feed entero
  // sin que este hook tenga que saber quién lo pidió.
  const generation = useSyncExternalStore(
    subscribeToReelFeedRefresh,
    getReelFeedGeneration,
    getReelFeedGenerationServer,
  );

  // ¿Hay una compra abierta ahora mismo? Mientras la haya, el feed no se toca.
  // Al soltarse, este valor cambia y el efecto de carga se dispara solo.
  const frenado = useSyncExternalStore(
    subscribeToReelFeedHold,
    isReelFeedHeld,
    isReelFeedHeldServer,
  );

  const tasteRef = useRef<Map<CanonicalGroupCategory, number>>(new Map());
  const viewedRef = useRef<Map<string, number>>(new Map());
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Se recuerda el VIDEO, no el documento: el mismo saludo puede estar publicado
  // dos veces (por quien lo grabó y por quien lo compró) y en el reel circula una
  // sola copia.
  const seenVideosRef = useRef<Set<string>>(new Set());
  const interestRef = useRef<TermVector>(new Map());
  // De quién es el vector que hay en memoria.
  const interestUidRef = useRef<string | null>(null);
  // Solo se escribe si de verdad cambió algo durante la sesión.
  const interestDirtyRef = useRef(false);
  // Lives en curso según la suscripción. Estar aquí no es estar en el feed: solo
  // entran cuando una tanda de descubrimiento los coloca.
  const livesRef = useRef<ReelItem[]>([]);
  const placedLivesRef = useRef<Set<string>>(new Set());
  // A quién sigue el usuario. Es la señal fuerte del ranking de lives.
  const followingIdsRef = useRef<Set<string>>(new Set());

  /** Rankea y reparte una tanda cruda de descubrimiento. */
  const arrange = useCallback((pool: StoryDoc[]): ReelItem[] => {
    // Dentro de la tanda puede venir el mismo video dos veces (la copia del
    // creador y la del comprador). Se queda la del creador, para que las vistas
    // y la popularidad se acumulen en SU documento.
    const fresh = preferCreatorCopy(pool).filter(
      (s) => !seenIdsRef.current.has(s.id) && !seenVideosRef.current.has(storyVideoKey(s)),
    );
    // Los lives que aún no ha colocado ninguna tanda. Uno ya colocado no vuelve
    // a entrar aunque siga transmitiendo.
    const lives = livesRef.current.filter((l) => !placedLivesRef.current.has(l.key));
    if (fresh.length === 0 && lives.length === 0) return [];

    const ranked = rankStories(fresh, tasteRef.current, viewedRef.current, Date.now(), (s) =>
      termAffinity(s, interestRef.current),
    ).map(storyItem);

    const rankedLives = rankLives(lives, {
      followedIds: followingIdsRef.current,
      nowMs: Date.now(),
    });

    // Primero la cuota entre consejos, saludos y lives, y DESPUÉS se separan los
    // del mismo creador. Al revés, la cuota volvería a juntarlos.
    const mixed = spreadByCreator(
      mixByQuota(splitLanes([...ranked, ...rankedLives], laneOfItem)),
      authorOfItem,
    );
    if (lives.length > 0) {
      const posiciones = mixed
        .map((it, i) => (it.kind === "live" ? i : -1))
        .filter((i) => i >= 0);
      console.info(
        `[useReelFeed] ${lives.length} live(s) disponibles, colocados en las posiciones`,
        posiciones,
        `de ${mixed.length}`,
      );
    }
    for (const item of mixed) {
      if (item.kind === "live") {
        placedLivesRef.current.add(item.key);
        continue;
      }
      seenIdsRef.current.add(item.story.id);
      seenVideosRef.current.add(storyVideoKey(item.story));
    }
    return mixed;
  }, []);

  // ⚠️ Este efecto NO exige sesion, y es a proposito.
  //
  // Vibra Express enseña este mismo feed sin login. Lo que necesita cuenta
  // —lo ya visto, el gusto aprendido, lo de quien sigues— simplemente no
  // aplica a un invitado y se salta; el descubrimiento, los lives y las
  // muestras no preguntan quien eres. Un feed sin personalizar sigue siendo un
  // feed; uno que no carga, no.
  useEffect(() => {
    // ⚠️ Con una compra abierta, el feed espera.
    //
    // Rearmarlo cambia la lista de paneles, y el panel que se va se lleva por
    // delante la pasarela que vive dentro. En Vibra Express eso pasaba justo en
    // el peor momento: al entrar con un correo que ya tenía cuenta, en mitad del
    // cobro. El feed puede esperar unos segundos; una compra a medias, no.
    if (frenado || !activo) return;

    let cancelled = false;

    // Reinicio total: cambiar de usuario no puede heredar ni el gusto ni las
    // vistas ni el cursor del anterior.
    tasteRef.current = new Map();
    viewedRef.current = new Map();
    cursorRef.current = null;
    exhaustedRef.current = false;
    seenIdsRef.current = new Set();
    seenVideosRef.current = new Set();
    placedLivesRef.current = new Set();

    // El vector de intereses se ata al USUARIO, no a la recarga. Un refresco no
    // puede tirar lo aprendido en esta sesión, que aún no está guardado: se
    // escribe una sola vez al salir del feed.
    const sameUser = !!viewerUid && interestUidRef.current === viewerUid;
    if (!sameUser) {
      interestRef.current = new Map();
      interestDirtyRef.current = false;
      interestUidRef.current = viewerUid;
    }

    (async () => {
      try {
      const [taste, viewed, interest, followed, pool, lives, samples] = await Promise.all([
        // Sin cuenta no hay gusto, ni historial, ni a quien sigas: son cosas
        // que viven bajo el usuario. Se resuelven vacias en vez de consultarse.
        viewerUid
          ? getUserTasteVector(viewerUid).catch(() => new Map<CanonicalGroupCategory, number>())
          : Promise.resolve(new Map<CanonicalGroupCategory, number>()),
        viewerUid ? fetchViewedMap(viewerUid) : Promise.resolve(new Map<string, number>()),
        viewerUid && !sameUser ? loadTermVector(viewerUid) : Promise.resolve(interestRef.current),
        viewerUid
          ? fetchFollowedReelStories(viewerUid)
          : Promise.resolve({ stories: [], followingIds: new Set<string>() }),
        fetchDiscoveryReelPage(null, POOL_SIZE),
        // Los lives entran en la PRIMERA tanda o no entran hasta que el
        // usuario scrolle una pagina entera. Por eso se piden aqui y no se
        // deja al primer aviso de la suscripcion, que llegaba cuando queria.
        fetchReelLivesOnce({ uid: viewerUid }),
        // Las muestras del escaparate. Se piden una vez y se mezclan con la
        // primera tanda: son pocas —tres por servicio— y su valor esta justo al
        // principio, cuando el creador aun no tiene encargos que ensenar.
        fetchReelSamples(),
      ]);
      if (cancelled) return;

      tasteRef.current = taste;
      // Lo que recuerda el NAVEGADOR se suma a lo que recuerda la cuenta.
      //
      // Sin cuenta es la unica memoria que hay. Con cuenta tampoco estorba:
      // si esta persona vio cosas antes de entrar, no tiene por que volver a
      // encontrarselas ahora que entro.
      const local = loadLocalSeen();
      for (const [id, at] of viewed) local.set(id, at);
      viewedRef.current = local;
      interestRef.current = interest;
      cursorRef.current = pool.cursor;
      exhaustedRef.current = pool.exhausted;

      // Los seguidos van a la cabeza y sin cuota, pero sí con lo no visto
      // delante: si sigues a alguien, lo nuevo suyo es lo primero que quieres.
      //
      // También aquí se deduplica por video: si sigues al creador Y al comprador
      // del mismo saludo, te llegan las dos copias y solo debe circular una.
      followingIdsRef.current = followed.followingIds;
      livesRef.current = lives;

      const head: ReelItem[] = [];
      for (const s of rankStories(preferCreatorCopy(followed.stories), taste, viewed, Date.now())) {
        const videoKey = storyVideoKey(s);
        if (seenVideosRef.current.has(videoKey)) continue;
        seenVideosRef.current.add(videoKey);
        seenIdsRef.current.add(s.id);
        head.push(storyItem(s));
      }

      // Las muestras entran por el mismo sitio que el descubrimiento: son
      // saludos y consejos, asi que compiten en sus mismos carriles y se
      // rankean con la misma vara. Lo unico que las distingue es de donde
      // salieron.
      const tail = arrange([...pool.stories, ...samples]);

      setState({
        uid: viewerUid,
        items: dedupeItems([...head, ...tail]),
        ready: true,
        anonimo: esInvitado,
      });
      } catch (err) {
        // ⚠️ Sin esto, cualquier fallo de aqui dentro dejaba el feed en el
        // spinner PARA SIEMPRE: `setState` no llegaba a ejecutarse y `ready` se
        // quedaba en false. Ademas salia como promesa rechazada sin capturar,
        // que es lo que el reporte de errores recoge y reintenta, y de ahi los
        // miles de errores en cadena en desarrollo.
        //
        // Un feed vacio es un mal resultado; un feed que carga eternamente es
        // peor, porque no se distingue de la aplicacion rota.
        console.error("[useReelFeed] no se pudo armar el feed:", err);
        if (!cancelled) setState({ uid: viewerUid, items: [], ready: true, anonimo: esInvitado });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewerUid, arrange, generation, frenado, esInvitado, activo]);

  // Los lives entran y salen solos mientras el feed está abierto.
  //
  // Aquí solo se RETIRAN. Insertar uno nuevo en mitad de la lista movería el
  // contenido bajo el dedo de quien está scrolleando, que es de las cosas que
  // peor se sienten en un feed. Los nuevos esperan a la siguiente tanda, que es
  // cuando la lista crece por abajo de todas formas.
  useEffect(() => {
    // ⚠️ Esto también toca la lista, así que también se frena.
    //
    // Retirar un live cambia el arreglo de paneles, y cambiar el arreglo puede
    // borrar el panel donde vive una compra abierta. Frenar solo la carga
    // dejaba esta puerta abierta: al cambiar de sesión, la suscripción se
    // rehacía y escribía por su cuenta.
    if (frenado || !activo) return;
    return subscribeReelLives({ uid: viewerUid }, (lives) => {
      livesRef.current = lives;
      const enCurso = new Set(lives.map((l) => l.key));
      setState((prev) => {
        if (prev.uid !== viewerUid) return prev;
        const next = prev.items.filter((i) => i.kind !== "live" || enCurso.has(i.key));
        // Sin cambios se devuelve el mismo objeto: si no, cada aviso repintaría
        // el feed entero para nada.
        return next.length === prev.items.length ? prev : { ...prev, items: next };
      });
    });
  }, [viewerUid, frenado, activo]);

  /**
   * Pide más hasta CONSEGUIR algo nuevo, no hasta pedir una vez.
   *
   * ⚠️ Una tanda puede llegar entera repetida: son las que ya salieron en la
   * cabeza de seguidos, o las que se colaron por el solape entre tandas. Si al
   * quedarse en cero se abandonaba, la lista no crecía, y como sin contenido
   * nuevo el usuario tampoco puede seguir scrolleando, no volvía a dispararse
   * nada. El feed se moría con páginas de sobra por delante.
   *
   * Así que se encadena hasta traer algo o hasta agotar la colección, con un tope
   * de intentos seguidos para no encadenar lecturas sin fin si el filtrado deja
   * tandas vacías una detrás de otra.
   */
  const loadMore = useCallback(() => {
    if (loadingRef.current || exhaustedRef.current) return;
    loadingRef.current = true;

    void (async () => {
      try {
        for (let attempt = 0; attempt < MAX_EMPTY_PAGES; attempt++) {
          const page = await fetchDiscoveryReelPage(cursorRef.current, POOL_SIZE);
          cursorRef.current = page.cursor ?? cursorRef.current;
          exhaustedRef.current = page.exhausted;

          const next = arrange(page.stories);
          if (next.length > 0) {
            setState((prev) => ({
              ...prev,
              items: dedupeItems([...prev.items, ...next]),
            }));
            return;
          }
          if (page.exhausted) return;
        }
      } catch (err) {
        console.error("[useReelFeed] no se pudo pedir mas:", err);
      } finally {
        loadingRef.current = false;
      }
    })();
  }, [arrange]);

  /**
   * Registra cuánto se quedó mirando una historia.
   *
   * Se acumula en memoria, no se escribe en cada scroll. Un feed son decenas de
   * cambios por minuto y eso sería una escritura por cada uno.
   */
  const recordEngagement = useCallback((engagement: ReelEngagement) => {
    applyEngagement(interestRef.current, engagement);
    interestDirtyRef.current = true;
  }, []);

  // Una sola escritura al salir del feed. `pagehide` cubre cerrar la pestaña y
  // el cambio de app en móvil, donde `beforeunload` no llega en iOS.
  useEffect(() => {
    // Sin cuenta no hay donde guardar lo aprendido: las reglas de
    // `reelSignals` exigen cuenta real. El invitado aprende dentro de su
    // sesion y lo pierde al salir, que es lo que significa no tener cuenta.
    if (!viewerUid) return;
    const flush = () => {
      if (!interestDirtyRef.current) return;
      interestDirtyRef.current = false;
      void saveTermVector(viewerUid, interestRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [viewerUid]);

  // Si el estado es de otra sesión, se ignora hasta que llegue el de esta.
  //
  // ⚠️ CON UNA EXCEPCIÓN, y no es cosmética: si lo que había era un feed de
  // INVITADO, se sigue enseñando mientras se arma el de la cuenta nueva.
  //
  // Sin esto, darse de alta en mitad de una compra vaciaba el feed, la
  // superficie volvía al esqueleto y con ella se desmontaba la pasarela y su
  // pantalla verde. El cobro se hacía y quien pagaba no llegaba a verlo nunca.
  //
  // Se puede dejar en pantalla porque un feed de invitado no lleva nada de
  // nadie: no sigue a ningún creador, no tiene gusto aprendido ni historial. Lo
  // que se ve es descubrimiento público, y sigue siéndolo un segundo después.
  //
  // ⚠️ Y con una compra abierta, TAMPOCO se descarta, sea quien sea.
  //
  // Congelar la recarga no bastaba: aunque el feed no se rearmara, este cálculo
  // seguía dando el estado vacío en cuanto el uid dejaba de coincidir, y eso
  // solo ya devolvía la superficie al esqueleto. "Usar otro correo" cierra una
  // sesión y abre otra, así que el uid cambia dos veces en un segundo y con la
  // pasarela abierta encima: se veía como si la página se recargara y se perdía
  // el saludo en el que iba.
  //
  // Mientras hay una compra en marcha, lo que está en pantalla se queda.
  const current =
    state.uid === viewerUid
      ? state
      : state.ready && (state.anonimo || frenado)
        ? { ...state, uid: viewerUid }
        : EMPTY;
  // `stories` se mantiene para quien solo entiende de historias, como el rail
  // del home: ahí un live no pinta nada.
  const stories = useMemo(() => storiesOf(current.items), [current.items]);
  return { items: current.items, stories, ready: current.ready, loadMore, recordEngagement };
}
