import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalSeen, markSeenLocally } from "@/lib/reels/reelSeenLocal";

const KEY = "vibra_reel_seen";

/** Un almacenamiento de mentira, con la misma forma que el del navegador. */
function fakeStorage() {
  let data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    clear: () => { data = {}; },
    get raw() { return data; },
  };
}

let storage = fakeStorage();

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

describe("memoria de lo visto en el navegador", () => {
  it("recuerda una historia y la devuelve", () => {
    markSeenLocally("a");
    expect(loadLocalSeen().has("a")).toBe(true);
  });

  it("no cuenta dos veces la misma", () => {
    markSeenLocally("a");
    markSeenLocally("a");
    expect(loadLocalSeen().size).toBe(1);
  });

  it("ignora un id vacío", () => {
    markSeenLocally("");
    expect(loadLocalSeen().size).toBe(0);
  });

  // El almacenamiento del navegador no puede crecer sin fin.
  it("poda las más antiguas al pasar del tope", () => {
    const viejas: Record<string, number> = {};
    for (let i = 0; i < 600; i++) viejas[`vieja-${i}`] = i;
    storage.setItem(KEY, JSON.stringify(viejas));

    markSeenLocally("nueva");
    const out = loadLocalSeen();

    expect(out.size).toBeLessThanOrEqual(500);
    // Lo recién visto se queda; lo más antiguo se va.
    expect(out.has("nueva")).toBe(true);
    expect(out.has("vieja-0")).toBe(false);
  });

  // Modo privado, almacenamiento lleno o contenido corrupto: sin memoria el feed
  // sigue funcionando, solo repite.
  it("aguanta contenido corrupto sin reventar", () => {
    storage.setItem(KEY, "esto no es json");
    expect(loadLocalSeen().size).toBe(0);
    expect(() => markSeenLocally("a")).not.toThrow();
  });

  it("aguanta que el almacenamiento falle al escribir", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error("lleno"); },
      },
    });
    expect(() => markSeenLocally("a")).not.toThrow();
  });
});
