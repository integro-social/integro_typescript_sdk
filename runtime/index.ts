export type { CustomError, Errors, HttpMethod, NetworkError, ParseError, ApiResponse, Success } from "./types";
export type { SseConfig, SseCallSignature, SseListenerFunction, SseConnection } from "./types";
export type { SseHandlers, SseConnectionStatus, SseConnectionOptions } from "./sse";
export type { WsConfig, WsCallSignature, WsListenerFunction } from "./types";
export type { WsHandlers, WsConnectionStatus, WsConnectionOptions, WsReconnectPolicy, WsConnection } from "./ws";
export type { Language } from "./translations";

import { TapiBuilder } from "./core";
import { Endpoints } from "./endpoints";

/**
 * Tapi - Type-safe API client builder
 *
 * A modern REST API client builder using pure TypeScript types.
 * No runtime validation - compile-time type safety only.
 *
 * React-free: this entry never imports React. For React hooks
 * (`.useHook` / `.useSse`), import from `tapi-rs/react` instead.
 */
const Tapi = {
  builder: () => new TapiBuilder(),
  get: Endpoints.get,
  post: Endpoints.post,
  put: Endpoints.put,
  delete: Endpoints.delete,
  patch: Endpoints.patch,
  sse: Endpoints.sse,
  ws: Endpoints.ws
} as const;

export default Tapi;
