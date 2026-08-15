import { useCallback, useEffect, useRef, useState } from "react";

import isEqual from "./deep-equal";

import * as Ws from "./ws";
import type * as Types from "./types";
import type * as ResponseSchema from "./response";

function useDeepCompareMemo<T>(value: T): T {
  const ref = useRef<T>(value);
  if (!isEqual(value, ref.current)) ref.current = value;
  return ref.current;
}

export type WsHookParams<T extends Types.WsConfig<any, any, any, any>> = Types.WsCallSignature<T> &
  Ws.WsHandlers<ResponseSchema.InferResult<T["receive"]>> & {
    /**
     * Skip the automatic connect on mount; call `connect()` yourself. The
     * connection still tears down on unmount or when params change.
     */
    lazy?: boolean;
  };

export type WsHookResponse<TSend> = {
  status: Ws.WsConnectionStatus;
  send: (message: TSend) => boolean;
  sendBinary: (data: BufferSource) => boolean;
  connect: () => void;
  stop: () => void;
};

export function useWsHook<T extends Types.WsConfig<any, any, any, any>>(
  host: string,
  config: T,
  params: WsHookParams<T> | null
): WsHookResponse<ResponseSchema.InferResult<T["send"]>> {
  const [status, setStatus] = useState<Ws.WsConnectionStatus>("stopped");
  const connectionRef = useRef<Ws.WsConnection<any> | null>(null);

  // Keep the latest handlers in a ref so the connection effect doesn't re-run
  // (and reconnect) every render just because inline callbacks changed identity.
  const handlersRef = useRef<Ws.WsHandlers<any>>({});
  handlersRef.current = {
    onMessage: params?.onMessage,
    onBinary: params?.onBinary,
    onOpen: params?.onOpen,
    onClose: params?.onClose,
    onError: params?.onError,
    onStatusChange: params?.onStatusChange
  };

  const { onMessage: _m, onBinary: _b, onOpen: _o, onClose: _c, onError: _e, onStatusChange: _s, lazy, ...connectionParams } = params ?? ({} as any);
  const memoizedParams = useDeepCompareMemo(params ? connectionParams : null);

  useEffect(() => {
    if (!memoizedParams) return;

    const url = Ws.buildWsUrl(host, config.endpoint, memoizedParams);

    const connection = Ws.createWsConnection(
      url,
      {
        onMessage: (message) => handlersRef.current.onMessage?.(message),
        onBinary: (data) => handlersRef.current.onBinary?.(data),
        onOpen: () => handlersRef.current.onOpen?.(),
        onClose: (event) => handlersRef.current.onClose?.(event),
        onError: (error) => handlersRef.current.onError?.(error),
        onStatusChange: (next) => {
          setStatus(next);
          handlersRef.current.onStatusChange?.(next);
        }
      },
      { protocols: memoizedParams.protocols, reconnect: memoizedParams.reconnect }
    );

    connectionRef.current = connection;
    if (!lazy) connection.connect();

    return () => {
      connectionRef.current = null;
      connection.stop();
      setStatus("stopped");
    };
  }, [host, config.endpoint, memoizedParams, lazy]);

  const send = useCallback((message: any) => connectionRef.current?.send(message) ?? false, []);

  const sendBinary = useCallback((data: BufferSource) => connectionRef.current?.sendBinary(data) ?? false, []);

  const connect = useCallback(() => {
    connectionRef.current?.connect();
  }, []);

  const stop = useCallback(() => {
    connectionRef.current?.stop();
  }, []);

  return { status, send, sendBinary, connect, stop };
}
