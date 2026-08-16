import { describe, expect, it } from "vitest";
import { mixByQuota, rankStories, splitLanes, type ReelLane } from "@/lib/reels/reelRanking";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import type { CanonicalGroupCategory } from "@/types/group";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

function story(
  id: string,
  opts: {
    type?: StoryType;
    ageDays?: number;
    views?: number;
    categories?: CanonicalGroupCategory[];
  } = {},
): StoryDoc {
  const createdMs = NOW - (opts.ageDays ?? 0) * DAY_MS;
  return {
    id,
    creatorId: `creator-${id}`,
    type: opts.type ?? "consejo",
    muxPlaybackId: `pb-${id}`,
    thumbnailUrl: null,
    videoDuration: 10,
    greetingRequestId: `req-${id}`,
    source: "profile",
    groupId: null,
    createdAt: { toMillis: () => createdMs } as StoryDoc["createdAt"],
    viewsCount: opts.views ?? 0,
    categories: opts.categories,
  } as StoryDoc;
}

const NO_TASTE = new Map<CanonicalGroupCategory, number>();
const NO_VIEWS = new Map<string, number>();

describe("rankStories", () => {
  it("deja lo ya visto detrás de todo lo no visto", () => {
    const stories = [story("visto", { views: 9999 }), story("nuevo", { views: 0 })];
    const viewed = new Map([["visto", NOW - DAY_MS]]);

    const out = rankStories(stories, NO_TASTE, viewed, NOW).map((s) => s.id);

    // "visto" gana por popularidad, pero haberla visto pesa más.
    expect(out).toEqual(["nuevo", "visto"]);
  });

  it("dentro de lo ya visto, primero lo que viste hace más tiempo", () => {
    const stories = [story("reciente"), story("antiguo")];
    const viewed = new Map([
      ["reciente", NOW - DAY_MS],
      ["antiguo", NOW - 40 * DAY_MS],
    ]);

    const out = rankStories(stories, NO_TASTE, viewed, NOW).map((s) => s.id);

    expect(out).toEqual(["antiguo", "reciente"]);
  });

  it("en frío ordena por popularidad y frescura, no solo por fecha", () => {
    const stories = [
      story("vieja-popular", { ageDays: 60, views: 5000 }),
      story("nueva-ignorada", { ageDays: 0, views: 0 }),
    ];

    const out = rankStories(stories, NO_TASTE, NO_VIEWS, NOW).map((s) => s.id);

    expect(out[0]).toBe("vieja-popular");
  });

  it("una afinidad FUERTE gana a una popularidad enorme", () => {
    // 5 es el techo de saturación de afinidad: un interés bien establecido.
    const taste = new Map<CanonicalGroupCategory, number>([["musica", 5]]);
    const stories = [
      story("popular-sin-afinidad", { views: 20000 }),
      story("afin", { views: 0, categories: ["musica"] }),
    ];

    const out = rankStories(stories, taste, NO_VIEWS, NOW).map((s) => s.id);

    expect(out[0]).toBe("afin");
  });

  it("una afinidad DÉBIL no gana a una popularidad enorme", () => {
    // El caso que destapó que las escalas no eran comparables: sin normalizar,
    // ningún peso hacía que la afinidad pesara, porque log1p(20000) ≈ 9.9 contra
    // una afinidad de 1. Ahora pierde, pero por la razón correcta.
    const taste = new Map<CanonicalGroupCategory, number>([["musica", 0.5]]);
    const stories = [
      story("popular-sin-afinidad", { views: 20000 }),
      story("apenas-afin", { views: 0, categories: ["musica"] }),
    ];

    const out = rankStories(stories, taste, NO_VIEWS, NOW).map((s) => s.id);

    expect(out[0]).toBe("popular-sin-afinidad");
  });

  it("la popularidad satura: 100k vistas no vale mucho más que 1k", () => {
    const taste = new Map<CanonicalGroupCategory, number>([["musica", 5]]);
    const viral = story("viral", { views: 100_000 });
    const decente = story("decente", { views: 1000, categories: ["musica"] });

    const out = rankStories([viral, decente], taste, NO_VIEWS, NOW).map((s) => s.id);

    // Sin techo, "viral" arrasaría. Con techo, la afinidad decide.
    expect(out[0]).toBe("decente");
  });
});

describe("mixByQuota", () => {
  it("respeta aproximadamente la cuota 82/18 cuando hay material de sobra", () => {
    const lanes = {
      consejo: Array.from({ length: 50 }, (_, i) => story(`c${i}`, { type: "consejo" })),
      saludo: Array.from({ length: 50 }, (_, i) => story(`s${i}`, { type: "saludo" })),
    };

    const out = mixByQuota(lanes, { consejo: 0.82, saludo: 0.18, live: 0 });
    const first50 = out.slice(0, 50);
    const consejos = first50.filter((s) => s.type === "consejo").length;

    // 82% de 50 son 41. Se admite algo de holgura por el redondeo del reparto.
    expect(consejos).toBeGreaterThanOrEqual(39);
    expect(consejos).toBeLessThanOrEqual(43);
  });

  it("no deja huecos cuando un carril se queda sin material", () => {
    const lanes = {
      consejo: Array.from({ length: 10 }, (_, i) => story(`c${i}`, { type: "consejo" })),
      saludo: [story("s0", { type: "saludo" })],
    };

    const out = mixByQuota(lanes, { consejo: 0.82, saludo: 0.18, live: 0 });

    // Las once salen todas; el turno del carril agotado lo ocupa el otro.
    expect(out).toHaveLength(11);
    expect(new Set(out.map((s) => s.id)).size).toBe(11);
  });

  it("con un solo carril con material, devuelve ese carril tal cual", () => {
    const consejo = Array.from({ length: 5 }, (_, i) => story(`c${i}`, { type: "consejo" }));

    const out = mixByQuota({ consejo, saludo: [] }, { consejo: 0.82, saludo: 0.18, live: 0 });

    expect(out.map((s) => s.id)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("ignora los carriles con cuota cero aunque traigan material", () => {
    // Es el caso de los lives hoy: el carril existe declarado pero en cero.
    const lanes: Partial<Record<ReelLane, StoryDoc[]>> = {
      consejo: [story("c0")],
      live: [story("l0")],
    };

    const out = mixByQuota(lanes, { consejo: 1, saludo: 0, live: 0 });

    expect(out.map((s) => s.id)).toEqual(["c0"]);
  });

  it("conserva el orden de entrada dentro de cada carril", () => {
    const lanes = {
      consejo: [story("c0"), story("c1"), story("c2")],
      saludo: [story("s0", { type: "saludo" }), story("s1", { type: "saludo" })],
    };

    const out = mixByQuota(lanes, { consejo: 0.5, saludo: 0.5, live: 0 });
    const consejos = out.filter((s) => s.type === "consejo").map((s) => s.id);
    const saludos = out.filter((s) => s.type === "saludo").map((s) => s.id);

    expect(consejos).toEqual(["c0", "c1", "c2"]);
    expect(saludos).toEqual(["s0", "s1"]);
  });
});

describe("splitLanes", () => {
  it("separa por tipo conservando el orden", () => {
    const stories = [
      story("c0", { type: "consejo" }),
      story("s0", { type: "saludo" }),
      story("c1", { type: "consejo" }),
    ];

    const lanes = splitLanes(stories);

    expect(lanes.consejo?.map((s) => s.id)).toEqual(["c0", "c1"]);
    expect(lanes.saludo?.map((s) => s.id)).toEqual(["s0"]);
  });
});
