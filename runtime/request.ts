import type { DedupeCache } from "./dedupe";
import * as Errors from "./errors";
import * as ResponseSchema from "./response";
import { t } from "./translations";
import type { Language } from "./translations";
import * as Types from "./types";
import * as Utils from "./utils";

function dispatchPostFetchCallback<TData, TError>(callback?: Types.PostfetchCallback<TData, TError>, args?: any): void {
  if (callback) {
    Promise.resolve()
      .then(() => callback(args))
      .catch(() => {});
  }
}

export function create<TConfig extends Types.RequestConfig<any, any, any, any, any, any, any>, TError = string>(
  host: string,
  config: TConfig,
  prefetchCallback: Types.PrefetchCallback | undefined,
  postfetchCallback: Types.PostfetchCallback<ResponseSchema.InferResult<TConfig["response"]>, TError> | undefined,
  headersRef: { current: Record<string, string> | undefined },
  errorHandler: ((response: Response) => Promise<TError>) | undefined,
  language: Language = "en",
  credentials?: RequestCredentials,
  dedupe?: DedupeCache
): Types.RequesterFunction<TConfig, TError> {
  const translations = t(language);

  const requester = async function (params: Types.CallSignature<TConfig>) {
    const promise = async (): Promise<Types.ApiResponse<ResponseSchema.InferResult<TConfig["response"]>, TError>> => {
      try {
        const url = Utils.buildUrl(host, config, params);

        const headers = new Headers({ ...(headersRef.current || {}) });
        if (params.headers) {
          for (const [key, value] of Object.entries(params.headers as Record<string, string>)) {
            headers.append(key, String(value));
          }
        }

        let body: BodyInit | null = null;
        if (params.formData) {
          body = new FormData();
          for (const [key, value] of Object.entries(params.formData as Record<string, any>)) {
            if (value === null || value === undefined) continue;
            if (value instanceof Array) {
              for (const item of value) {
                if (item === null || item === undefined) continue;
                Utils.appendFormField(body as FormData, key, item);
              }
              continue;
            }
            Utils.appendFormField(body as FormData, key, value);
          }
        } else if (params.body) {
          body = JSON.stringify(params.body);
          headers.append("Content-Type", "application/json");
        }

        if (prefetchCallback) {
          await Promise.resolve(prefetchCallback({ url, method: config.method, headers, body }));
        }

        const responseOrError = await Utils.executeRequest(url, config, params, headersRef.current, language, credentials, dedupe);
        if ("error" in responseOrError) {
          const nError = { ...responseOrError, endpoint: url, method: config.method };
          if (!params.signal?.aborted) dispatchPostFetchCallback(postfetchCallback, nError);
          return nError;
        }

        const response = responseOrError;
        if (!response.ok) {
          const errorResponse = await Utils.handleErrorResponse(response, errorHandler, language);
          const nError = { ...errorResponse, endpoint: url, method: config.method };
          dispatchPostFetchCallback(postfetchCallback, nError);
          return nError;
        }

        let data: any;
        try {
          data = (await Utils.parseResponseBody(response)) as typeof data;
        } catch (error) {
          const parseError = Errors.createParseError(translations.errors.parseFailed, error instanceof Error ? error : new Error(String(error)), response.status);
          const nError = { ...parseError, endpoint: url, method: config.method };
          if (!params.signal?.aborted) dispatchPostFetchCallback(postfetchCallback, nError);
          return nError;
        }

        const successResult = Errors.createSuccess(data);
        const nResult = { ...successResult, endpoint: config.endpoint, method: config.method };
        dispatchPostFetchCallback(postfetchCallback, nResult);
        return nResult;
      } catch (error) {
        const networkError = Errors.createNetworkError(translations.errors.requestFailed, error instanceof Error ? error : new Error(String(error)));
        const nError = { ...networkError, endpoint: config.endpoint, method: config.method };
        if (!params.signal?.aborted) dispatchPostFetchCallback(postfetchCallback, nError);
        return nError;
      }
    };

    return await promise();
  };

  return requester as Types.RequesterFunction<TConfig, TError>;
}
