import { DedupeCache } from "./dedupe";
import type * as Hook from "./hook";
import type * as PagesHook from "./pages-hook";
import * as RequestCreator from "./request";
import type * as ResponseSchema from "./response";
import * as Sse from "./sse";
import type * as SseHook from "./sse-hook";
import type { Language } from "./translations";
import * as Types from "./types";
import * as Ws from "./ws";
import type * as WsHook from "./ws-hook";

export type ReactAdapter = {
  useHook: (requester: Types.RequesterFunction<any, any>, params: any) => any;
  usePages: (requester: Types.RequesterFunction<any, any>, params: any, options: any) => any;
  useSseHook: (
    host: string,
    config: Types.SseConfig<any, any, any, any>,
    params: any,
    options: { headers?: Record<string, string>; credentials?: RequestCredentials }
  ) => any;
  useWsHook: (host: string, config: Types.WsConfig<any, any, any, any>, params: any) => any;
};

type PathBuilderSignature<T extends Types.RequestConfig<any, any, any, any, any, any, any>> =
  Types.ExtractPath<T> extends undefined ? () => string : (params: Types.ExtractPath<T>) => string;

type PagedRouteMembers<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError> =
  ResponseSchema.InferResult<T["response"]> extends PagesHook.PageShape
    ? {
        usePages: {
          (params: PagesHook.PagesParams<T>, options?: PagesHook.PagesOptions<PagesHook.PageItem<T>>): PagesHook.PagesResponse<T, TError>;
          (params: PagesHook.PagesParams<T> | null, options?: PagesHook.PagesOptions<PagesHook.PageItem<T>>): PagesHook.IdlePagesResponse<T, TError>;
        };
      }
    : {};

type ReactRouteMembers<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError, TReact extends boolean> = TReact extends true
  ? {
      useHook: {
        (params: Types.CallSignature<T> & { lazy?: boolean }): Hook.HookResponse<T, TError>;
        (params: (Types.CallSignature<T> & { lazy?: boolean }) | null): Hook.IdleHookResponse<T, TError>;
      };
    } & PagedRouteMembers<T, TError>
  : {};

type ReactSseMembers<T extends Types.SseConfig<any, any, any, any>, TReact extends boolean> = TReact extends true
  ? { useSse: (params: SseHook.SseHookParams<T> | null) => SseHook.SseHookResponse }
  : {};

type WsSendOf<T extends Types.WsConfig<any, any, any, any>> = T extends Types.WsConfig<any, any, infer S, any> ? S : never;

type ReactWsMembers<T extends Types.WsConfig<any, any, any, any>, TReact extends boolean> = TReact extends true
  ? { useWs: (params: WsHook.WsHookParams<T> | null) => WsHook.WsHookResponse<WsSendOf<T>> }
  : {};

type RouteFunction<T extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string, TReact extends boolean = false> = Types.RequesterFunction<
  T,
  TError
> & {
  path: PathBuilderSignature<T>;
} & ReactRouteMembers<T, TError, TReact>;

type SseRouteFunction<T extends Types.SseConfig<any, any, any, any>, TReact extends boolean = false> = Types.SseListenerFunction<T> & ReactSseMembers<T, TReact>;

type WsRouteFunction<T extends Types.WsConfig<any, any, any, any>, TReact extends boolean = false> = Types.WsListenerFunction<T> & ReactWsMembers<T, TReact>;

type ApiNamespace<T extends Types.RouteDefinitions, TError, TReact extends boolean> = {
  [K in keyof T]: T[K] extends Types.SseConfig<any, any, any, any>
    ? SseRouteFunction<T[K], TReact>
    : T[K] extends Types.WsConfig<any, any, any, any>
      ? WsRouteFunction<T[K], TReact>
      : T[K] extends Types.RequestConfig<any, any, any, any, any, any, any>
        ? RouteFunction<T[K], TError, TReact>
        : T[K] extends Types.RouteDefinitions
          ? ApiNamespace<T[K], TError, TReact>
          : never;
};

