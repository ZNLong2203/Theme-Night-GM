import { describe, expect, it } from "vitest";
import { cleanModelText } from "@/lib/text";

describe("cleanModelText", () => {
  it("drops entity IDs the model copied into prose", () => {
    const live = "anchored by *Missing Link* (ID: `9127217D-71AC-4338-8C06-62E0604D647C`). It ranks #1 among movies.";
    expect(cleanModelText(live)).toBe("anchored by *Missing Link*. It ranks #1 among movies.");
    expect(cleanModelText("Swapped in 9127217d-71ac-4338-8c06-62e0604d647c tonight")).toBe("Swapped in tonight");
  });

  it("removes code ticks but keeps emphasis for rendering", () => {
    expect(cleanModelText("**Mythical Night** uses `local_pct`")).toBe("**Mythical Night** uses local_pct");
  });

  it("leaves ordinary text alone", () => {
    expect(cleanModelText("Ranks #3 locally vs #11 nationally (0.68 vs a 0.5 fair share).")).toBe(
      "Ranks #3 locally vs #11 nationally (0.68 vs a 0.5 fair share).",
    );
  });
});
