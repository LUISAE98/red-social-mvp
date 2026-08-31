"use client";

// Vibra Express: el feed de saludos, consejos y lives, SIN necesidad de cuenta.
//
// Es exactamente el mismo feed que la app, no una copia. Monta `ReelsSurface`
// igual que `/reels`, y las dos únicas diferencias son que aquí no hay sesión
// que exigir y que no hay barra inferior debajo.
//
// Clonar el feed para esto habría significado mantener dos rankings, dos
// mezcladores y dos reproductores en paralelo, y que cualquier arreglo hubiera
// que hacerlo dos veces. Por eso el hook y la superficie se construyeron sin
// atarse a quién mira.

import { useAuth } from "@/app/providers";
import { useScreenReady } from "@/lib/useScreenReady";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import ReelsSurface from "@/components/reels/ReelsSurface";

export default function ExpressPage() {
  // Puede no haber nadie, o haber una sesión de invitado abierta por una compra
  // anterior. Las dos valen; el feed no pregunta.
  const { user } = useAuth();

  const { items, ready, loadMore, recordEngagement } = useReelFeed(user?.uid);

  useScreenReady(ready);

  return (
    <ReelsSurface
      uid={user?.uid ?? null}
      isAnonymous={!user || !!user.isAnonymous}
      items={items}
      ready={ready}
      loadMore={loadMore}
      recordEngagement={recordEngagement}
      // Sin barra inferior: los controles del reel llegan hasta el borde.
      hasBottomNav={false}
      // Cerrar el carrusel de escritorio devuelve a Express, no a la app.
      closeHref="/express"
    />
  );
}
