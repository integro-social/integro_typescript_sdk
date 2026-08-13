export type { CustomError, Errors, HttpMethod, NetworkError, ParseError, ApiResponse, Success } from "./types";
export type { SseConfig, SseCallSignature, SseListenerFunction, SseConnection } from "./types";
export type { SseHandlers, SseConnectionStatus, SseConnectionOptions } from "./sse";
export type { SseHookParams, SseHookResponse } from "./sse-hook";
export type { WsConfig, WsCallSignature, WsListenerFunction } from "./types";
export type { WsHandlers, WsConnectionStatus, WsConnectionOptions, WsReconnectPolicy, WsConnection } from "./ws";
export type { WsHookParams, WsHookResponse } from "./ws-hook";
export type { RefreshFunction, HookResponse } from "./hook";
export type { Language } from "./translations";

import { TapiBuilder } from "./core";
import type { ReactAdapter } from "./core";
import { Endpoints } from "./endpoints";
import { useHook } from "./hook";
import { useSseHook } from "./sse-hook";
import { useWsHook } from "./ws-hook";

/**
 * React adapter wired into the builder so built routes expose `.useHook`
 * (request routes) and `.useSse` (SSE routes). This is the only module in the
 * package that imports React — importing from `tapi-rs/react` is what opts you
 * into the React integration. The core `tapi-rs` entry stays React-free.
 */
const reactAdapter: ReactAdapter = {
  useHook: (requester, params) => useHook(requester, params),
  useSseHook: (host, config, params, options) => useSseHook(host, config, params, options),
  useWsHook: (host, config, params) => useWsHook(host, config, params)
};

/**
 * Tapi - Type-safe API client builder (React-enabled)
 *
 * Identical to the default `tapi-rs` export, but built routes additionally
 * expose React hooks (`.useHook` / `.useSse` / `.useWs`).
 */
const Tapi = {
  builder: () => new TapiBuilder<{}, string, false, false, true>(reactAdapter),
  get: Endpoints.get,
  post: Endpoints.post,
  put: Endpoints.put,
  delete: Endpoints.delete,
  patch: Endpoints.patch,
  sse: Endpoints.sse,
  ws: Endpoints.ws
} as const;

export default Tapi;
