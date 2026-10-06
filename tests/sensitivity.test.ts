import { describe, expect, it } from "vitest";
import { identityTheme, isAlcoholBrand, sensitiveTopic } from "@/lib/sensitivity";

describe("isAlcoholBrand", () => {
  it("flags brewers, distillers and alcoholic-beverage industries", () => {
    expect(isAlcoholBrand({ name: "Stone Brewing Company" })).toBe(true);
    expect(isAlcoholBrand({ name: "Acme Holdings", industries: ["Alcoholic Beverages"] })).toBe(true);
    expect(isAlcoholBrand({ name: "Acme Holdings", category: "Beer" })).toBe(true);
    expect(isAlcoholBrand({ name: "Buffalo Trace", tags: ["Bourbon"] })).toBe(true);
    expect(isAlcoholBrand({ name: "White Claw Hard Seltzer" })).toBe(true);
  });

  it("does not flag soft drinks or explicitly non-alcoholic brands", () => {
    expect(isAlcoholBrand({ name: "Canada Dry", industries: ["Soft Drinks"] })).toBe(false);
    expect(isAlcoholBrand({ name: "Fizz Co", tags: ["Non-Alcoholic Beverages"] })).toBe(false);
    expect(isAlcoholBrand({ name: "Fizz Co", industries: ["Non Alcoholic Drinks"] })).toBe(false);
    expect(isAlcoholBrand({ name: "Verizon", industries: ["Telecommunications"] })).toBe(false);
  });

  it("matches whole words only", () => {
    expect(isAlcoholBrand({ name: "Drumstick", industries: ["Frozen Desserts"] })).toBe(false);
    expect(isAlcoholBrand({ name: "Rumble Sports" })).toBe(false);
  });
});

describe("identityTheme", () => {
  it("catches identity-based night framing in the title or tagline", () => {
    expect(identityTheme("LA Pride Night")).toBe("pride");
    expect(identityTheme("Heritage Night")).toBe("heritage");
    expect(identityTheme("Fan Night", "Celebrating our faith community")).toBe("faith");
    expect(identityTheme("LGBTQ+ Night")).toBe("lgbtq");
  });

  it("leaves fandom-led titles alone", () => {
    expect(identityTheme("Bull City Beats")).toBeUndefined();
    expect(identityTheme("Gamers Night", "Pixel-art player cards and a scavenger hunt")).toBeUndefined();
  });
});

describe("sensitiveTopic", () => {
  it("flags political and religious titles", () => {
    expect(sensitiveTopic({ name: "The Election" })).toBe("election");
    expect(sensitiveTopic({ name: "Presidential Debates Live" })).toBe("presidential");
    expect(sensitiveTopic({ name: "The Bible Project" })).toBe("bible");
    expect(sensitiveTopic({ name: "Sunday Church Hour" })).toBe("church");
  });

  it("checks the subtitle as well as the name", () => {
    expect(sensitiveTopic({ name: "Morbid", subtitle: "A true crime podcast" })).toBe("crime");
  });

  it("flags unambiguous political or religious tags", () => {
    expect(sensitiveTopic({ name: "The Chosen", tags: ["Drama", "Christian"] })).toBe("christian");
    expect(sensitiveTopic({ name: "Pod Save America", tags: ["Comedy", "Politics"] })).toBe("politics");
  });

  it("does not flag franchises that merely contain a sensitive substring", () => {
    expect(sensitiveTopic({ name: "Star Wars", tags: ["Sci-Fi", "Space Opera"] })).toBeUndefined();
  });

  it("does not flag a family film for a noisy keyword tag like Death", () => {
    expect(sensitiveTopic({ name: "Coco", subtitle: "Animation · Family", tags: ["Death", "Family", "Music"] })).toBeUndefined();
  });
});
