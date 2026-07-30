import { describe, it, expect } from "vitest";
import {
  parseGameItemDefinition,
  parseGameItemDefinitionResult,
  buildGameItemDefinitionEvent,
  validateGameItemDefinition,
  getPrimaryItemImage,
  getItemImageByMarker,
  getItemImagesByMarker,
  isGameItemImageMarker,
  GAME_ITEM_IMAGE_MARKERS,
  KIND_GAME_ITEM_DEFINITION,
} from "../src/index.js";
import { makeEvent, expectOk } from "./helpers.js";

const validTags = [
  ["d", "blobbi:food:carrot"],
  ["name", "Carrot"],
  ["type", "consumable"],
];

describe("validateGameItemDefinition", () => {
  it("accepts a valid item definition", () => {
    const event = makeEvent({ kind: 31632, tags: validTags });
    expect(validateGameItemDefinition(event).valid).toBe(true);
  });

  it("rejects wrong kind", () => {
    const event = makeEvent({ kind: 1, tags: validTags });
    const r = validateGameItemDefinition(event);
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("wrong-kind");
  });

  it("rejects missing d", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ["name", "Carrot"],
        ["type", "consumable"],
      ],
    });
    expect(
      validateGameItemDefinition(event).issues.map((i) => i.code),
    ).toContain("missing-d");
  });

  it("rejects empty d", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ["d", ""],
        ["name", "Carrot"],
        ["type", "consumable"],
      ],
    });
    expect(
      validateGameItemDefinition(event).issues.map((i) => i.code),
    ).toContain("empty-d");
  });

  it("rejects missing name", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ["d", "x"],
        ["type", "consumable"],
      ],
    });
    expect(
      validateGameItemDefinition(event).issues.map((i) => i.code),
    ).toContain("missing-name");
  });

  it("rejects missing type", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ["d", "x"],
        ["name", "Carrot"],
      ],
    });
    expect(
      validateGameItemDefinition(event).issues.map((i) => i.code),
    ).toContain("missing-type");
  });

  it("rejects invalid JSON content only when required", () => {
    const event = makeEvent({
      kind: 31632,
      tags: validTags,
      content: "{not json",
    });
    expect(validateGameItemDefinition(event).valid).toBe(true);
    expect(
      validateGameItemDefinition(event, { requireJsonContent: true }).valid,
    ).toBe(false);
  });
});

