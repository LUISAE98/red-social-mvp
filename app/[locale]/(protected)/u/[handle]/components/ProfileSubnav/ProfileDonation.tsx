"use client";

// Wrapper delgado: la card de donación del perfil es ahora el componente COMPARTIDO
// DonationConfigCard (mismo que usa la comunidad), fijado a scope="profile".
// Toda la lógica/JSX vive en components/services/config/DonationConfigCard.tsx.

import DonationConfigCard from "@/components/services/config/DonationConfigCard";

type DonationMode = "none" | "general" | "wedding";
type Currency = "MXN" | "USD";

type DonationFields = {
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationSuggestedAmounts: string[];
  donationMessage: string;
  donationVideoUrl: string;
  donationPlaybackId: string;
};

type AnyDraft = DonationFields & Record<string, unknown>;

type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  activeColor?: string;
};

type ModeButtonProps = {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

type OverlayModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  hideFooter?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  draft: AnyDraft;
  saving: boolean;
  profileUserId: string;
  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  descriptionStyle?: React.CSSProperties;
  accentColor?: string;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;
  SwitchComponent: React.ComponentType<SwitchProps>;
  DonationModeButtonComponent: React.ComponentType<ModeButtonProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  publishSuccess?: { shareUrl: string; entityKind: "profile" | "community" };
  onSaveDraft: (nextDraft: AnyDraft) => Promise<boolean | void>;
};

export default function ProfileDonation({ profileUserId, ...rest }: Props) {
  return <DonationConfigCard scope="profile" entityId={profileUserId} {...rest} />;
}
