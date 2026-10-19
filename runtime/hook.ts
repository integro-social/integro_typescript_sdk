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

type SetterFunction<T> = (callback: (prev: T) => T) => boolean;

type Result<T extends Types.RequestConfig<any, any, any, any, any, any, any>> = ResponseSchema.InferResult<T["response"]>;

type Params<T extends Types.RequestConfig<any, any, any, any, any, any, any>> = Types.CallSignature<T> & { lazy?: boolean };

export type HookResponse<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string> =
  | [Result<T>, null, false, RefreshFunction, SetterFunction<Result<T>>]
  | [null, Types.Errors<TError>, false, RefreshFunction, SetterFunction<Result<T>>]
  | [null, null, true, RefreshFunction, SetterFunction<Result<T>>];

export type IdleHookResponse<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string> =
  | HookResponse<T, TError>
  | [null, null, false, RefreshFunction, SetterFunction<Result<T>>];

export function useHook<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string>(requester: Types.RequesterFunction<T, TError>, callParams: Params<T>): HookResponse<T, TError>;
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

  const dataRef = useRef<unknown>(null);
  dataRef.current = data;

  const setter = useCallback((callback: (prev: Result<T>) => Result<T>) => {
    if (dataRef.current === null) return false;
    setData((prev: any) => (prev === null ? null : callback(prev)));
    return true;
  }, []);

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
