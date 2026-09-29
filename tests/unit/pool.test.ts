import { describe, expect, it } from "vitest";
import { mapPool } from "../../server/pool";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapPool (máximo de concorrência simultâneo)", () => {
  it("nunca excede o teto de concorrência e atinge-o com trabalho suficiente", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { results, maxInFlight } = await mapPool(
      items,
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(10);
        inFlight--;
        return i * 2;
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBe(4);
    expect(results).toEqual(items.map((i) => i * 2));
  });

  it("preserva a ordem dos resultados mesmo com durações diferentes", async () => {
    const items = [50, 1, 30, 2, 10];
    const { results } = await mapPool(
      items,
      async (ms) => {
        await delay(ms);
        return `r${ms}`;
      },
      5,
    );
    expect(results).toEqual(["r50", "r1", "r30", "r2", "r10"]);
  });

  it("concorrência 1 executa em série (pico 1)", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(
      [1, 2, 3, 4],
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(5);
        inFlight--;
      },
      1,
    );
    expect(peak).toBe(1);
  });

  it("uma falha de worker propaga (quem chama decide o que fazer)", async () => {
    await expect(
      mapPool(
        [1, 2, 3],
        async (i) => {
          if (i === 2) throw new Error("boom");
          return i;
        },
        3,
      ),
    ).rejects.toThrow("boom");
  });

  it("lista vazia resolve sem lançar", async () => {
    const { results, maxInFlight } = await mapPool([], async () => 1, 8);
    expect(results).toEqual([]);
    expect(maxInFlight).toBe(0);
  });
});
