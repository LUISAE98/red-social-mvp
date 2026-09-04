import { MessageThreadSkeleton } from "@/components/chat/ChatSkeletons";

/**
 * Un hilo de conversación abierto por enlace directo.
 *
 * Necesita el suyo porque, sin él, heredaría el de `mensajes/` y mostraría la
 * lista de conversaciones mientras abre un chat. Desde la bandeja no se llega
 * por aquí —`handleOpen` abre el chat en el dock, sin navegar—, así que esto
 * cubre la entrada directa, por enlace o por recarga.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "14px" }}>
        <MessageThreadSkeleton bubbles={7} />
      </div>
    </main>
  );
}
