import { useCallback, useEffect, useRef, useState } from "react";

import isEqual from "./deep-equal";

import * as Sse from "./sse";
import type * as Types from "./types";
import type * as ResponseSchema from "./response";

function useDeepCompareMemo<T>(value: T): T {
  const ref = useRef<T>(value);
  if (!isEqual(value, ref.current)) ref.current = value;
  return ref.current;
}

export type SseHookParams<T extends Types.SseConfig<any, any, any, any>> = Types.SseCallSignature<T> & Sse.SseHandlers<ResponseSchema.InferResult<T["response"]>>;

export type SseHookResponse = {
  status: Sse.SseConnectionStatus;
  connect: () => void;
  stop: () => void;
};

export function useSseHook<T extends Types.SseConfig<any, any, any, any>>(
  host: string,
  config: T,
  params: SseHookParams<T> | null,
  options?: { headers?: Record<string, string>; credentials?: RequestCredentials }
): SseHookResponse {
  const [status, setStatus] = useState<Sse.SseConnectionStatus>("stopped");
  const connectionRef = useRef<Sse.SseConnection | null>(null);

  // Keep the latest handlers in a ref so the connection effect doesn't re-run
  // (and reconnect) every render just because inline callbacks changed identity.
  const handlersRef = useRef<Sse.SseHandlers<any>>({});
  handlersRef.current = {
    onData: params?.onData,
    onError: params?.onError,
    onOpen: params?.onOpen,
    onClose: params?.onClose
  };

  const { onData: _d, onError: _e, onOpen: _o, onClose: _c, ...connectionParams } = params ?? ({} as any);
  const memoizedParams = useDeepCompareMemo(params ? connectionParams : null);

  const defaultHeaders = useDeepCompareMemo(options?.headers ?? null);
  const credentials = options?.credentials;

  useEffect(() => {
    if (!memoizedParams) return;

    const url = Sse.buildSseUrl(host, config.endpoint, memoizedParams);
    const headers = { ...(defaultHeaders || {}), ...(memoizedParams.headers || {}) };

    const connection = Sse.createConnection(
      url,
      {
        onData: (data) => handlersRef.current.onData?.(data),
        onOpen: () => {
          setStatus("open");
          handlersRef.current.onOpen?.();
        },
        onError: (error) => {
          setStatus("error");
          handlersRef.current.onError?.(error);
        },
        onClose: () => {
          setStatus("stopped");
          handlersRef.current.onClose?.();
        }
      },
      { headers, credentials }
    );

    connectionRef.current = connection;
    return () => {
      connection.stop();
      setStatus("stopped");
    };
  }, [host, config.endpoint, memoizedParams, defaultHeaders, credentials]);

  const connect = useCallback(() => {
    connectionRef.current?.connect();
    setStatus("connecting");
  }, []);

  const stop = useCallback(() => {
    connectionRef.current?.stop();
    setStatus("stopped");
  }, []);

  return { status, connect, stop };
}
