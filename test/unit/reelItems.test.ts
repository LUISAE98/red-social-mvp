import { describe, expect, it } from "vitest";
import {
  isLiveItem,
  isLiveOngoing,
  isStoryItem,
  liveItem,
  liveStartedAtMs,
  storiesOf,
  storyItem,
  type ReelLivePost,
} from "@/lib/reels/reelItems";
import type { StoryDoc } from "@/lib/stories/types";

const NOW = 1_760_000_000_000;

/** Una marca de tiempo de Firestore, en lo que este código necesita de ella. */
function ts(ms: number) {
  return { toMillis: () => ms } as unknown as NonNullable<ReelLivePost["liveData"]>["startedAt"];
}

function live(opts: Partial<NonNullable<ReelLivePost["liveData"]>> = {}): ReelLivePost {
  return {
    id: "post-1",
    authorId: "creator-1",
    liveData: {
      status: "live",
      visibilityMode: "everyone",
      allowLoggedOutViewers: true,
      startedAt: ts(NOW - 60_000),
      ...opts,
    },
  } as ReelLivePost;
}

function story(id: string): StoryDoc {
  return { id, creatorId: "c", type: "consejo" } as StoryDoc;
}

describe("isLiveOngoing", () => {
  it("acepta un live abierto que ya empezó y no ha terminado", () => {
    expect(isLiveOngoing(live(), NOW)).toBe(true);
  });

  it("rechaza el que aún no ha empezado", () => {
    expect(isLiveOngoing(live({ startedAt: null }), NOW)).toBe(false);
  });

  it("rechaza el que ya terminó", () => {
    expect(isLiveOngoing(live({ endedAt: ts(NOW - 1_000) }), NOW)).toBe(false);
  });

  it("rechaza el que no está abierto a todos", () => {
    expect(isLiveOngoing(live({ visibilityMode: "logged_in_only" }), NOW)).toBe(false);
  });

  // El caso que motiva todo el predicado: el estado se queda pegado en "live"
  // cuando la transmisión se corta mal, y sin esto el feed enseñaría una
  // pantalla muerta hasta que el cierre automático pase.
  it("rechaza una transmisión directa que lleva callada más de dos minutos", () => {
    const caido = live({ broadcastMode: "direct", heartbeatAt: ts(NOW - 130_000) });
    expect(isLiveOngoing(caido, NOW)).toBe(false);
  });

  it("acepta una transmisión directa con señal reciente", () => {
    const vivo = live({ broadcastMode: "direct", heartbeatAt: ts(NOW - 20_000) });
    expect(isLiveOngoing(vivo, NOW)).toBe(true);
  });

  it("rechaza una transmisión directa que nunca dio señal", () => {
    expect(isLiveOngoing(live({ broadcastMode: "direct" }), NOW)).toBe(false);
  });

  // Una transmisión por RTMP (OBS) no escribe señal de vida: exigirla la dejaría
  // fuera del feed siempre.
  it("no le exige señal de vida a una transmisión por RTMP", () => {
    expect(isLiveOngoing(live({ broadcastMode: "rtmp" }), NOW)).toBe(true);
  });
});

describe("claves de los elementos del feed", () => {
  it("distingue un live de una historia que tuviera el mismo id", () => {
    const s = storyItem(story("abc"));
    const l = liveItem({ ...live(), id: "abc" });
    expect(s.key).not.toBe(l.key);
  });

  it("reconoce cada tipo", () => {
    expect(isStoryItem(storyItem(story("a")))).toBe(true);
    expect(isLiveItem(storyItem(story("a")))).toBe(false);
    expect(isLiveItem(liveItem(live()))).toBe(true);
  });

  it("saca las historias de una lista mezclada conservando el orden", () => {
    const items = [storyItem(story("a")), liveItem(live()), storyItem(story("b"))];
    expect(storiesOf(items).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("liveStartedAtMs", () => {
  it("lee la marca de tiempo", () => {
    expect(liveStartedAtMs(live({ startedAt: ts(123) }))).toBe(123);
  });

  it("da cero si no consta, para que ordenar no reviente", () => {
    expect(liveStartedAtMs(live({ startedAt: null }))).toBe(0);
  });
});
