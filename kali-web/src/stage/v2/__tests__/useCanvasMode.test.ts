import { describe, expect, it } from "vitest";
import {
  EMPTY_HUB, arrive, back, bringBack, closeLamina, explore, forget, fromStudio, matchShowRequest, restoreHub, sendOut, toPersistedHub,
  toggleThread, type HubModel,
} from "../useCanvasMode";

const hub = (patch: Partial<HubModel>): HubModel => ({ ...EMPTY_HUB, ...patch });

describe("the single lámina", () => {
  it("a new artifact takes the lámina and the previous one becomes the first card", () => {
    let h = arrive(EMPTY_HUB, 1);
    expect(h).toMatchObject({ state: "lamina", currentId: 1, previousIds: [] });
    h = arrive(h, 2);
    expect(h).toMatchObject({ state: "lamina", currentId: 2, previousIds: [1] });
    h = arrive(h, 3);
    expect(h.previousIds).toEqual([2, 1]);
  });

  it("an arrival keeps Explorar and leaves Hilo for the lámina", () => {
    expect(arrive(hub({ state: "explorar", currentId: 1 }), 2)).toMatchObject({ state: "explorar", currentId: 2, previousIds: [1] });
    expect(arrive(hub({ state: "hilo", before: "escucha" }), 2).state).toBe("lamina");
  });

  it("a card brought back swaps places with the lámina", () => {
    const h = bringBack(hub({ state: "lamina", currentId: 3, previousIds: [2, 1] }), 1);
    expect(h).toMatchObject({ state: "lamina", currentId: 1, previousIds: [3, 2] });
    expect(bringBack(hub({ state: "escucha", currentId: null, previousIds: [5] }), 5)).toMatchObject({ state: "lamina", currentId: 5, previousIds: [] });
  });

  it("putting the lámina down makes it the first card", () => {
    expect(closeLamina(hub({ state: "lamina", currentId: 2, previousIds: [1] }))).toMatchObject({ state: "escucha", currentId: null, previousIds: [2, 1] });
  });

  it("Explorar needs a lámina", () => {
    expect(explore(EMPTY_HUB)).toBe(EMPTY_HUB);
    expect(explore(hub({ state: "lamina", currentId: 1 })).state).toBe("explorar");
  });

  it("Esc walks back: Explorar → Lámina → Escucha, then nothing", () => {
    let h: HubModel | null = hub({ state: "explorar", currentId: 1 });
    h = back(h)!;
    expect(h.state).toBe("lamina");
    h = back(h)!;
    expect(h).toMatchObject({ state: "escucha", previousIds: [1] });
    expect(back(h)).toBeNull();
  });

  it("Hilo returns where it came from", () => {
    const fromExplore = toggleThread(hub({ state: "explorar", currentId: 1 }));
    expect(fromExplore).toMatchObject({ state: "hilo", before: "explorar" });
    expect(back(fromExplore)!.state).toBe("explorar");
    expect(toggleThread(toggleThread(hub({ state: "lamina", currentId: 1 }))).state).toBe("lamina");
    expect(toggleThread(toggleThread(EMPTY_HUB)).state).toBe("escucha");
  });

  it("a closed window leaves the lámina and the cards", () => {
    expect(forget(hub({ state: "lamina", currentId: 2, previousIds: [1] }), 2)).toMatchObject({ state: "escucha", currentId: null, previousIds: [1] });
    expect(forget(hub({ state: "lamina", currentId: 2, previousIds: [1] }), 1).previousIds).toEqual([]);
    expect(forget(hub({ state: "hilo", currentId: 2, before: "lamina" }), 2)).toMatchObject({ state: "hilo", before: "escucha" });
    const same = hub({ currentId: 2 });
    expect(forget(same, 9)).toBe(same);
  });
});

describe("Studio → Hub", () => {
  it("the active tab is the lámina and the rest of its group the first cards", () => {
    const h = fromStudio(hub({ state: "escucha", currentId: 7, previousIds: [8, 3] }), 2, [1, 2, 3]);
    expect(h).toMatchObject({ state: "lamina", currentId: 2, previousIds: [1, 3, 7, 8] });
  });
  it("with nothing open it keeps what it had", () => {
    expect(fromStudio(hub({ currentId: 4 }), null, []).state).toBe("lamina");
    expect(fromStudio(EMPTY_HUB, null, []).state).toBe("escucha");
  });
});

describe("persistence by artifact", () => {
  const art = (id: number) => `art-${id}`;
  it("saves ids as artifacts and Hilo as where it came from", () => {
    expect(toPersistedHub(hub({ state: "hilo", before: "lamina", currentId: 2, previousIds: [1] }), art)).toEqual({ state: "lamina", current: "art-2", previous: ["art-1"] });
  });
  it("restores the windows that come back after a reload", () => {
    const saved = { state: "explorar" as const, current: "art-20", previous: ["art-10"] };
    const h = restoreHub(EMPTY_HUB, saved, [{ id: 10, artifactId: "art-10" }, { id: 20, artifactId: "art-20" }]);
    expect(h).toMatchObject({ state: "explorar", currentId: 20, previousIds: [10] });
  });
});

describe("«muéstrame el plan»", () => {
  const cards = [{ id: 1, title: "Plan de la mudanza.md" }, { id: 2, title: "styles.css" }, { id: 3, title: "Presupuesto mensual" }];
  it("needs a show verb", () => {
    expect(matchShowRequest("el plan de la mudanza está bien", cards)).toBeNull();
  });
  it("matches the title or its main words, without accents or extension", () => {
    expect(matchShowRequest("Muéstrame el plan de la mudanza", cards)).toBe(1);
    expect(matchShowRequest("abre styles.css otra vez", cards)).toBe(2);
    expect(matchShowRequest("enseñame el presupuesto mensual por favor", cards)).toBe(3);
    expect(matchShowRequest("show me the budget", cards)).toBeNull();
  });
});

describe("own window (desktop)", () => {
  it("the lámina going out leaves the Hub listening and heads the cards", () => {
    const h = sendOut(hub({ state: "lamina", currentId: 3, previousIds: [1, 2] }), 3);
    expect(h).toMatchObject({ state: "escucha", currentId: null, previousIds: [3, 1, 2] });
  });
  it("keeps the thread open and ignores a card that goes out", () => {
    expect(sendOut(hub({ state: "hilo", currentId: 3, before: "lamina" }), 3)).toMatchObject({ state: "hilo", currentId: null, before: "escucha" });
    const h = hub({ state: "lamina", currentId: 3, previousIds: [1] });
    expect(sendOut(h, 1)).toBe(h);
  });
});
