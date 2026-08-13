import type { HttpMethod, RequestConfig, SseConfig, WsConfig } from "./types";

/**
 * Configuration object for endpoint factories
 */
type EndpointOptions = {
  endpoint: string;
};

/**
 * Type parameters object - only specify what you need
 */
type EndpointTypes<TPath = undefined, TBody = undefined, TFormData = undefined, TQuery = undefined, THeaders = undefined, TResponse = unknown> = {
  path?: TPath;
  body?: TBody;
  formData?: TFormData;
  query?: TQuery;
  headers?: THeaders;
  response?: TResponse;
};

/**
 * Extract types from the config object with defaults
 */
type ExtractPath<T> = T extends { path: infer P } ? P : undefined;
type ExtractBody<T> = T extends { body: infer B } ? B : undefined;
type ExtractFormData<T> = T extends { formData: infer F } ? F : undefined;
type ExtractQuery<T> = T extends { query: infer Q } ? Q : undefined;
type ExtractHeaders<T> = T extends { headers: infer H } ? H : undefined;
type ExtractResponse<T> = T extends { response: infer R } ? R : unknown;

/**
 * Curried endpoint factory using object-based type parameters
 *
 * Usage:
 *   // Simple - just response type
 *   Tapi.get<{ response: User[] }>()({ endpoint: "/users" })
 *
 *   // With path params
 *   Tapi.get<{ path: { id: string }, response: User }>()({ endpoint: "/users/:id" })
 *
 *   // With query params
 *   Tapi.get<{ query: { limit?: number }, response: Post[] }>()({ endpoint: "/posts" })
 *
 *   // With body (for POST/PUT)
 *   Tapi.post<{ body: CreateUser, response: User }>()({ endpoint: "/users" })
 */
function createEndpointFactory<TMethod extends HttpMethod>(method: TMethod) {
  return <T extends EndpointTypes<any, any, any, any, any, any> = {}>() =>
    (config: EndpointOptions): RequestConfig<TMethod, ExtractPath<T>, ExtractBody<T>, ExtractFormData<T>, ExtractQuery<T>, ExtractHeaders<T>, ExtractResponse<T>> => ({
      method,
      endpoint: config.endpoint,
      response: {} // Phantom type marker - no runtime value needed
    });
}

type SseEndpointTypes<TPath = undefined, TQuery = undefined, THeaders = undefined, TResponse = unknown> = {
  path?: TPath;
  query?: TQuery;
  headers?: THeaders;
  response?: TResponse;
};

type ExtractSsePath<T> = T extends { path: infer P } ? P : undefined;
type ExtractSseQuery<T> = T extends { query: infer Q } ? Q : undefined;
type ExtractSseHeaders<T> = T extends { headers: infer H } ? H : undefined;
type ExtractSseResponse<T> = T extends { response: infer R } ? R : unknown;

function createSseEndpointFactory() {
  return <T extends SseEndpointTypes<any, any, any, any> = {}>() =>
    (config: { endpoint: string }): SseConfig<ExtractSsePath<T>, ExtractSseQuery<T>, ExtractSseHeaders<T>, ExtractSseResponse<T>> => ({
      type: "sse" as const,
      endpoint: config.endpoint,
      response: {}
    });
}

export const sse = createSseEndpointFactory();

type WsEndpointTypes<TPath = undefined, TQuery = undefined, TSend = unknown, TReceive = unknown> = {
  path?: TPath;
  query?: TQuery;
  send?: TSend;
  receive?: TReceive;
};

type ExtractWsPath<T> = T extends { path: infer P } ? P : undefined;
type ExtractWsQuery<T> = T extends { query: infer Q } ? Q : undefined;
type ExtractWsSend<T> = T extends { send: infer S } ? S : unknown;
type ExtractWsReceive<T> = T extends { receive: infer R } ? R : unknown;

function createWsEndpointFactory() {
  return <T extends WsEndpointTypes<any, any, any, any> = {}>() =>
    (config: { endpoint: string }): WsConfig<ExtractWsPath<T>, ExtractWsQuery<T>, ExtractWsSend<T>, ExtractWsReceive<T>> => ({
      type: "ws" as const,
      endpoint: config.endpoint,
      send: {},
      receive: {}
    });
}

export const ws = createWsEndpointFactory();

// Individual endpoint factories
export const get = createEndpointFactory("GET");
export const post = createEndpointFactory("POST");
export const put = createEndpointFactory("PUT");
export const del = createEndpointFactory("DELETE");
export const patch = createEndpointFactory("PATCH");

// Namespace export
export const Endpoints = {
  get,
  post,
  put,
  delete: del,
  patch,
  sse,
  ws
} as const;