describe("parseGameItemDefinition", () => {
  it("parses a valid definition and its address", () => {
    const event = makeEvent({
      kind: 31632,
      pubkey: "issuerpk",
      tags: [
        ...validTags,
        ["category", "food"],
        ["image", "https://example.com/carrot.png"],
        ["context", "game:blobbi"],
        ["t", "edible"],
        ["t", "vegetable"],
        ["rarity", "common"],
        ["max_stack", "99"],
        ["alt", "Game item definition: Carrot"],
      ],
    });
    const def = parseGameItemDefinition(event);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("blobbi:food:carrot");
    expect(def?.address).toBe("31632:issuerpk:blobbi:food:carrot");
    expect(def?.issuer).toBe("issuerpk");
    expect(def?.name).toBe("Carrot");
    expect(def?.type).toBe("consumable");
    expect(def?.category).toBe("food");
    expect(def?.image).toBe("https://example.com/carrot.png");
    expect(def?.images).toEqual([{ url: "https://example.com/carrot.png" }]);
    expect(def?.contexts).toEqual(["game:blobbi"]);
    expect(def?.topics).toEqual(["edible", "vegetable"]);
    expect(def?.maxStack).toBe("99");
  });

  it("returns null on invalid event", () => {
    const event = makeEvent({ kind: 31632, tags: [["name", "x"]] });
    expect(parseGameItemDefinition(event)).toBeNull();
  });

  it("captures multiple t tags", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [...validTags, ["t", "a"], ["t", "b"], ["t", "c"]],
    });
    expect(parseGameItemDefinition(event)?.topics).toEqual(["a", "b", "c"]);
  });

  it("parses a based_on reference", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ...validTags,
        ["a", "31632:farmpk:farm:food:carrot", "", "based_on"],
      ],
    });
    const def = parseGameItemDefinition(event);
    expect(def?.basedOn).toEqual([
      { address: "31632:farmpk:farm:food:carrot", relay: "" },
    ]);
  });

  it("ignores an a tag without the based_on marker", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [...validTags, ["a", "31632:farmpk:x", "", "other"]],
    });
    expect(parseGameItemDefinition(event)?.basedOn).toEqual([]);
  });

  it("handles empty content", () => {
    const event = makeEvent({ kind: 31632, tags: validTags, content: "" });
    const def = parseGameItemDefinition(event);
    expect(def?.content).toBe("");
    expect(def?.contentJson).toBeUndefined();
  });

  it("parses valid JSON content and preserves the raw string", () => {
    const content = '{"description":"A crunchy carrot."}';
    const event = makeEvent({ kind: 31632, tags: validTags, content });
    const def = parseGameItemDefinition(event);
    expect(def?.content).toBe(content);
    expect(def?.contentJson).toEqual({ description: "A crunchy carrot." });
  });

  it("tolerates invalid JSON content in permissive mode with a warning", () => {
    const event = makeEvent({
      kind: 31632,
      tags: validTags,
      content: "{not json",
    });
    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.contentJson).toBeUndefined();
    expect(result.value.content).toBe("{not json");
    expect(result.warnings.map((w) => w.code)).toContain(
      "invalid-json-content",
    );
  });

  it("rejects invalid JSON content in strict mode", () => {
    const event = makeEvent({
      kind: 31632,
      tags: validTags,
      content: "{not json",
    });
    const result = parseGameItemDefinitionResult(event, { mode: "strict" });
    expect(result.ok).toBe(false);
  });

  it("preserves unknown tags on the underlying event", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [...validTags, ["custom-tag", "value"]],
    });
    const def = parseGameItemDefinition(event);
    expect(def?.event.tags).toContainEqual(["custom-tag", "value"]);
  });
});

