import type { Timestamp } from "firebase/firestore";
import type {
  Currency,
  CreatorService,
  GroupDonationSettings,
  CanonicalGroupCategory,
} from "./group";

export type ProfileMonetizationSettings = {
  greetingsEnabled: boolean;
  adviceEnabled: boolean;
  customClassEnabled: boolean;
  digitalMeetGreetEnabled: boolean;
  donationsEnabled: boolean;
};

export type ProfileServiceCatalog = CreatorService[];

export type ProfileDonationSettings = GroupDonationSettings;

export type ProfileSocialStats = {
  followersCount?: number;
  followingCount?: number;
};

export interface CreatorProfile {
  uid: string;

  displayName?: string | null;
  username?: string | null;
  handle?: string | null;
  bio?: string | null;

  photoURL?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;

  monetization?: ProfileMonetizationSettings;

  /**
   * Servicios visibles del perfil.
   * Deben verse y funcionar igual que los servicios visibles del grupo.
   * IMPORTANTE: suscripción NO entra aquí.
   */
  offerings?: ProfileServiceCatalog;

  /**
   * Donaciones del perfil.
   * Se mantienen separadas de offerings igual que en grupo.
   */
  donation?: ProfileDonationSettings;

  /**
   * Estadísticas sociales opcionales.
   * No se escriben desde cliente en este bloque.
   * Quedan preparadas para sidebar/perfil futuro sin forzar lecturas caras.
   */
  socialStats?: ProfileSocialStats;

  currency?: Currency | null;

  /**
   * Intereses del perfil (mismas categorías canónicas del sistema de grupos).
   * Uso interno: NO se muestran en el perfil público; solo alimentan el
   * buscador (aparecer en resultados por categoría) y las recomendaciones
   * (recomendar perfiles con intereses afines). Se editan en configuración
   * y se siembran en el onboarding unificado de categorías.
   */
  interests?: CanonicalGroupCategory[] | null;

  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export function profileSupportsVisibleService(
  profile: Pick<CreatorProfile, "offerings">,
  serviceType: CreatorService["type"]
): boolean {
  return !!profile.offerings?.some(
    (service) =>
      service.type === serviceType &&
      service.enabled === true &&
      service.visible === true &&
      (service.sourceScope === "profile" || service.sourceScope === "both")
  );
}

export function profileSupportsDonation(
  profile: Pick<CreatorProfile, "donation">
): boolean {
  return (
    profile.donation?.enabled === true &&
    profile.donation?.visible === true &&
    profile.donation?.sourceScope === "profile"
  );
}