export type GenerateApiMethods<T extends Types.RouteDefinitions, TError = string, TReact extends boolean = false> = ApiNamespace<T, TError, TReact> & {
  setHeaders: (headers: Record<string, string>) => void;
};

function isRequestConfig(value: unknown): value is Types.RequestConfig<any, any, any, any, any, any, any> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as any;
  return typeof v.method === "string" && typeof v.endpoint === "string" && typeof v.response === "object" && v.response !== null;
}

function isSseConfig(value: unknown): value is Types.SseConfig<any, any, any, any> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as any;
  return v.type === "sse" && typeof v.endpoint === "string";
}

function isWsConfig(value: unknown): value is Types.WsConfig<any, any, any, any> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as any;
  return v.type === "ws" && typeof v.endpoint === "string";
}

function createNestedMethods<TError = string>(
  host: string,
  routes: Types.RouteDefinitions,
  target: any,
  prefetchCallback: Types.PrefetchCallback | undefined,
  postfetchCallback: Types.PostfetchCallback<any, TError> | undefined,
  headersRef: { current: Record<string, string> | undefined },
  errorHandler: ((response: Response) => Promise<TError>) | undefined,
  language: Language = "en",
  credentials?: RequestCredentials,
  reactAdapter?: ReactAdapter,
  dedupe?: DedupeCache
) {

  for (const [routeName, routeValue] of Object.entries(routes)) {
    if (isSseConfig(routeValue)) {
      const sseConfig = routeValue;
      const sseFunction = (params: any, handlers: Sse.SseHandlers<any>) => {
        const url = Sse.buildSseUrl(host, sseConfig.endpoint, params);
        const headers = { ...(headersRef.current || {}), ...(params.headers || {}) };
        return Sse.createConnection(url, handlers, { headers, credentials });
      };
      if (reactAdapter) {
        (sseFunction as any).useSse = (params: any) => reactAdapter.useSseHook(host, sseConfig, params, { headers: headersRef.current, credentials });
      }
      target[routeName] = sseFunction;
    } else if (isWsConfig(routeValue)) {
      const wsConfig = routeValue;
      const wsFunction = (params: any, handlers: Ws.WsHandlers<any>) => {
        const url = Ws.buildWsUrl(host, wsConfig.endpoint, params);
        return Ws.createWsConnection(url, handlers, { protocols: params.protocols, reconnect: params.reconnect });
      };
      if (reactAdapter) {
        (wsFunction as any).useWs = (params: any) => reactAdapter.useWsHook(host, wsConfig, params);
      }
      target[routeName] = wsFunction;
    } else if (isRequestConfig(routeValue)) {
      const requester = RequestCreator.create(host, routeValue, prefetchCallback, postfetchCallback, headersRef, errorHandler, language, credentials, dedupe);
      if (reactAdapter) {
        (requester as any).useHook = (params: any) => reactAdapter.useHook(requester, params);
        (requester as any).usePages = (params: any, options: any) => reactAdapter.usePages(requester, params, options);
      }
      (requester as any).path = (params?: Record<string, string>) => {
        let url = routeValue.endpoint;
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            url = url.replace(new RegExp(`:${key}(?![A-Za-z0-9_])`, "g"), encodeURIComponent(String(value)));
          }
        }
        return `${host}${url}`;
      };
      target[routeName] = requester;
    } else if (typeof routeValue === "object" && routeValue !== null) {
      target[routeName] = {};
      createNestedMethods(
        host,
        routeValue as Types.RouteDefinitions,
        target[routeName],
        prefetchCallback,
        postfetchCallback,
        headersRef,
        errorHandler,
        language,
        credentials,
        reactAdapter,
        dedupe
      );
    }
  }

}

export class TapiBuilder<
  TRoutes extends Types.RouteDefinitions = {},
  TError = string,
  THasHost extends boolean = false,
  THasRoutes extends boolean = false,
  TReact extends boolean = false
