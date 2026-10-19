interface DedupeEntry {
  promise: Promise<Response>;
  at: number;
}

export class DedupeCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, DedupeEntry>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  run(url: string, headers: Headers, doFetch: () => Promise<Response>): Promise<Response> {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs) this.entries.delete(key);
    }

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

  clear(): void {
    this.entries.clear();
  }

  private evict(key: string, entry: DedupeEntry): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
}
