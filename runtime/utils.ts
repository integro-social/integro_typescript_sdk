import type { DedupeCache } from "./dedupe";
import * as Errors from "./errors";
import { t } from "./translations";
import type { Language } from "./translations";
import * as Types from "./types";

export function appendQueryParam(out: string[], key: string, value: unknown, nested = false): void {
  if (value === undefined) return;
  if (value === null) {
    if (nested) out.push(encodeURIComponent(key));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => appendQueryParam(out, `${key}[${i}]`, item, true));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendQueryParam(out, `${key}[${k}]`, v, true);
    }
    return;
  }
  out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

export function appendFormField(form: FormData, key: string, value: unknown): void {
  if (value instanceof Blob) {
    form.append(key, value);
    return;
  }
  if (typeof value === "string") {
    form.append(key, value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    form.append(key, String(value));
    return;
  }
  form.append(key, JSON.stringify(value));
}

export function buildUrl<T extends Types.RequestConfig<any, any, any, any, any, any, any>>(host: string, config: T, params: Types.RequesterParams<T>): string {
  let url = config.endpoint;

  if (params.path) {
    for (const [key, value] of Object.entries(params.path as Record<string, string>)) {
      url = url.replace(new RegExp(`:${key}(?![A-Za-z0-9_])`, "g"), encodeURIComponent(String(value)));
    }
  }

  let queryString = "";
  if (params.query) {
    const segments: string[] = [];
    for (const [key, value] of Object.entries(params.query as Record<string, unknown>)) {
      appendQueryParam(segments, key, value);
    }
    if (segments.length) queryString = `?${segments.join("&")}`;
  }

  return `${host}${url}${queryString}`;
}

export async function executeRequest<T extends Types.RequestConfig<any, any, any, any, any, any, any>>(
  url: string,
  config: T,
  params: Types.RequesterParams<T>,
  defaultHeaders?: Record<string, string>,
  language: Language = "en",
  credentials?: RequestCredentials,
  dedupe?: DedupeCache
): Promise<Response | Types.NetworkError> {
  const translations = t(language);
  const headers = new Headers({ ...defaultHeaders });

  if (params.headers) {
    for (const [key, value] of Object.entries(params.headers as Record<string, string>)) {
      headers.append(key, String(value));
    }
  }

  let body: BodyInit | undefined;

  if (params.formData) {
    body = new FormData();
    for (const [key, value] of Object.entries(params.formData as Record<string, any>)) {
      if (value === null || value === undefined) continue;
      if (value instanceof Array) {
        for (const item of value) {
          if (item === null || item === undefined) continue;
          appendFormField(body as FormData, key, item);
        }
        continue;
      }
      appendFormField(body as FormData, key, value);
    }
  } else if (params.body) {
    body = JSON.stringify(params.body);
    headers.append("Content-Type", "application/json");
  }

  try {
    if (dedupe) {
      if (config.method !== "GET") {
        try {
          return await fetch(url, { method: config.method, headers, body, signal: params.signal, credentials });
        } finally {
          dedupe.clear();
        }
      }
      if (body === undefined && !params.signal?.aborted) {
        return await dedupe.run(url, headers, () => fetch(url, { method: config.method, headers, credentials }));
      }
    }
    return await fetch(url, { method: config.method, headers, body, signal: params.signal, credentials });
  } catch (error) {
    return Errors.createNetworkError(translations.errors.requestFailed, error instanceof Error ? error : new Error(String(error)));
  }
}

export async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType) return response.json();
  if (contentType.includes("application/json") || contentType.includes("+json")) return response.json();
  if (contentType.startsWith("text/")) return response.text();
  return response.blob();
}

export async function handleErrorResponse<TError = string>(
  response: Response,
  errorHandler?: (response: Response) => Promise<TError>,
  language: Language = "en"
): Promise<Types.CustomError<TError>> {
  const translations = t(language);
  const rejected = translations.errors.requestRejected;

  let data: TError;
  let message: string;

  if (errorHandler) {
    try {
      data = await errorHandler(response);
      message = rejected;
    } catch {
      data = translations.errors.parseFailed as TError;
      message = translations.errors.parseFailed;
    }
  } else {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (typeof json === "string") {
        data = json as TError;
        message = json;
      } else {
        data = json as TError;
        message = rejected;
      }
    } catch {
      data = (text || rejected) as TError;
      message = text || rejected;
    }
  }

  return Errors.createCustomError(message, data, response.status);
}