> {
  private host?: string;
  private routes?: TRoutes;
  private prefetchCallback?: Types.PrefetchCallback;
  private postfetchCallback?: Types.PostfetchCallback<any, TError>;
  private defaultHeaders?: Record<string, string>;
  private errorHandler?: (response: Response) => Promise<TError>;
  private language: Language = "en";
  private credentials?: RequestCredentials;
  private getDedupeTtlMs?: number;
  private reactAdapter?: ReactAdapter;

  constructor(reactAdapter?: ReactAdapter) {
    this.reactAdapter = reactAdapter;
  }

  private clone<NRoutes extends Types.RouteDefinitions, NError, NHasHost extends boolean, NHasRoutes extends boolean>(): TapiBuilder<
    NRoutes,
    NError,
    NHasHost,
    NHasRoutes,
    TReact
  > {
    const builder = new TapiBuilder<NRoutes, NError, NHasHost, NHasRoutes, TReact>(this.reactAdapter);
    builder.host = this.host;
    builder.routes = this.routes as unknown as NRoutes;
    builder.prefetchCallback = this.prefetchCallback;
    builder.postfetchCallback = this.postfetchCallback as unknown as Types.PostfetchCallback<any, NError>;
    builder.defaultHeaders = this.defaultHeaders;
    builder.errorHandler = this.errorHandler as unknown as (response: Response) => Promise<NError>;
    builder.language = this.language;
    builder.credentials = this.credentials;
    builder.getDedupeTtlMs = this.getDedupeTtlMs;
    return builder;
  }

  withHost(host: string): TapiBuilder<TRoutes, TError, true, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, true, THasRoutes>();
    builder.host = host;
    return builder;
  }

  withRoutes<T extends Types.RouteDefinitions>(routes: T): TapiBuilder<T, TError, THasHost, true, TReact> {
    const builder = this.clone<T, TError, THasHost, true>();
    builder.routes = routes;
    return builder;
  }

  withApiError<T>(errorHandler: (response: Response) => Promise<T>): TapiBuilder<TRoutes, T, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, T, THasHost, THasRoutes>();
    builder.postfetchCallback = undefined; // Reset postfetch as error type changed
    builder.errorHandler = errorHandler;
    return builder;
  }

  withPrefetch(callback: Types.PrefetchCallback): TapiBuilder<TRoutes, TError, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, THasHost, THasRoutes>();
    builder.prefetchCallback = callback;
    return builder;
  }

  withPostfetch(callback: Types.PostfetchCallback<any, TError>): TapiBuilder<TRoutes, TError, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, THasHost, THasRoutes>();
    builder.postfetchCallback = callback;
    return builder;
  }

  withDefaultHeaders(headers: Record<string, string>): TapiBuilder<TRoutes, TError, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, THasHost, THasRoutes>();
    builder.defaultHeaders = headers;
    return builder;
  }

  withLanguage(language: Language): TapiBuilder<TRoutes, TError, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, THasHost, THasRoutes>();
    builder.language = language;
    return builder;
  }

  withCredentials(credentials: RequestCredentials): TapiBuilder<TRoutes, TError, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, THasHost, THasRoutes>();
    builder.credentials = credentials;
    return builder;
  }

  withGetDedupe(ttlMs: number = 1000): TapiBuilder<TRoutes, TError, THasHost, THasRoutes, TReact> {
    const builder = this.clone<TRoutes, TError, THasHost, THasRoutes>();
    builder.getDedupeTtlMs = ttlMs;
    return builder;
  }

  build(
    ..._args: THasHost extends false ? ["Host is required - use .withHost() first"] : THasRoutes extends false ? ["Routes are required - use .withRoutes() first"] : []
  ): THasHost extends true ? (THasRoutes extends true ? GenerateApiMethods<TRoutes, TError, TReact> : never) : never {
    const apiMethods: any = {};
    const headersRef = { current: this.defaultHeaders };
    apiMethods.setHeaders = (headers: Record<string, string>) => {
      headersRef.current = headers;
    };
    createNestedMethods(
      this.host as string,
      this.routes as TRoutes,
      apiMethods,
      this.prefetchCallback,
      this.postfetchCallback,
      headersRef,
      this.errorHandler,
      this.language,
      this.credentials,
      this.reactAdapter,
      this.getDedupeTtlMs === undefined ? undefined : new DedupeCache(this.getDedupeTtlMs)
    );
    return apiMethods as any;
  }
}