describe("image tags", () => {
  const base = [
    ["d", "blobbi:cosmetic:wizard_hat"],
    ["name", "Wizard Hat"],
    ["type", "cosmetic"],
  ];

  const parseWith = (imageTags: string[][]) =>
    parseGameItemDefinitionResult(
      makeEvent({ kind: 31632, tags: [...base, ...imageTags] }),
    );

  it("parses a primary image with no marker", () => {
    const result = expectOk(parseWith([["image", "https://ex.com/hat.png"]]));
    expect(result.value.image).toBe("https://ex.com/hat.png");
    expect(result.value.images).toEqual([{ url: "https://ex.com/hat.png" }]);
    expect(result.warnings).toHaveLength(0);
  });

  it("parses multiple image view tags in tag order", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/hat.png"],
        ["image", "https://ex.com/hat-front.png", "front"],
        ["image", "https://ex.com/hat-side-right.png", "side-right"],
        ["image", "https://ex.com/hat-back.png", "back"],
      ]),
    );
    expect(result.value.images).toEqual([
      { url: "https://ex.com/hat.png" },
      { url: "https://ex.com/hat-front.png", marker: "front" },
      { url: "https://ex.com/hat-side-right.png", marker: "side-right" },
      { url: "https://ex.com/hat-back.png", marker: "back" },
    ]);
  });

  it("keeps the unmarked image as primary even when it is not first", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/hat-front.png", "front"],
        ["image", "https://ex.com/hat.png"],
        ["image", "https://ex.com/hat-back.png", "back"],
      ]),
    );
    expect(result.value.image).toBe("https://ex.com/hat.png");
  });

  it("uses the first unmarked image when several are unmarked", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/first.png"],
        ["image", "https://ex.com/second.png"],
      ]),
    );
    expect(result.value.image).toBe("https://ex.com/first.png");
    expect(result.value.images).toHaveLength(2);
  });

  it("falls back to the first marked image when none is unmarked", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/hat-front.png", "front"],
        ["image", "https://ex.com/hat-back.png", "back"],
      ]),
    );
    expect(result.value.image).toBe("https://ex.com/hat-front.png");
  });

  it("leaves image undefined and images empty when there is no image tag", () => {
    const result = expectOk(parseWith([]));
    expect(result.value.image).toBeUndefined();
    expect(result.value.images).toEqual([]);
  });

  it("ignores image tags with a missing or empty URL, with a warning", () => {
    const result = expectOk(
      parseWith([
        ["image"],
        ["image", ""],
        ["image", "   ", "front"],
        ["image", "https://ex.com/hat.png"],
      ]),
    );
    expect(result.value.image).toBe("https://ex.com/hat.png");
    expect(result.value.images).toEqual([{ url: "https://ex.com/hat.png" }]);
    expect(
      result.warnings.filter((w) => w.code === "invalid-image-tag"),
    ).toHaveLength(3);
  });

  it("leaves image undefined when the only image tag is empty", () => {
    const result = expectOk(parseWith([["image", ""]]));
    expect(result.value.image).toBeUndefined();
    expect(result.value.images).toEqual([]);
  });

  it("preserves an unknown marker as a string", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/hat.png"],
        ["image", "https://ex.com/hat-top.png", "top-down"],
      ]),
    );
    expect(result.value.images[1]).toEqual({
      url: "https://ex.com/hat-top.png",
      marker: "top-down",
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("treats a blank marker slot as unmarked", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/hat-front.png", "front"],
        ["image", "https://ex.com/hat.png", "  "],
      ]),
    );
    expect(result.value.images[1]).toEqual({ url: "https://ex.com/hat.png" });
    expect(result.value.image).toBe("https://ex.com/hat.png");
  });

  it("stays valid and parses when the item has only marked images", () => {
    const tags = [
      ...base,
      ["image", "https://ex.com/hat-front.png", "front"],
      ["image", "https://ex.com/hat-back.png", "back"],
    ];
    const event = makeEvent({ kind: 31632, tags });

    // Authoring guidance only: the event is still a valid item definition.
    expect(validateGameItemDefinition(event).valid).toBe(true);
    expect(parseGameItemDefinition(event)).not.toBeNull();

    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.image).toBe("https://ex.com/hat-front.png");
    expect(result.value.images).toHaveLength(2);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "missing-primary-image",
    ]);
  });

  it("does not reject marked-images-only items in strict mode", () => {
    const result = parseGameItemDefinitionResult(
      makeEvent({
        kind: 31632,
        tags: [...base, ["image", "https://ex.com/hat-front.png", "front"]],
      }),
      { mode: "strict" },
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain(
      "missing-primary-image",
    );
  });

  it("does not warn when exactly one unmarked image is published", () => {
    const result = expectOk(
      parseWith([
        ["image", "https://ex.com/hat.png"],
        ["image", "https://ex.com/hat-front.png", "front"],
        ["image", "https://ex.com/hat-back.png", "back"],
      ]),
    );
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn when the item has no image tag at all", () => {
    const result = expectOk(parseWith([]));
    expect(result.warnings).toHaveLength(0);
  });

  it("warns but stays valid when several unmarked images are published", () => {
    const tags = [
      ...base,
      ["image", "https://ex.com/first.png"],
      ["image", "https://ex.com/second.png"],
    ];
    const event = makeEvent({ kind: 31632, tags });

    expect(validateGameItemDefinition(event).valid).toBe(true);

    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.image).toBe("https://ex.com/first.png");
    expect(result.warnings.map((w) => w.code)).toEqual([
      "multiple-primary-images",
    ]);
  });

  it("does not warn about a missing primary when every image tag was invalid", () => {
    const result = expectOk(parseWith([["image", ""]]));
    expect(result.warnings.map((w) => w.code)).toEqual(["invalid-image-tag"]);
  });

  it("does not trim non-blank image URLs or markers", () => {
    const result = expectOk(
      parseWith([["image", " https://ex.com/hat.png ", " front "]]),
    );
    expect(result.value.images).toEqual([
      { url: " https://ex.com/hat.png ", marker: " front " },
    ]);
  });
});

