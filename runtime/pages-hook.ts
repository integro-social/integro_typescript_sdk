import { useCallback, useEffect, useRef, useState } from "react";

import isEqual from "./deep-equal";

import type { RefreshFunction } from "./hook";
import * as ResponseSchema from "./response";
import * as Types from "./types";

type AnyConfig = Types.RequestConfig<any, any, any, any, any, any, any>;

type Result<T extends AnyConfig> = ResponseSchema.InferResult<T["response"]>;

export type PageShape<TItem = unknown> = { items: TItem[]; next: string | null };

export type PageItem<T extends AnyConfig> = Result<T> extends PageShape<infer TItem> ? TItem : never;

export type PagesParams<T extends AnyConfig> = Omit<Types.CallSignature<T>, "query" | "signal"> & {
  query: Omit<NonNullable<Types.CallSignature<T>["query"]>, "cursor">;
};

export type PagesOptions<TItem> = { identify?: (item: TItem) => string | number };

type ItemsSetter<TItem> = (callback: (prev: TItem[]) => TItem[]) => boolean;

export type PagesMore = { hasMore: boolean; loadingMore: boolean; loadMore: () => Promise<boolean> };

export type PagesResponse<T extends AnyConfig, TError = string> =
  | [PageItem<T>[], null, false, RefreshFunction, ItemsSetter<PageItem<T>>, PagesMore]
  | [null, Types.Errors<TError>, false, RefreshFunction, ItemsSetter<PageItem<T>>, PagesMore]
  | [null, null, true, RefreshFunction, ItemsSetter<PageItem<T>>, PagesMore];

export type IdlePagesResponse<T extends AnyConfig, TError = string> =
  | PagesResponse<T, TError>
  | [null, null, false, RefreshFunction, ItemsSetter<PageItem<T>>, PagesMore];

function useDeepCompareMemo<T>(value: T): T {
  const ref = useRef<T>(value);
  if (!isEqual(value, ref.current)) ref.current = value;
  return ref.current;
}

const SPAN_LIMIT_MAX = 200;

function appendPage<TItem>(acc: TItem[], seen: Set<string | number> | null, items: TItem[], identify: ((item: TItem) => string | number) | undefined): void {
  if (seen === null || identify === undefined) {
    acc.push(...items);
    return;
  }
  for (const item of items) {
    const id = identify(item);
    if (seen.has(id)) continue;
    seen.add(id);
    acc.push(item);
  }
}

export function usePages<T extends AnyConfig, TError = string>(
  requester: Types.RequesterFunction<T, TError>,
  callParams: PagesParams<T>,
  options?: PagesOptions<PageItem<T>>
): PagesResponse<T, TError>;
export function usePages<T extends AnyConfig, TError = string>(
  requester: Types.RequesterFunction<T, TError>,
  callParams: PagesParams<T> | null,
  options?: PagesOptions<PageItem<T>>
): IdlePagesResponse<T, TError>;
export function usePages<T extends AnyConfig, TError = string>(
  requester: Types.RequesterFunction<T, TError>,
  callParams: PagesParams<T> | null,
  options?: PagesOptions<PageItem<T>>
): IdlePagesResponse<T, TError> {
  const [items, setItems] = useState<unknown[] | null>(null);
  const [error, setError] = useState<Types.Errors<TError> | null>(null);
  const [loading, setLoading] = useState(true);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const memoizedParams = useDeepCompareMemo(callParams);

  const identifyRef = useRef(options?.identify);
  identifyRef.current = options?.identify;

  const epochRef = useRef(0);
  const spanRef = useRef(0);
  const expandedRef = useRef(false);
  const nextRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const itemsRef = useRef<unknown[] | null>(null);
  itemsRef.current = items;

  const fetchPage = useCallback(
    (cursor: string | null, limit?: number, signal?: AbortSignal) => {
      const params = memoizedParams as any;
      const query = limit === undefined ? { ...params.query, cursor } : { ...params.query, cursor, limit };
      return requester({ ...params, query, signal });
    },
    [requester, memoizedParams]
  );

  const load = useCallback(
    async (span: number, signal?: AbortSignal): Promise<boolean> => {
      if (!memoizedParams) return true;

      const epoch = ++epochRef.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);

      const identify = identifyRef.current as ((item: unknown) => string | number) | undefined;
      const acc: unknown[] = [];
      const seen = identify === undefined ? null : new Set<string | number>();
      let cursor: string | null = null;
      let loaded = 0;

      do {
        const result = await fetchPage(cursor, span === 0 ? undefined : Math.min(SPAN_LIMIT_MAX, span - loaded), signal);

        if (signal?.aborted || epoch !== epochRef.current) return true;

        if (!result.ok) {
          nextRef.current = null;
          spanRef.current = 0;
          expandedRef.current = false;
          setItems(null);
          setNext(null);
          setError(result as Types.Errors<TError>);
          setLoading(false);
          return false;
        }

        const page = result.data as PageShape;
        appendPage(acc, seen, page.items, identify);
        cursor = page.next;
        loaded += page.items.length;
        if (page.items.length === 0) break;
      } while (cursor !== null && loaded < span);

      nextRef.current = cursor;
      spanRef.current = loaded;
      setItems(acc);
      setNext(cursor);
      setError(null);
      setLoading(false);
      return true;
    },
    [fetchPage, memoizedParams]
  );

  useEffect(() => {
    if (!memoizedParams) {
      epochRef.current += 1;
      nextRef.current = null;
      spanRef.current = 0;
      expandedRef.current = false;
      loadingMoreRef.current = false;
      setItems(null);
      setNext(null);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    nextRef.current = null;
    spanRef.current = 0;
    expandedRef.current = false;
    setLoading(true);
    setItems(null);
    setNext(null);
    setError(null);

    const controller = new AbortController();
    load(0, controller.signal);

    return () => controller.abort();
  }, [load, memoizedParams]);

  const setter = useCallback((callback: (prev: unknown[]) => unknown[]) => {
    if (itemsRef.current === null) return false;
    setItems((prev) => (prev === null ? null : callback(prev)));
    return true;
  }, []);

  const refresh = useCallback(
    async (resetState?: boolean): Promise<boolean> => {
      if (!memoizedParams) return true;

      if (resetState) {
        nextRef.current = null;
        spanRef.current = 0;
        expandedRef.current = false;
        setLoading(true);
        setItems(null);
        setNext(null);
        setError(null);
      }

      return await load(expandedRef.current ? spanRef.current : 0);
    },
    [load, memoizedParams]
  );

  const loadMore = useCallback(async (): Promise<boolean> => {
    const cursor = nextRef.current;
    if (!memoizedParams || cursor === null || loadingMoreRef.current || itemsRef.current === null) return false;

    const epoch = epochRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    const result = await fetchPage(cursor);

    if (epoch !== epochRef.current) return false;

    loadingMoreRef.current = false;
    setLoadingMore(false);

    if (!result.ok) return false;

    const page = result.data as PageShape;
    const identify = identifyRef.current as ((item: unknown) => string | number) | undefined;
    nextRef.current = page.next;
    spanRef.current += page.items.length;
    expandedRef.current = true;
    setNext(page.next);
    setItems((prev) => {
      if (prev === null) return null;
      const acc = [...prev];
      appendPage(acc, identify === undefined ? null : new Set(prev.map(identify)), page.items, identify);
      return acc;
    });
    return true;
  }, [fetchPage, memoizedParams]);

  const more: PagesMore = { hasMore: next !== null, loadingMore, loadMore };

  return [items, error, loading, refresh, setter, more] as IdlePagesResponse<T, TError>;
}
