const GUEST_ID_KEY = "vibra_guest_id";
const GUEST_NICKNAME_KEY = "vibra_guest_nickname";

export function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

export function getSavedGuestNickname(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GUEST_NICKNAME_KEY) ?? "";
}

export function saveGuestNickname(nickname: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_NICKNAME_KEY, nickname.trim());
}
