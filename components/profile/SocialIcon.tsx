import type { SocialNetworkId } from "@/lib/profile/socialNetworks";
import { SOCIAL_ICON_PATH } from "./socialIconPaths";

/**
 * La marca de una red, con su trazo oficial.
 *
 * Los trazos vienen de `simple-icons`, copiados a `socialIconPaths.ts` para no
 * arrastrar el paquete entero por seis de sus ~3300 íconos. Todos son de un solo
 * trazo relleno en un lienzo de 24x24, así que aquí no hay nada por red: se
 * pinta el que toque.
 */
export default function SocialIcon({
  id,
  size = 18,
}: {
  id: SocialNetworkId;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={SOCIAL_ICON_PATH[id]} />
    </svg>
  );
}