describe("image helpers", () => {
  const item = {
    images: [
      { url: "https://ex.com/hat.png" },
      { url: "https://ex.com/hat-front.png", marker: "front" },
      { url: "https://ex.com/hat-front-alt.png", marker: "front" },
      { url: "https://ex.com/hat-top.png", marker: "top-down" },
    ],
  };

  it("getPrimaryItemImage returns the unmarked image URL", () => {
    expect(getPrimaryItemImage(item)).toBe("https://ex.com/hat.png");
  });

  it("getPrimaryItemImage falls back to the first marked image", () => {
    expect(
      getPrimaryItemImage({
        images: [{ url: "https://ex.com/hat-back.png", marker: "back" }],
      }),
    ).toBe("https://ex.com/hat-back.png");
  });

  it("getPrimaryItemImage returns undefined without images", () => {
    expect(getPrimaryItemImage({ images: [] })).toBeUndefined();
  });

  it("getItemImageByMarker returns the first match", () => {
    expect(getItemImageByMarker(item, "front")).toEqual({
      url: "https://ex.com/hat-front.png",
      marker: "front",
    });
    expect(getItemImageByMarker(item, "back")).toBeUndefined();
  });

  it("getItemImagesByMarker returns every match in order", () => {
    expect(getItemImagesByMarker(item, "front")).toEqual([
      { url: "https://ex.com/hat-front.png", marker: "front" },
      { url: "https://ex.com/hat-front-alt.png", marker: "front" },
    ]);
    expect(getItemImagesByMarker(item, "back")).toEqual([]);
  });

  it("marker helpers work with unknown markers too", () => {
    expect(getItemImageByMarker(item, "top-down")?.url).toBe(
      "https://ex.com/hat-top.png",
    );
  });

  it("isGameItemImageMarker narrows only known markers", () => {
    for (const marker of GAME_ITEM_IMAGE_MARKERS) {
      expect(isGameItemImageMarker(marker)).toBe(true);
    }
    expect(GAME_ITEM_IMAGE_MARKERS).toEqual([
      "front",
      "side-right",
      "side-left",
      "back",
      "diagonal-front-right",
      "diagonal-front-left",
    ]);
    for (const value of ["top-down", "thumb", "", "FRONT", 1, null]) {
      expect(isGameItemImageMarker(value)).toBe(false);
    }
  });
});

