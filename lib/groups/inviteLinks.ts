import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type CreateInviteLinkInput = {
  groupId: string;
  expiresInHours: number;
  maxUses?: number | null;
};

export type CreateInviteLinkResult = {
  success: boolean;
  inviteLinkId: string;
  token: string;
  path: string;
  groupId: string;
  groupName: string;
  visibility: "private" | "hidden" | null;
  expiresAt: string;
  maxUses: number | null;
};

export type InviteLinkPreviewResult = {
  success: boolean;
  token: string;
  group: {
    id: string;
    name: string;
    description: string;
    visibility: "private" | "hidden" | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    isActive: boolean;
    requiresSubscription: boolean;
    subscriptionPrice: number | null;
    subscriptionCurrency: string | null;
  };
  invite: {
    isActive: boolean;
    isExpired: boolean;
    exhausted: boolean;
    revoked: boolean;
    usedCount: number;
    maxUses: number | null;
    expiresAt: string | null;
  };
};

export type ConsumeInviteLinkResult = {
  success: boolean;
  groupId: string;
  groupName: string;
  visibility: "private" | "hidden" | null;
  outcome: "owner" | "already_joined" | "joined" | "requested";
  message: string;
};

export async function createInviteLink(
  input: CreateInviteLinkInput
): Promise<CreateInviteLinkResult> {
  const fn = httpsCallable<CreateInviteLinkInput, CreateInviteLinkResult>(
    functions,
    "createInviteLink"
  );

  const res = await fn(input);
  return res.data;
}

export async function getInviteLinkPreview(
  token: string
): Promise<InviteLinkPreviewResult> {
  const fn = httpsCallable<{ token: string }, InviteLinkPreviewResult>(
    functions,
    "getInviteLinkPreview"
  );

  const res = await fn({ token });
  return res.data;
}

export async function consumeInviteLink(
  token: string
): Promise<ConsumeInviteLinkResult> {
  const fn = httpsCallable<{ token: string }, ConsumeInviteLinkResult>(
    functions,
    "consumeInviteLink"
  );

  const res = await fn({ token });
  return res.data;
}

export type InviteLinkListItem = {
  id: string;
  token: string;
  path: string;
  usedCount: number;
  maxUses: number | null;
  expiresAt: string | null;
  expiresAtMs: number | null;
  createdAtMs: number | null;
};

export type ListInviteLinksResult = {
  success: boolean;
  groupId: string;
  links: InviteLinkListItem[];
};

export type RevokeInviteLinkResult = {
  success: boolean;
  groupId: string;
  inviteLinkId: string;
};

export async function listInviteLinks(
  groupId: string
): Promise<ListInviteLinksResult> {
  const fn = httpsCallable<{ groupId: string }, ListInviteLinksResult>(
    functions,
    "listInviteLinks"
  );

  const res = await fn({ groupId });
  return res.data;
}

export async function revokeInviteLink(input: {
  groupId: string;
  inviteLinkId: string;
}): Promise<RevokeInviteLinkResult> {
  const fn = httpsCallable<typeof input, RevokeInviteLinkResult>(
    functions,
    "revokeInviteLink"
  );

  const res = await fn(input);
  return res.data;
}

export function buildInviteAbsoluteUrl(token: string) {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/invite/${token}`;
  }

  return `/invite/${token}`;
}