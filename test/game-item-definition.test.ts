import { describe, it, expect } from "vitest";
import {
  parseGameItemDefinition,
  parseGameItemDefinitionResult,
  buildGameItemDefinitionEvent,
  validateGameItemDefinition,
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