describe("buildGameItemDefinitionEvent", () => {
  it("builds a valid event template with stable tag order", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "blobbi:food:carrot",
      name: "Carrot",
      type: "consumable",
      category: "food",
      image: "https://example.com/carrot.png",
      contexts: ["game:blobbi"],
      topics: ["edible", "vegetable"],
      rarity: "common",
      maxStack: 99,
      alt: "Game item definition: Carrot",
      content: { description: "A crunchy carrot." },
    });
    expect(tmpl.kind).toBe(KIND_GAME_ITEM_DEFINITION);
    expect(tmpl.tags).toEqual([
      ["d", "blobbi:food:carrot"],
      ["name", "Carrot"],
      ["type", "consumable"],
      ["category", "food"],
      ["image", "https://example.com/carrot.png"],
      ["rarity", "common"],
      ["max_stack", "99"],
      ["context", "game:blobbi"],
      ["t", "edible"],
      ["t", "vegetable"],
      ["alt", "Game item definition: Carrot"],
    ]);
    expect(tmpl.content).toBe('{"description":"A crunchy carrot."}');
  });

  it("does not add an alt tag when omitted", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
    });
    expect(tmpl.tags.some((t) => t[0] === "alt")).toBe(false);
  });

  it("accepts a preserialized string content", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      content: '{"a":1}',
    });
    expect(tmpl.content).toBe('{"a":1}');
  });

  it("defaults content to empty string", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
    });
    expect(tmpl.content).toBe("");
  });

  it("throws on empty required fields", () => {
    expect(() =>
      buildGameItemDefinitionEvent({ id: "", name: "X", type: "misc" }),
    ).toThrow();
    expect(() =>
      buildGameItemDefinitionEvent({ id: "x", name: "", type: "misc" }),
    ).toThrow();
    expect(() =>
      buildGameItemDefinitionEvent({ id: "x", name: "X", type: "" }),
    ).toThrow();
  });

  it("emits the primary image followed by the marked views", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "blobbi:cosmetic:wizard_hat",
      name: "Wizard Hat",
      type: "cosmetic",
      image: "https://ex.com/hat.png",
      images: [
        { url: "https://ex.com/hat-front.png", marker: "front" },
        { url: "https://ex.com/hat-side-left.png", marker: "side-left" },
        { url: "https://ex.com/hat-top.png", marker: "top-down" },
      ],
    });
    expect(tmpl.tags.filter((t) => t[0] === "image")).toEqual([
      ["image", "https://ex.com/hat.png"],
      ["image", "https://ex.com/hat-front.png", "front"],
      ["image", "https://ex.com/hat-side-left.png", "side-left"],
      ["image", "https://ex.com/hat-top.png", "top-down"],
    ]);
  });

  it("accepts the primary image as an unmarked images entry", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      images: [
        { url: "https://ex.com/hat-front.png", marker: "front" },
        { url: "https://ex.com/hat.png" },
      ],
    });
    expect(tmpl.tags.filter((t) => t[0] === "image")).toEqual([
      ["image", "https://ex.com/hat.png"],
      ["image", "https://ex.com/hat-front.png", "front"],
    ]);
  });

  it("emits only marked views when there is no primary image", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      images: [{ url: "https://ex.com/hat-back.png", marker: "back" }],
    });
    expect(tmpl.tags.filter((t) => t[0] === "image")).toEqual([
      ["image", "https://ex.com/hat-back.png", "back"],
    ]);
  });

  it("deduplicates identical marked image tags", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      image: "https://ex.com/hat.png",
      images: [
        { url: "https://ex.com/hat.png" },
        { url: "https://ex.com/hat-front.png", marker: "front" },
        { url: "https://ex.com/hat-front.png", marker: "front" },
        { url: "https://ex.com/hat-front.png", marker: "back" },
      ],
    });
    expect(tmpl.tags.filter((t) => t[0] === "image")).toEqual([
      ["image", "https://ex.com/hat.png"],
      ["image", "https://ex.com/hat-front.png", "front"],
      ["image", "https://ex.com/hat-front.png", "back"],
    ]);
  });

  it("omits image entries with a blank URL", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      images: [
        { url: "", marker: "front" },
        { url: "  " },
        { url: "https://ex.com/hat-back.png", marker: "back" },
      ],
    });
    expect(tmpl.tags.filter((t) => t[0] === "image")).toEqual([
      ["image", "https://ex.com/hat-back.png", "back"],
    ]);
  });

  it("throws when two different unmarked image URLs are supplied", () => {
    expect(() =>
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        image: "https://ex.com/a.png",
        images: [{ url: "https://ex.com/b.png" }],
      }),
    ).toThrow(/ambiguous primary image/);
    expect(() =>
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        images: [{ url: "https://ex.com/a.png" }, { url: "https://ex.com/b" }],
      }),
    ).toThrow(/ambiguous primary image/);
  });

  it("round-trips image views through the parser", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "blobbi:cosmetic:wizard_hat",
      name: "Wizard Hat",
      type: "cosmetic",
      image: "https://ex.com/hat.png",
      images: [
        { url: "https://ex.com/hat-front.png", marker: "front" },
        { url: "https://ex.com/hat-diag.png", marker: "diagonal-front-right" },
      ],
    });
    const def = parseGameItemDefinition(makeEvent({ ...tmpl }));
    expect(def?.image).toBe("https://ex.com/hat.png");
    expect(def?.images).toEqual([
      { url: "https://ex.com/hat.png" },
      { url: "https://ex.com/hat-front.png", marker: "front" },
      { url: "https://ex.com/hat-diag.png", marker: "diagonal-front-right" },
    ]);
  });

  it("still supports the old single-image usage", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "blobbi:food:carrot",
      name: "Carrot",
      type: "consumable",
      image: "https://example.com/carrot.png",
    });
    expect(tmpl.tags.filter((t) => t[0] === "image")).toEqual([
      ["image", "https://example.com/carrot.png"],
    ]);
    const def = parseGameItemDefinition(makeEvent({ ...tmpl }));
    expect(def?.image).toBe("https://example.com/carrot.png");
    expect(def?.images).toEqual([{ url: "https://example.com/carrot.png" }]);
  });

  it("round-trips through the parser", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "blobbi:food:carrot",
      name: "Carrot",
      type: "consumable",
      basedOn: [{ address: "31632:farmpk:farm:food:carrot", relay: "" }],
    });
    const event = makeEvent({ ...tmpl, pubkey: "issuerpk" });
    const def = parseGameItemDefinition(event);
    expect(def?.id).toBe("blobbi:food:carrot");
    expect(def?.basedOn).toHaveLength(1);
  });
});

