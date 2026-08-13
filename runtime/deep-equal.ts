/**
 * Dependency-free deep equality check.
 *
 * Used by the React hooks to memoize call params across renders so that
 * structurally-equal objects don't retrigger effects. Replaces the
 * `react-fast-compare` dependency — params are plain data (no React
 * elements), so the element-aware branches of that library aren't needed.
 */
export default function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a && b && typeof a === "object" && typeof b === "object") {
    if ((a as object).constructor !== (b as object).constructor) return false;

    if (Array.isArray(a)) {
      const arrB = b as unknown[];
      if (a.length !== arrB.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], arrB[i])) return false;
      }
      return true;
    }

    if (a instanceof Date) return a.getTime() === (b as Date).getTime();
    if (a instanceof RegExp) return a.toString() === (b as RegExp).toString();

    if (a instanceof Map) {
      const mapB = b as Map<unknown, unknown>;
      if (a.size !== mapB.size) return false;
      for (const [key, value] of a) {
        if (!mapB.has(key) || !deepEqual(value, mapB.get(key))) return false;
      }
      return true;
    }

    if (a instanceof Set) {
      const setB = b as Set<unknown>;
      if (a.size !== setB.size) return false;
      for (const value of a) {
        if (!setB.has(value)) return false;
      }
      return true;
    }

    const keys = Object.keys(a as Record<string, unknown>);
    if (keys.length !== Object.keys(b as Record<string, unknown>).length) return false;

    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }

    return true;
  }

  // NaN === NaN
  return a !== a && b !== b;
}
