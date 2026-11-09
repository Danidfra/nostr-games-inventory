/**
 * Shared helpers for working with untrusted JSON-derived values.
 *
 * Internal: not re-exported from the package's public API.
 */

/**
 * Narrow an unknown value to a plain JSON object.
 *
 * Arrays and `null` are rejected: both are `typeof "object"` but neither can
 * carry named fields, so neither is a usable object in any of the content
 * schemas this library parses.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deepest nesting of arrays and objects accepted in untrusted JSON content.
 *
 * Depth counts containers: `1` is `{}` or `[]`, and every array or object
 * nested inside adds one. The deepest structure any specification in this
 * package defines is a kind:31634 transform such as
 * `content.placements[i].position` (depth 3 below the content root, 4 with
 * it), so 64 leaves ample room for extension fields while keeping every
 * accepted value far below any engine's recursion limit. Recursive consumer
 * code (`JSON.stringify`, structured clone, deep equality) can therefore walk
 * anything this library hands out.
 */
export const MAX_JSON_NESTING_DEPTH = 64;

/**
 * Nesting at which {@link cloneJsonLike} gives up. Far above
 * {@link MAX_JSON_NESTING_DEPTH}, so it is never reached by a value that passed
 * validation; it exists to turn a cyclic or absurdly deep *caller* value into a
 * clear error instead of an endless loop.
 */
const CLONE_DEPTH_LIMIT = 10_000;

/**
 * `true` when a JSON-compatible value nests arrays and objects deeper than
 * `limit` (see {@link MAX_JSON_NESTING_DEPTH} for how depth is counted).
 * Iterative, so it never overflows the call stack however deep the input is,
 * and it stops as soon as the limit is crossed.
 */
export function jsonNestingDepthExceeds(
  value: unknown,
  limit: number = MAX_JSON_NESTING_DEPTH,
): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };
    let children: unknown[];
    if (Array.isArray(node)) {
      children = node;
    } else if (isPlainObject(node)) {
      children = Object.values(node);
    } else {
      continue;
    }
    const childDepth = depth + 1;
    if (childDepth > limit) {
      return true;
    }
    for (const child of children) {
      if (typeof child === "object" && child !== null) {
        stack.push({ node: child, depth: childDepth });
      }
    }
  }
  return false;
}

/**
 * Set `record[key] = value` as an own data property, even for `__proto__`.
 *
 * Plain assignment of `__proto__` calls the inherited setter and replaces the
 * prototype of `record` instead of storing a field. Every copy of untrusted
 * keys in this library goes through here.
 */
export function setOwnProperty(
  record: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (key === "__proto__") {
    Object.defineProperty(record, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    record[key] = value;
  }
}

/**
 * `true` when any object inside a JSON-compatible value has an own
 * `__proto__` key.
 *
 * `JSON.parse` turns `"__proto__"` into an ordinary own property, but code
 * that copies it with plain assignment (`copy[key] = value`, `Object.assign`,
 * many merge helpers) replaces the copy's prototype instead, so fields that
 * failed validation can reappear as inherited properties. No document in this
 * package's specifications uses the key. Iterative, like
 * {@link jsonNestingDepthExceeds}.
 */
export function containsProtoKey(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    let children: unknown[];
    if (Array.isArray(node)) {
      children = node;
    } else if (isPlainObject(node)) {
      if (Object.prototype.hasOwnProperty.call(node, "__proto__")) {
        return true;
      }
      children = Object.values(node);
    } else {
      continue;
    }
    for (const child of children) {
      if (typeof child === "object" && child !== null) {
        stack.push(child);
      }
    }
  }
  return false;
}

/**
 * Copy a JSON-compatible value structurally.
 *
 * This is how the library keeps its immutability promise for data it does not
 * fully model: unknown nested fields are copied structurally rather than being
 * re-serialized through a typed shape, so nothing is dropped and no caller can
 * mutate a parsed placement through a shared nested reference.
 *
 * The copy is iterative: nesting depth never consumes call stack. Untrusted
 * values are depth-checked by the validators before they get here; a caller
 * value nested deeper than an internal bound (in practice a cyclic structure)
 * throws a plain `Error`.
 *
 * Every own key is copied as an own data property. An own `__proto__` key
 * stays an own property of the copy: it never changes the copy's prototype,
 * and `Object.prototype` is never touched.
 *
 * Non-plain values (functions, class instances, `Date`, …) are returned by
 * reference. They cannot appear in content parsed from a Nostr event, and
 * builder inputs containing them would already fail `JSON.stringify`.
 *
 * @throws {Error} when the value is nested deeper than the internal bound.
 */
export function cloneJsonLike<T>(value: T): T {
  type Pending = {
    source: unknown[] | Record<string, unknown>;
    target: unknown[] | Record<string, unknown>;
    depth: number;
  };
  const stack: Pending[] = [];

  const shell = (node: unknown, depth: number): unknown => {
    if (!Array.isArray(node) && !isPlainObject(node)) {
      return node;
    }
    if (depth > CLONE_DEPTH_LIMIT) {
      throw new Error(
        `cloneJsonLike: value is nested deeper than ${CLONE_DEPTH_LIMIT} levels (cyclic?)`,
      );
    }
    const target: unknown[] | Record<string, unknown> = Array.isArray(node)
      ? []
      : {};
    stack.push({ source: node, target, depth });
    return target;
  };

  const root = shell(value, 1);
  while (stack.length > 0) {
    const { source, target, depth } = stack.pop() as Pending;
    if (Array.isArray(source)) {
      const list = target as unknown[];
      for (const entry of source) {
        list.push(shell(entry, depth + 1));
      }
    } else {
      const record = target as Record<string, unknown>;
      for (const [key, entry] of Object.entries(source)) {
        setOwnProperty(record, key, shell(entry, depth + 1));
      }
    }
  }
  return root as T;
}
