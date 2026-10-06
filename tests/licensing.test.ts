import { describe, expect, it } from "vitest";
import { licensingFor } from "@/lib/licensing";
import type { EntityCard } from "@/lib/types";

const card = (overrides: Partial<EntityCard>): EntityCard => ({ id: "x", name: "Test", kind: "movie", ...overrides });

describe("licensingFor", () => {
  it("rates a Disney-owned movie as high risk under either IP policy", () => {
    const moana = card({ name: "Moana 2", owners: ["Walt Disney Animation Studios"] });
    const light = licensingFor(moana, "ip_light");
    expect(light.risk).toBe("high");
    expect(light.note).toContain("Walt Disney Animation Studios owns this IP");
    expect(light.note).toContain("inspired-by");

    const licensed = licensingFor(moana, "licensed_ok");
    expect(licensed.risk).toBe("high");
    expect(licensed.note).toContain("Request a license");
  });

  it("matches the owner list case-insensitively and finds the major studio among co-producers", () => {
    const dune = card({ name: "Dune: Part Two", owners: ["Legendary", "Warner Bros."] });
    expect(licensingFor(dune, "ip_light")).toMatchObject({ risk: "high" });
    expect(licensingFor(card({ owners: ["NINTENDO"], kind: "videogame" }), "ip_light").risk).toBe("high");
  });

  it("rates an artist as medium risk (music covered, name and likeness need approval)", () => {
    const artist = licensingFor(card({ name: "Zach Bryan", kind: "artist" }), "licensed_ok");
    expect(artist.risk).toBe("medium");
    expect(artist.note).toContain("Zach Bryan-inspired");
  });

  it("checks the artist rule before the studio rule", () => {
    expect(licensingFor(card({ kind: "artist", owners: ["Sony Music"] }), "ip_light").risk).toBe("medium");
  });

  it("rates a brand-led night as medium risk", () => {
    expect(licensingFor(card({ name: "Cheerwine", kind: "brand" }), "ip_light").risk).toBe("medium");
  });

  it("rates an unowned or independent title as low risk", () => {
    expect(licensingFor(card({ name: "Everything Everywhere All at Once", owners: ["A24"] }), "ip_light").risk).toBe("low");
    expect(licensingFor(card({ name: "Bull Durham" }), "licensed_ok").risk).toBe("low");
  });
});
