import type { DedupeCache } from "./dedupe";
import * as Errors from "./errors";
import { t } from "./translations";
import type { Language } from "./translations";
import * as Types from "./types";

/**
 * Append a query param as encoded `key=value` segments, recursing into arrays
 * (`key[0]`) and objects (`key[sub]`) to match serde_qs bracket nesting.
 *
 * A nested `null` is emitted as a bare valueless key (`a[k]`, no `=`), which
 * serde_qs parses as `None` — this keeps map entries whose value means "no
 * restriction". Skipping it (like `undefined`, or a top-level `null`) would
 * drop the map key entirely. URLSearchParams cannot produce a key without
 * `=`, hence the manual segment building.
 */
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

/**
 * Append a single value to a FormData body. Blobs/Files are sent as binary
 * parts and strings/numbers/booleans as-is, but nested objects are serialized
 * to JSON so a typed struct field (e.g. a tagged union) can travel as one
 * multipart part and be parsed server-side. Without this, `FormData.append`
 * coerces an object to the literal string "[object Object]".
 */
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

  // Replace path parameters. The trailing boundary matters: a plain
  // `replace(":" + key)` on `/a/:group_uid/:group` rewrites the `:group` prefix
  // of `:group_uid` first and corrupts it. No route collides today — this makes
  // the class impossible rather than unlikely.
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

  // Add custom headers from params
  if (params.headers) {
    for (const [key, value] of Object.entries(params.headers as Record<string, string>)) {
      headers.append(key, String(value));
    }
  }

  let body: BodyInit | undefined;

  // Handle FormData
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
    // Handle JSON body
    body = JSON.stringify(params.body);
    headers.append("Content-Type", "application/json");
  }

  try {
    if (dedupe) {
      if (config.method !== "GET") {
        // A mutation may invalidate anything cached: clear once it settles so a
        // refetch awaited after it always hits the network.
        try {
          return await fetch(url, { method: config.method, headers, body, signal: params.signal, credentials });
        } finally {
          dedupe.clear();
        }
      }
      if (body === undefined && !params.signal?.aborted) {
        // The shared request drops the caller's signal: one consumer aborting
        // (e.g. a hook unmounting) must not cancel the fetch for the others.
        // Aborted callers already discard the settled result. Pre-aborted
        // callers (and nonstandard GETs with a body) fall through to a plain
        // fetch for exact native semantics.
        return await dedupe.run(url, headers, () => fetch(url, { method: config.method, headers, credentials }));
      }
    }
    return await fetch(url, { method: config.method, headers, body, signal: params.signal, credentials });
  } catch (error) {
    return Errors.createNetworkError(translations.errors.requestFailed, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Parse a successful response body based on its Content-Type header.
 * - JSON content types (`application/json`, `application/*+json`) -> parsed object
 * - `text/*` -> string
 * - anything else with a Content-Type -> Blob (binary)
 * - missing/empty Content-Type -> JSON (preserves the common-case default)
 */
/**
 * Read a successful response body by Content-Type.
 *
 * Returns `unknown`, not `any`: this is a trust boundary — the bytes are
 * whatever the server (or a proxy returning an HTML error page under a JSON
 * content-type) actually sent, and `any` let that flow into typed code with no
 * cast and no error. The one cast onto the route's declared response type lives
 * at the single call site in `request.ts`, so it stays greppable and a real
 * decoder can replace it without touching this function.
 */
export async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType) return response.json();
  if (contentType.includes("application/json") || contentType.includes("+json")) return response.json();
  if (contentType.startsWith("text/")) return response.text();
  return response.blob();
}

/**
 * Turn an error response into a `CustomError`.
 *
 * Two kinds of text end up in `message`, and they are handled differently: text
 * the *server* sent is passed through untouched — it is already the server's
 * own wording, in whatever language it chose — while text this function has to
 * invent is taken from the translation table. Inventing English for a `br`
 * consumer is what this used to do.
 *
 * The synthesized message carries no status code: `CustomError` already has one
 * in `code`, and consumers surface it separately, so `API error 404: Not Found`
 * was both untranslated and redundant.
 */
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
      // The handler threw, so there is no server message to relay — the body
      // was unreadable, which is a parse failure rather than a rejection.
      data = translations.errors.parseFailed as TError;
      message = translations.errors.parseFailed;
    }
  } else {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (typeof json === "string") {
        // A bare JSON string *is* the server's message: relay it verbatim.
        data = json as TError;
        message = json;
      } else {
        // A structured body goes to `data` untouched; it is the consumer's to
        // interpret, and no field of it is known to be a display string.
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
