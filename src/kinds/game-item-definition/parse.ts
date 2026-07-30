import type { NostrEvent } from "../../nostr/event.js";
import {
  type ParseMode,
  type ParseResult,
  type ParseWarning,
  ok,
  fail,
} from "../../common/result.js";
import { getTagValue, getTagValues } from "../../common/tags.js";
import { parseContentJson } from "../../common/json.js";
import { KIND_GAME_ITEM_DEFINITION } from "../../common/constants.js";
import {
  buildGameItemAddress,
  parseGameItemAddress,
  BASED_ON_MARKER,
} from "./address.js";
import { validateGameItemDefinition } from "./validate.js";
import { selectPrimaryGameItemImage, type GameItemImage } from "./images.js";
import type { GameItemDefinition, GameItemBasedOnReference } from "./types.js";

export interface ParseGameItemDefinitionOptions {
  /**
   * `permissive` (default) tolerates invalid JSON content and unknown tags.
   * `strict` additionally rejects the event when `content` is non-empty and
   * not valid JSON (i.e. it implies `requireJsonContent`).
   */
  mode?: ParseMode;
  /**
   * Explicitly require valid JSON content, independent of mode. When left
   * `undefined`, this defaults to `true` in strict mode and `false` in
   * permissive mode.
   */
  requireJsonContent?: boolean;
}

/**
 * Parse a kind:31632 event into a {@link GameItemDefinition}, returning a
 * structured {@link ParseResult}.
 *
 * The event is rejected (`ok: false`) only for the MUST-reject conditions
 * (wrong kind, missing/empty `d`/`name`/`type`, and invalid JSON when
 * required). Unknown tags are preserved on the event and tolerated. Invalid
 * JSON content in permissive mode produces a warning, not a rejection. Invalid
 * `based_on` references (malformed address or wrong referenced kind) and
 * `image` tags without a usable URL are ignored and reported as warnings.
 *
 * Authoring guidance that the spec expresses as SHOULD is reported as warnings
 * too, never as a rejection: an item that publishes marked image views without
 * an unmarked primary image, or more than one unmarked image, still parses
 * (see {@link warnAboutPrimaryImage}).
 */
export function parseGameItemDefinitionResult(
  event: NostrEvent,
  options: ParseGameItemDefinitionOptions = {},
): ParseResult<GameItemDefinition> {
  const mode: ParseMode = options.mode ?? "permissive";
  const requireJsonContent = options.requireJsonContent ?? mode === "strict";
  const warnings: ParseWarning[] = [];

  const validation = validateGameItemDefinition(event, {
    requireJsonContent,
  });
  if (!validation.valid) {
    return fail(validation.issues.map((i) => i.message).join("; "), warnings);
  }

  // Validation guarantees these exist and are non-empty.
  const id = getTagValue(event.tags, "d") as string;
  const name = getTagValue(event.tags, "name") as string;
  const type = getTagValue(event.tags, "type") as string;

  const contentParsed = parseContentJson(event.content);
  let contentJson: unknown;
  if (contentParsed.kind === "json") {
    contentJson = contentParsed.value;
  } else if (contentParsed.kind === "invalid") {
    // requireJsonContent already rejected in validation; here we only warn.
    warnings.push({
      code: "invalid-json-content",
      message: "`content` is not valid JSON; ignored",
    });
  }

  const basedOn = parseBasedOnReferences(event.tags, warnings);
  const images = parseImages(event.tags, warnings);
  warnAboutPrimaryImage(images, warnings);

  const definition: GameItemDefinition = {
    id,
    address: buildGameItemAddress(event.pubkey, id),
    issuer: event.pubkey,
    kind: KIND_GAME_ITEM_DEFINITION,
    name,
    type,
    images,
    contexts: getTagValues(event.tags, "context"),
    topics: getTagValues(event.tags, "t"),
    basedOn,
    content: event.content,
    event,
  };

  assignOptional(definition, "category", getTagValue(event.tags, "category"));
  assignOptional(definition, "image", selectPrimaryGameItemImage(images)?.url);
  assignOptional(definition, "model3d", getTagValue(event.tags, "model_3d"));
  assignOptional(definition, "audio", getTagValue(event.tags, "audio"));
  assignOptional(definition, "symbol", getTagValue(event.tags, "symbol"));
  assignOptional(definition, "rarity", getTagValue(event.tags, "rarity"));
  assignOptional(definition, "maxStack", getTagValue(event.tags, "max_stack"));
  assignOptional(definition, "version", getTagValue(event.tags, "version"));
  assignOptional(definition, "alt", getTagValue(event.tags, "alt"));

  if (contentJson !== undefined) {
    definition.contentJson = contentJson;
  }

  return ok(definition, warnings);
}

