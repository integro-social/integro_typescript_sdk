import * as ResponseSchema from "./response";
import type * as Sse from "./sse";
import type * as Ws from "./ws";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

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
  _path?: TPath;
  _query?: TQuery;
  _headers?: THeaders;
};

export type WsConfig<TPath = undefined, TQuery = undefined, TSend = unknown, TReceive = unknown> = {
  type: "ws";
  endpoint: string;
  send: ResponseSchema.ResponseConfig<TSend>;
  receive: ResponseSchema.ResponseConfig<TReceive>;
  _path?: TPath;
  _query?: TQuery;
};

export type RouteDefinitions = {
  [key: string]: RequestConfig<any, any, any, any, any, any, any> | SseConfig<any, any, any, any> | WsConfig<any, any, any, any> | RouteDefinitions;
};

type InferPathParam<TPath> = [TPath] extends [undefined] ? { path?: never } : { path: TPath };
type InferBodyParam<TBody> = [TBody] extends [undefined] ? { body?: never } : { body: TBody };
type InferFormDataParam<TFormData> = [TFormData] extends [undefined] ? { formData?: never } : { formData: TFormData };
type InferQueryParam<TQuery> = [TQuery] extends [undefined] ? { query?: never } : { query: TQuery };
type InferHeaderParam<THeaders> = [THeaders] extends [undefined] ? { headers?: Record<string, string> } : { headers: THeaders & Record<string, string> };

export type ExtractPath<T> = T extends RequestConfig<any, infer P, any, any, any, any, any> ? P : undefined;
type ExtractBody<T> = T extends RequestConfig<any, any, infer B, any, any, any, any> ? B : undefined;
type ExtractFormData<T> = T extends RequestConfig<any, any, any, infer F, any, any, any> ? F : undefined;
type ExtractQuery<T> = T extends RequestConfig<any, any, any, any, infer Q, any, any> ? Q : undefined;
type ExtractHeaders<T> = T extends RequestConfig<any, any, any, any, any, infer H, any> ? H : undefined;

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

export type SseConnection = Sse.SseConnection;

export type RequesterParams<T extends RequestConfig<any, any, any, any, any, any, any>> = CallSignature<T>;

export type PrefetchCallback = (args: { url: string; method: HttpMethod; headers: Headers; body?: BodyInit | null }) => Promise<void> | void;
export type PostfetchCallback<TData = unknown, TError = any> = (response: ApiResponse<TData, TError>) => Promise<void> | void;

export type Success<T> = { ok: true; status: "success"; data: T };

export type NetworkError = { ok: false; code: number; status: "network_error"; message: string; error: Error };
export type CustomError<T = string> = { ok: false; code: number; status: "api_error"; message: string; data: T };
export type ParseError = { ok: false; code: number; status: "parse_error"; message: string; error: Error };
export type Errors<T = string> = NetworkError | CustomError<T> | ParseError;

export type ApiResponse<TData, TError = string> = (Success<TData> | Errors<TError>) & { endpoint: string; method: HttpMethod };

export type RequesterFunction<TConfig extends RequestConfig<any, any, any, any, any, any, any>, TError = string> = (
  params: CallSignature<TConfig>
) => Promise<ApiResponse<ResponseSchema.InferResult<TConfig["response"]>, TError>>;