describe("whitespace-only required fields", () => {
  it("validation treats whitespace-only d/name/type as empty", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ["d", "   "],
        ["name", "\t"],
        ["type", "\n "],
      ],
    });
    const codes = validateGameItemDefinition(event).issues.map((i) => i.code);
    expect(codes).toContain("empty-d");
    expect(codes).toContain("empty-name");
    expect(codes).toContain("empty-type");
    expect(parseGameItemDefinition(event)).toBeNull();
  });

  it("builder throws on whitespace-only required fields", () => {
    expect(() =>
      buildGameItemDefinitionEvent({ id: "  ", name: "X", type: "misc" }),
    ).toThrow();
    expect(() =>
      buildGameItemDefinitionEvent({ id: "x", name: " \t", type: "misc" }),
    ).toThrow();
    expect(() =>
      buildGameItemDefinitionEvent({ id: "x", name: "X", type: "\n" }),
    ).toThrow();
  });

  it("does not trim valid required values", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: " x ",
      name: " Carrot ",
      type: " misc ",
    });
    expect(tmpl.tags).toContainEqual(["d", " x "]);
    expect(tmpl.tags).toContainEqual(["name", " Carrot "]);
    expect(tmpl.tags).toContainEqual(["type", " misc "]);
  });
});

describe("whitespace-only optional fields and repeatables", () => {
  it("omits whitespace-only optional tags", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      category: "   ",
      image: "\t",
      symbol: " ",
      alt: "\n",
    });
    for (const name of ["category", "image", "symbol", "alt"]) {
      expect(tmpl.tags.some((t) => t[0] === name)).toBe(false);
    }
  });

  it("omits whitespace-only contexts and topics", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      contexts: ["game:blobbi", "   ", ""],
      topics: ["edible", "\t", ""],
    });
    expect(tmpl.tags.filter((t) => t[0] === "context")).toEqual([
      ["context", "game:blobbi"],
    ]);
    expect(tmpl.tags.filter((t) => t[0] === "t")).toEqual([["t", "edible"]]);
  });

  it("does not normalize non-empty optional values", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      category: " food ",
      contexts: [" game:blobbi "],
    });
    expect(tmpl.tags).toContainEqual(["category", " food "]);
    expect(tmpl.tags).toContainEqual(["context", " game:blobbi "]);
  });
});