/**
 * Convenience wrapper returning the parsed definition or `null`.
 *
 * Prefer {@link parseGameItemDefinitionResult} when you need warnings or the
 * rejection reason.
 */
export function parseGameItemDefinition(
  event: NostrEvent,
  options: ParseGameItemDefinitionOptions = {},
): GameItemDefinition | null {
  const result = parseGameItemDefinitionResult(event, options);
  return result.ok ? result.value : null;
}

/**
 * Parse every `image` tag into a {@link GameItemImage}, in tag order.
 *
 * `["image", "<url>"]` is an unmarked image (a primary image candidate) and
 * `["image", "<url>", "<marker>"]` is a marked view. A blank marker slot is
 * treated as no marker; unknown markers are preserved verbatim so clients that
 * understand them keep working. Tags whose URL is missing or blank are ignored
 * and reported as `invalid-image-tag` warnings.
 */
function parseImages(
  tags: string[][],
  warnings: ParseWarning[],
): GameItemImage[] {
  const images: GameItemImage[] = [];
  for (const tag of tags) {
    if (tag[0] !== "image") {
      continue;
    }

    const url = tag[1];
    if (typeof url !== "string" || url.trim() === "") {
      warnings.push({
        code: "invalid-image-tag",
        message: "`image` tag is missing a URL; ignored",
        tag,
      });
      continue;
    }

    const marker = tag[2];
    images.push(
      typeof marker === "string" && marker.trim() !== ""
        ? { url, marker }
        : { url },
    );
  }
  return images;
}

/**
 * Warn when an item does not publish exactly one unmarked `image` tag.
 *
 * The spec only says an item definition SHOULD publish exactly one unmarked
 * image, so this never rejects the event and never changes the parsed value —
 * including in strict mode. Marked images are pose/view-specific assets, so an
 * item with views but no canonical image (`missing-primary-image`) leaves
 * clients that ignore markers guessing, and several unmarked images
 * (`multiple-primary-images`) make the canonical one ambiguous. In both cases
 * the parser still resolves `image` via {@link selectPrimaryGameItemImage}.
 *
 * An item with no `image` tag at all is not warned about: images are optional.
 */
function warnAboutPrimaryImage(
  images: GameItemImage[],
  warnings: ParseWarning[],
): void {
  const unmarked = images.filter((image) => image.marker === undefined);

  if (images.length > 0 && unmarked.length === 0) {
    warnings.push({
      code: "missing-primary-image",
      message:
        "Item has only marked `image` views and no unmarked primary image; falling back to the first image",
    });
    return;
  }

  if (unmarked.length > 1) {
    warnings.push({
      code: "multiple-primary-images",
      message: `Item has ${unmarked.length} unmarked \`image\` tags; using the first as the primary image`,
    });
  }
}

/**
 * Parse `a` tags carrying the `based_on` marker into derivation references.
 *
 * Each reference must be a well-formed addressable coordinate that references
 * kind 31632. References that are malformed or point at a different kind are
 * ignored and reported as warnings (`malformed-address` /
 * `wrong-referenced-kind`). Valid references keep their relay hint.
 */
function parseBasedOnReferences(
  tags: string[][],
  warnings: ParseWarning[],
): GameItemBasedOnReference[] {
  const refs: GameItemBasedOnReference[] = [];
  for (const tag of tags) {
    if (tag[0] !== "a") {
      continue;
    }
    if (tag[3] !== BASED_ON_MARKER) {
      continue;
    }
    const address = tag[1];
    if (typeof address !== "string" || address === "") {
      warnings.push({
        code: "malformed-address",
        message: "`based_on` `a` tag is missing an address; ignored",
        tag,
      });
      continue;
    }

    // A coordinate that starts with the 31632 kind prefix but still fails to
    // parse is malformed; otherwise it references a different kind.
    const parsed = parseGameItemAddress(address);
    if (parsed === null) {
      const isMalformed = address.startsWith(`${KIND_GAME_ITEM_DEFINITION}:`);
      warnings.push({
        code: isMalformed ? "malformed-address" : "wrong-referenced-kind",
        message: isMalformed
          ? `Malformed \`based_on\` address; ignored: ${address}`
          : `\`based_on\` address does not reference kind ${KIND_GAME_ITEM_DEFINITION}; ignored: ${address}`,
        tag,
      });
      continue;
    }

    refs.push({ address, relay: tag[2] ?? "" });
  }
  return refs;
}

function assignOptional<T, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
