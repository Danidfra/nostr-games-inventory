import { describe, it, expect } from "vitest";
import {
  buildAddressableEventAddress,
  parseAddressableEventAddress,
  buildGameItemAddress,
  parseGameItemAddress,
  buildGameInventoryAddress,
  parseGameInventoryAddress,
  buildGameItemPlacementAddress,
  parseGameItemPlacementAddress,
  getDTag,
} from "../src/index.js";

describe("addressable event address helpers", () => {
  it("builds a well-formed address", () => {
    expect(buildAddressableEventAddress(31632, "pk", "a:b:c")).toBe(
      "31632:pk:a:b:c",
    );
  });

  it("throws when building with empty pubkey or identifier", () => {
    expect(() => buildAddressableEventAddress(31632, "", "id")).toThrow();
    expect(() => buildAddressableEventAddress(31632, "pk", "")).toThrow();
  });

  it("parses an address whose d-tag contains colons", () => {
    const parsed = parseAddressableEventAddress(
      "31632:pubkey123:blobbi:food:carrot",
    );
    expect(parsed).toEqual({
      kind: 31632,
      pubkey: "pubkey123",
      identifier: "blobbi:food:carrot",
    });
  });

  it("returns null for malformed addresses", () => {
    expect(parseAddressableEventAddress("")).toBeNull();
    expect(parseAddressableEventAddress("31632")).toBeNull();
    expect(parseAddressableEventAddress("31632:pk")).toBeNull();
    expect(parseAddressableEventAddress(":pk:id")).toBeNull();
    expect(parseAddressableEventAddress("abc:pk:id")).toBeNull();
    expect(parseAddressableEventAddress("31632::id")).toBeNull();
    expect(parseAddressableEventAddress("31632:pk:")).toBeNull();
  });

  it("optionally requires a 64-char hex pubkey", () => {
    const hex = "a".repeat(64);
    expect(
      parseAddressableEventAddress(`31632:${hex}:id`, {
        requireHexPubkey: true,
      }),
    ).not.toBeNull();
    expect(
      parseAddressableEventAddress("31632:pubkey123:id", {
        requireHexPubkey: true,
      }),
    ).toBeNull();
  });
});

describe("game item address", () => {
  it("round-trips", () => {
    const addr = buildGameItemAddress("pk", "blobbi:food:carrot");
    expect(addr).toBe("31632:pk:blobbi:food:carrot");
    expect(parseGameItemAddress(addr)).toEqual({
      kind: 31632,
      pubkey: "pk",
      itemId: "blobbi:food:carrot",
    });
  });

  it("rejects a non-31632 address", () => {
    expect(parseGameItemAddress("31633:pk:id")).toBeNull();
  });
});

describe("game inventory address", () => {
  it("round-trips", () => {
    const addr = buildGameInventoryAddress("owner", "game:blobbi");
    expect(addr).toBe("31633:owner:game:blobbi");
    expect(parseGameInventoryAddress(addr)).toEqual({
      kind: 31633,
      pubkey: "owner",
      inventoryId: "game:blobbi",
    });
  });

  it("rejects a non-31633 address", () => {
    expect(parseGameInventoryAddress("31632:pk:id")).toBeNull();
  });
});

describe("game item placement address", () => {
  it("round-trips", () => {
    const addr = buildGameItemPlacementAddress("pk", "placement:equipment");
    expect(addr).toBe("31634:pk:placement:equipment");
    expect(parseGameItemPlacementAddress(addr)).toEqual({
      kind: 31634,
      pubkey: "pk",
      placementId: "placement:equipment",
    });
  });

  it("preserves colons inside the d value", () => {
    const id = "blobbi-island:character:char-1:equipment";
    const addr = buildGameItemPlacementAddress("pk", id);
    expect(addr).toBe(`31634:pk:${id}`);
    expect(parseGameItemPlacementAddress(addr)?.placementId).toBe(id);
  });

  it("rejects a non-31634 address", () => {
    expect(parseGameItemPlacementAddress("31633:pk:id")).toBeNull();
    expect(parseGameItemPlacementAddress("31632:pk:id")).toBeNull();
  });

  it("rejects malformed addresses and an empty d", () => {
    expect(parseGameItemPlacementAddress("31634:pk")).toBeNull();
    expect(parseGameItemPlacementAddress("31634:pk:")).toBeNull();
    expect(parseGameItemPlacementAddress("31634::id")).toBeNull();
    expect(parseGameItemPlacementAddress("abc:pk:id")).toBeNull();
    expect(parseGameItemPlacementAddress("")).toBeNull();
  });

  it("optionally requires a hex pubkey", () => {
    const hex = "b".repeat(64);
    expect(
      parseGameItemPlacementAddress(`31634:${hex}:id`, {
        requireHexPubkey: true,
      }),
    ).not.toBeNull();
    expect(
      parseGameItemPlacementAddress("31634:pk:id", { requireHexPubkey: true }),
    ).toBeNull();
  });

  it("throws when building with an empty pubkey or id", () => {
    expect(() => buildGameItemPlacementAddress("", "id")).toThrow();
    expect(() => buildGameItemPlacementAddress("pk", "")).toThrow();
  });
});

describe("getDTag", () => {
  it("reads the d tag from tags or an event", () => {
    expect(getDTag([["d", "x"]])).toBe("x");
    expect(
      getDTag({
        id: "",
        pubkey: "",
        created_at: 0,
        kind: 31632,
        tags: [["d", "y"]],
        content: "",
        sig: "",
      }),
    ).toBe("y");
    expect(getDTag([["name", "x"]])).toBeUndefined();
  });
});