describe("based_on validation on parse", () => {
  const base = [
    ["d", "x"],
    ["name", "X"],
    ["type", "misc"],
  ];

  it("preserves a valid based_on reference with its relay hint", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ...base,
        [
          "a",
          "31632:farmpk:farm:food:carrot",
          "wss://relay.example",
          "based_on",
        ],
      ],
    });
    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.basedOn).toEqual([
      {
        address: "31632:farmpk:farm:food:carrot",
        relay: "wss://relay.example",
      },
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it("ignores a malformed based_on address with a warning", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [...base, ["a", "31632:onlytwo", "", "based_on"]],
    });
    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.basedOn).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("malformed-address");
  });

  it("ignores a based_on referencing the wrong kind with a warning", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [...base, ["a", "31633:pk:some:inventory", "", "based_on"]],
    });
    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.basedOn).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain(
      "wrong-referenced-kind",
    );
  });

  it("preserves based_on warnings in parseGameItemDefinitionResult", () => {
    const event = makeEvent({
      kind: 31632,
      tags: [
        ...base,
        ["a", "31632:farmpk:farm:food:carrot", "", "based_on"],
        ["a", "not-an-address", "", "based_on"],
        ["a", "31633:pk:other", "", "based_on"],
      ],
    });
    const result = expectOk(parseGameItemDefinitionResult(event));
    expect(result.value.basedOn).toHaveLength(1);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("wrong-referenced-kind");
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("based_on validation on build", () => {
  it("throws on a malformed based_on address", () => {
    expect(() =>
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        basedOn: [{ address: "not-an-address", relay: "" }],
      }),
    ).toThrow();
  });

  it("throws on a based_on referencing the wrong kind", () => {
    expect(() =>
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        basedOn: [{ address: "31633:pk:other", relay: "" }],
      }),
    ).toThrow();
  });

  it("accepts a valid based_on reference", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      basedOn: [{ address: "31632:farmpk:farm:food:carrot", relay: "wss://r" }],
    });
    expect(tmpl.tags).toContainEqual([
      "a",
      "31632:farmpk:farm:food:carrot",
      "wss://r",
      "based_on",
    ]);
  });
});

describe("extraTags conflict handling", () => {
  const managed = [
    "d",
    "name",
    "type",
    "category",
    "image",
    "model_3d",
    "audio",
    "symbol",
    "rarity",
    "max_stack",
    "version",
    "context",
    "t",
    "alt",
  ];

  it("throws when extraTags contain any managed tag", () => {
    for (const name of managed) {
      expect(() =>
        buildGameItemDefinitionEvent({
          id: "x",
          name: "X",
          type: "misc",
          extraTags: [[name, "value"]],
        }),
      ).toThrow();
    }
  });

  it("throws when extraTags contain an a+based_on tag", () => {
    expect(() =>
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        extraTags: [["a", "31632:pk:item", "", "based_on"]],
      }),
    ).toThrow();
  });

  it("allows unrelated forward-compatible extraTags", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      extraTags: [
        ["future-tag", "value"],
        ["a", "31632:pk:item", "", "some_future_marker"],
        ["e", "eventid", ""],
      ],
    });
    expect(tmpl.tags).toContainEqual(["future-tag", "value"]);
    expect(tmpl.tags).toContainEqual([
      "a",
      "31632:pk:item",
      "",
      "some_future_marker",
    ]);
    expect(tmpl.tags).toContainEqual(["e", "eventid", ""]);
  });
});

describe("maxStack validation", () => {
  it("accepts positive integers (number and string)", () => {
    expect(
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        maxStack: 99,
      }).tags,
    ).toContainEqual(["max_stack", "99"]);
    expect(
      buildGameItemDefinitionEvent({
        id: "x",
        name: "X",
        type: "misc",
        maxStack: "1",
      }).tags,
    ).toContainEqual(["max_stack", "1"]);
  });

  it("rejects invalid maxStack values", () => {
    const invalid: (string | number)[] = [
      0,
      "0",
      -1,
      "-1",
      1.5,
      "1.5",
      NaN,
      Infinity,
      "abc",
      "1e3",
      "0x1",
      " 1 ",
      "+1",
      "03",
    ];
    for (const value of invalid) {
      expect(() =>
        buildGameItemDefinitionEvent({
          id: "x",
          name: "X",
          type: "misc",
          maxStack: value,
        }),
      ).toThrow();
    }
  });
});

describe("version validation", () => {
  it("accepts free-form string versions", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      version: "v1.2.3-beta",
    });
    expect(tmpl.tags).toContainEqual(["version", "v1.2.3-beta"]);
  });

  it("accepts finite numeric versions", () => {
    const tmpl = buildGameItemDefinitionEvent({
      id: "x",
      name: "X",
      type: "misc",
      version: 2,
    });
    expect(tmpl.tags).toContainEqual(["version", "2"]);
  });

  it("rejects NaN and Infinity numeric versions", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() =>
        buildGameItemDefinitionEvent({
          id: "x",
          name: "X",
          type: "misc",
          version: value,
        }),
      ).toThrow();
    }
  });
});
