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
import { PurchaseIdentityProvider } from "@/lib/greetings/purchaseIdentity";

export default function ExpressPage() {
  // Puede no haber nadie, o haber una sesión de invitado abierta por una compra
  // anterior. Las dos valen; el feed no pregunta.
  const { user } = useAuth();

  // Se le dice que la sesión es de invitado. Así, cuando esa persona se dé de
  // alta a mitad de una compra, el feed que ya está en pantalla se queda hasta
  // que llegue el suyo, en vez de vaciarse y llevarse la pasarela por delante.
  const { items, ready, loadMore, recordEngagement } = useReelFeed(
    user?.uid,
    user?.isAnonymous ?? true,
  );

  useScreenReady(ready);

  return (
    // Aqui NO se manda a login al comprar: se firma como invitado y el encargo
    // sigue. El correo se pide despues, en la pasarela.
    <PurchaseIdentityProvider mode="guest">
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
    </PurchaseIdentityProvider>
  );
}
