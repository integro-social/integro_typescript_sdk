import { useCallback, useEffect, useRef, useState } from "react";

import isEqual from "./deep-equal";

import * as ResponseSchema from "./response";
import * as Types from "./types";

function useDeepCompareMemo<T>(value: T): T {
  const ref = useRef<T>(value);
  if (!isEqual(value, ref.current)) ref.current = value;
  return ref.current;
}

export type RefreshFunction = (resetState?: boolean) => Promise<boolean>;

/**
 * Applies `callback` to the loaded data. Returns whether it ran: the update is
 * skipped when there is no data yet (idle, loading or errored), which is
 * otherwise invisible — an optimistic update issued against a hook that has not
 * settled silently disappears.
 */
type SetterFunction<T> = (callback: (prev: T) => T) => boolean;

type Result<T extends Types.RequestConfig<any, any, any, any, any, any, any>> = ResponseSchema.InferResult<T["response"]>;

type Params<T extends Types.RequestConfig<any, any, any, any, any, any, any>> = Types.CallSignature<T> & { lazy?: boolean };

/**
 * The three states a hook that was actually asked for data can be in. Each arm
 * is a tuple, so destructuring keeps its dependent narrowing: rule out
 * `loading` and `error`, and `data` is non-null.
 */
export type HookResponse<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string> =
  | [Result<T>, null, false, RefreshFunction, SetterFunction<Result<T>>]
  | [null, Types.Errors<TError>, false, RefreshFunction, SetterFunction<Result<T>>]
  | [null, null, true, RefreshFunction, SetterFunction<Result<T>>];

/**
 * A hook whose params may be `null` has a fourth state the three above cannot
 * express: **idle** — no request was issued, so there is no data, no error and
 * nothing loading. It is where a conditional fetch (`cond ? {…} : null`) sits
 * whenever the condition is false.
 *
 * Keeping it in its own type, selected by the overloads below, is what stops it
 * taxing every call site: a hook whose params cannot be `null` never sees this
 * arm and narrows exactly as before.
 */
export type IdleHookResponse<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string> =
  | HookResponse<T, TError>
  | [null, null, false, RefreshFunction, SetterFunction<Result<T>>];

// Params that cannot be `null`: a request is always issued, so the idle arm is
// unreachable and callers keep the three-state narrowing.
export function useHook<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string>(requester: Types.RequesterFunction<T, TError>, callParams: Params<T>): HookResponse<T, TError>;
// Params that may be `null`: the caller must also handle "never asked".
export function useHook<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string>(requester: Types.RequesterFunction<T, TError>, callParams: Params<T> | null): IdleHookResponse<T, TError>;
export function useHook<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string>(
  requester: Types.RequesterFunction<T, TError>,
  callParams: Params<T> | null
): IdleHookResponse<T, TError> {
  const [data, setData] = useState<unknown | null>(null);
  const [error, setError] = useState<Types.Errors<TError> | null>(null);
  const [loading, setLoading] = useState(true);

  const memoizedParams = useDeepCompareMemo(callParams);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      if (!memoizedParams) return true;

      const result = await requester({ ...memoizedParams, signal });

      if (signal?.aborted) return true;

      if (!result.ok) {
        setData(null);
        setError(result as Types.Errors<TError>);
        setLoading(false);
        return false;
      }

      setData(result.data);
      setError(null);
      setLoading(false);
      return true;
    },
    [requester, memoizedParams]
  );

  useEffect(() => {
    if (!memoizedParams) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (memoizedParams.lazy) return;

    setLoading(true);
    setData(null);
    setError(null);

    const controller = new AbortController();
    fetchData(controller.signal);

    return () => controller.abort();
  }, [fetchData, memoizedParams]);

  // Mirrors `data` so the setter can report — synchronously, at call time —
  // whether it had anything to update. Reading the state variable would not
  // work: a `useState` updater runs during the next render, long after the
  // caller needs the answer.
  const dataRef = useRef<unknown>(null);
  dataRef.current = data;

  const setter = useCallback((callback: (prev: Result<T>) => Result<T>) => {
    if (dataRef.current === null) return false;
    setData((prev: any) => (prev === null ? null : callback(prev)));
    return true;
  }, []);

  // `useCallback`, like `setter` above: a plain declaration is a new function
  // every render, so `refresh` cannot go in a dependency array without looping —
  // consumers end up stashing it in a ref to work around that.
  const refresh = useCallback(
    async (resetState?: boolean): Promise<boolean> => {
      if (!memoizedParams) return true;

      if (resetState) {
        setLoading(true);
        setData(null);
        setError(null);
      }

      return await fetchData();
    },
    [fetchData, memoizedParams]
  );

  return [data, error, loading, refresh, setter] as IdleHookResponse<T, TError>;
}
