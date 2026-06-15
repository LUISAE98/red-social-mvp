const KEY = "vibra_stories_muted";

export function getMutePreference(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
  }
}

export function setMutePreference(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    try { sessionStorage.setItem(KEY, muted ? "1" : "0"); } catch { /* Safari Private / storage full */ }
  }
}
