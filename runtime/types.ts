import * as ResponseSchema from "./response";
import type * as Sse from "./sse";
import type * as Ws from "./ws";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Request configuration with pure TypeScript types
 * Types are passed via generics, not runtime schemas
 *
 * The `_`-prefixed fields exist only to give the type parameters an inference
 * site. Without them `ExtractPath` & co. resolve solely through TypeScript's
 * alias-identity fast path, so the moment that identity is lost — a mapped
 * type, an object spread, a `Record<string, RequestConfig>` registry — every
 * parameter silently infers `unknown` and all argument checking disappears with
 * no error. Optional, never read at runtime, never emitted on a route object.
 */
export type RequestConfig<
  TMethod extends HttpMethod = HttpMethod,
  TPath = undefined,
  TBody = undefined,
  TFormData = undefined,
  TQuery = undefined,
  THeaders = undefined,
  TResponse = unknown
> = {
  method: TMethod;
  endpoint: string;
  response: ResponseSchema.ResponseConfig<TResponse>;
  _path?: TPath;
  _body?: TBody;
  _formData?: TFormData;
  _query?: TQuery;
  _headers?: THeaders;
};

export type SseConfig<TPath = undefined, TQuery = undefined, THeaders = undefined, TResponse = unknown> = {
  type: "sse";
  endpoint: string;
  response: ResponseSchema.ResponseConfig<TResponse>;
  /** Inference sites only — see `RequestConfig`. */
  _path?: TPath;
  _query?: TQuery;
  _headers?: THeaders;
};

/**
 * Bidirectional WebSocket route: `TSend` is the frame shape the client sends,
 * `TReceive` the shape the server pushes. No `THeaders` — the browser
 * WebSocket API cannot set request headers (auth rides on cookies or a
 * subprotocol).
 */
export type WsConfig<TPath = undefined, TQuery = undefined, TSend = unknown, TReceive = unknown> = {
  type: "ws";
  endpoint: string;
  send: ResponseSchema.ResponseConfig<TSend>;
  receive: ResponseSchema.ResponseConfig<TReceive>;
  /** Inference sites only — see `RequestConfig`. */
  _path?: TPath;
  _query?: TQuery;
};

export type RouteDefinitions = {
  [key: string]: RequestConfig<any, any, any, any, any, any, any> | SseConfig<any, any, any, any> | WsConfig<any, any, any, any> | RouteDefinitions;
};

// Parameter inference types - check if type is defined (not undefined)
// Tuple wrapping prevents conditional type distribution over unions
type InferPathParam<TPath> = [TPath] extends [undefined] ? { path?: never } : { path: TPath };
type InferBodyParam<TBody> = [TBody] extends [undefined] ? { body?: never } : { body: TBody };
type InferFormDataParam<TFormData> = [TFormData] extends [undefined] ? { formData?: never } : { formData: TFormData };
type InferQueryParam<TQuery> = [TQuery] extends [undefined] ? { query?: never } : { query: TQuery };
type InferHeaderParam<THeaders> = [THeaders] extends [undefined] ? { headers?: Record<string, string> } : { headers: THeaders & Record<string, string> };

// Extract types from RequestConfig
export type ExtractPath<T> = T extends RequestConfig<any, infer P, any, any, any, any, any> ? P : undefined;
type ExtractBody<T> = T extends RequestConfig<any, any, infer B, any, any, any, any> ? B : undefined;
type ExtractFormData<T> = T extends RequestConfig<any, any, any, infer F, any, any, any> ? F : undefined;
type ExtractQuery<T> = T extends RequestConfig<any, any, any, any, infer Q, any, any> ? Q : undefined;
type ExtractHeaders<T> = T extends RequestConfig<any, any, any, any, any, infer H, any> ? H : undefined;

/**
 * The argument shape a route's requester takes. `RequesterParams` below is an
 * alias for the internal call sites that used the other spelling — the two were
 * byte-identical declarations of one concept, one edit away from drifting.
 */
export type CallSignature<T extends RequestConfig<any, any, any, any, any, any, any>> = InferPathParam<ExtractPath<T>> &
  InferBodyParam<ExtractBody<T>> &
  InferFormDataParam<ExtractFormData<T>> &
  InferQueryParam<ExtractQuery<T>> &
  InferHeaderParam<ExtractHeaders<T>> & { signal?: AbortSignal };

type ExtractSsePath<T> = T extends SseConfig<infer P, any, any, any> ? P : undefined;
type ExtractSseQuery<T> = T extends SseConfig<any, infer Q, any, any> ? Q : undefined;
type ExtractSseHeaders<T> = T extends SseConfig<any, any, infer H, any> ? H : undefined;

export type SseCallSignature<T extends SseConfig<any, any, any, any>> = InferPathParam<ExtractSsePath<T>> &
  InferQueryParam<ExtractSseQuery<T>> &
  InferHeaderParam<ExtractSseHeaders<T>>;

export type SseListenerFunction<TConfig extends SseConfig<any, any, any, any>> = (
  params: SseCallSignature<TConfig>,
  handlers: Sse.SseHandlers<ResponseSchema.InferResult<TConfig["response"]>>
) => SseConnection;

type ExtractWsPath<T> = T extends WsConfig<infer P, any, any, any> ? P : undefined;
type ExtractWsQuery<T> = T extends WsConfig<any, infer Q, any, any> ? Q : undefined;

export type WsCallSignature<T extends WsConfig<any, any, any, any>> = InferPathParam<ExtractWsPath<T>> &
  InferQueryParam<ExtractWsQuery<T>> & { protocols?: string | string[]; reconnect?: boolean | Ws.WsReconnectPolicy };

export type WsListenerFunction<TConfig extends WsConfig<any, any, any, any>> = (
  params: WsCallSignature<TConfig>,
  handlers: Ws.WsHandlers<ResponseSchema.InferResult<TConfig["receive"]>>
) => Ws.WsConnection<ResponseSchema.InferResult<TConfig["send"]>>;

// Re-exported, not re-declared: `sse.ts` owns this shape. The former copy
// inlined `SseConnectionStatus` as a bare literal union, so the two could drift
// apart silently — one definition per concept.
export type SseConnection = Sse.SseConnection;

/** Identical to {@link CallSignature}; kept for the internal call sites. */
export type RequesterParams<T extends RequestConfig<any, any, any, any, any, any, any>> = CallSignature<T>;

// Prefetch and postfetch callback types
export type PrefetchCallback = (args: { url: string; method: HttpMethod; headers: Headers; body?: BodyInit | null }) => Promise<void> | void;
/**
 * `TData` defaults to `unknown`, not `any`: a postfetch runs for every route, so
 * it cannot know the body's shape and must narrow before reading it.
 */
export type PostfetchCallback<TData = unknown, TError = any> = (response: ApiResponse<TData, TError>) => Promise<void> | void;

// Core response types
export type Success<T> = { ok: true; status: "success"; data: T };

export type NetworkError = { ok: false; code: number; status: "network_error"; message: string; error: Error };
export type CustomError<T = string> = { ok: false; code: number; status: "api_error"; message: string; data: T };
export type ParseError = { ok: false; code: number; status: "parse_error"; message: string; error: Error };
export type Errors<T = string> = NetworkError | CustomError<T> | ParseError;

export type ApiResponse<TData, TError = string> = (Success<TData> | Errors<TError>) & { endpoint: string; method: HttpMethod };

export type RequesterFunction<TConfig extends RequestConfig<any, any, any, any, any, any, any>, TError = string> = (
  params: CallSignature<TConfig>
) => Promise<ApiResponse<ResponseSchema.InferResult<TConfig["response"]>, TError>>;
