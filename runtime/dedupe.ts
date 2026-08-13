interface DedupeEntry {
  promise: Promise<Response>;
  at: number;
}

/**
 * Short-window deduplication of identical GET requests, opted in via
 * `.withGetDedupe(ttlMs)` on the builder. One instance lives per built client.
 *
 * Callers have no shared cache of their own — a screen composing several
 * components that read the same resource fires the same GET 2-3× within
 * milliseconds. Identical (url, headers) GETs within `ttlMs` share one network
 * request instead:
 *
 * - Every consumer receives `response.clone()`, so each reads its own body;
 *   the shared original is never consumed.
 * - Request headers participate in the key, so a credentials change can never
 *   be served another identity's response.
 * - Any non-GET through the client calls `clear()` when it settles: a refetch
 *   awaited after a mutation always hits the network.
 * - Non-ok responses are shared while in flight but evicted on arrival, so a
 *   retry always refetches.
 */
export class DedupeCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, DedupeEntry>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * Serve the GET at `url` from the shared window, firing `doFetch` only when
   * no live entry exists. Resolves with a per-caller clone of the response.
   */
  run(url: string, headers: Headers, doFetch: () => Promise<Response>): Promise<Response> {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs) this.entries.delete(key);
    }

    // Headers iterate sorted by name, so the key is deterministic regardless of insertion order.
    const parts = [url];
    headers.forEach((value, name) => parts.push(`${name}:${value}`));
    const key = parts.join("\n");

    let entry = this.entries.get(key);
    if (!entry) {
      const created: DedupeEntry = { promise: doFetch(), at: now };
      this.entries.set(key, created);
      created.promise.then(
        (response) => {
          if (!response.ok) this.evict(key, created);
        },
        () => this.evict(key, created)
      );
      entry = created;
    }

    return entry.promise.then((response) => response.clone());
  }

  /**
   * Drop everything cached. Called when a mutation settles — anything cached
   * before it may now be stale.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Evict only if the slot still holds this entry — a `clear()` plus a fresh
   * GET may have replaced it, and the newer entry must survive.
   */
  private evict(key: string, entry: DedupeEntry): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
}
