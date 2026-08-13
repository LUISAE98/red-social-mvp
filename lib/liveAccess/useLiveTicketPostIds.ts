"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkLiveAccess } from "./live-access-service";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * IDs de transmisiones cuyo TICKET compró el viewer, de entre las que se le están
 * mostrando ahora mismo.
 *
 * El live y su grabación son EL MISMO post (`liveId == postId`), así que el ticket
 * ya pagó ese contenido: la miniatura del VOD no debe salir borrosa con precio a
 * quien compró la entrada.
 *
 * Se lee `liveAccess/{postId}/users/{uid}` una vez por post — no hay una consulta
 * que traiga "todos mis tickets" (viven en subcolecciones por live). Por eso el
 * caller debe pasar SOLO las transmisiones de pago visibles, y aquí se recuerda lo
 * ya consultado para no releer al paginar. Es el mismo costo por post que ya paga
 * cada tarjeta de live en el feed.
 */
export function useLiveTicketPostIds(
  postIds: readonly string[],
  viewerUid: string | null | undefined
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY);

  // `seen` = ya consultados; `owned` = con ticket confirmado. Ambos se tiran al
  // cambiar de identidad (invitado anónimo → cuenta real, o logout).
  const cacheRef = useRef<{ uid: string | null; seen: Set<string>; owned: Set<string> }>({
    uid: null,
    seen: new Set(),
    owned: new Set(),
  });

  const key = useMemo(() => postIds.join("|"), [postIds]);

  useEffect(() => {
    const uid = viewerUid ?? null;
    const cache = cacheRef.current;

    if (cache.uid !== uid) {
      cache.uid = uid;
      cache.seen = new Set();
      cache.owned = new Set();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIds(EMPTY);
    }
    if (!uid) return;

    const pending = key ? key.split("|").filter((id) => id && !cache.seen.has(id)) : [];
    if (pending.length === 0) return;
    pending.forEach((id) => cache.seen.add(id));

    let cancelled = false;
    Promise.all(
      pending.map(async (id) =>
        (await checkLiveAccess(id, uid).catch(() => false)) ? id : null
      )
    ).then((results) => {
      if (cancelled) return;
      const hits = results.filter((id): id is string => id !== null);
      if (hits.length === 0) return;
      hits.forEach((id) => cache.owned.add(id));
      setIds(new Set(cache.owned));
    });

    return () => {
      cancelled = true;
    };
  }, [key, viewerUid]);

  return viewerUid ? ids : EMPTY;
}
