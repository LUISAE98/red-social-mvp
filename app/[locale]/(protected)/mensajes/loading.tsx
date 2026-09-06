import { ConversationListSkeleton } from "@/components/chat/ChatSkeletons";
import { CHAT_AVATAR_ANCHO } from "@/components/chat/ConversationList";
import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Mensajes. Copia la página entera, no solo la lista: el ancho y el aire de
 * `.msgPage` (640 con `8px 12px 12px`), la cabecera de `.msgPageHead` con su
 * título, y las filas con el MISMO avatar que usa `ConversationList` en celular.
 *
 * Lo de la cabecera no es adorno. Sin ella, este fallback pintaba la lista
 * pegada arriba y, al montar la página, el título aparecía y empujaba la lista
 * hacia abajo: se leía como un segundo esqueleto en vez de como un relevo.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 12px 12px", boxSizing: "border-box" }}>
        <div style={{ padding: "0 4px 10px" }}>
          <SkeletonBlock width={148} height={25} radius={7} />
        </div>
        <ConversationListSkeleton rows={7} avatarSize={CHAT_AVATAR_ANCHO} />
      </div>
    </main>
  );
}
