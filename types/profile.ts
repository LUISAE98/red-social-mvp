import type {
  Currency,
  CreatorService,
  GroupDonationSettings,
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

  currency?: Currency | null;

  createdAt?: any;
  updatedAt?: any;
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