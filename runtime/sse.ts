import { appendQueryParam } from "./utils";

export type SseConnectionStatus = "connecting" | "open" | "error" | "stopped";

export type SseConnection = {
  connect: () => void;
  stop: () => void;
  status: () => SseConnectionStatus;
};

/**
 * Lifecycle handlers for an SSE connection. Every handler is optional.
 *
 * - `onData`  fires once per dispatched event, with the JSON-parsed payload.
 * - `onOpen`  fires when the stream is established (response received, ok).
 * - `onError` fires on a network/HTTP failure or when an event payload can't be
 *             parsed as JSON. It does not fire for a user-initiated `stop()`.
 * - `onClose` fires when the server ends the stream. A manual `stop()` does not
 *             trigger it.
 */
export type SseHandlers<T> = {
  onData?: (data: T) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export type SseConnectionOptions = {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
};

export function buildSseUrl(host: string, endpoint: string, params: { path?: Record<string, string>; query?: Record<string, unknown> }): string {
  let url = endpoint;

  if (params.path) {
    for (const [key, value] of Object.entries(params.path)) {
      url = url.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }

  let queryString = "";
  if (params.query) {
    const segments: string[] = [];
    for (const [key, value] of Object.entries(params.query)) {
      appendQueryParam(segments, key, value);
    }
    if (segments.length) queryString = `?${segments.join("&")}`;
  }

  return `${host}${url}${queryString}`;
}

// A blank line separates events; line terminators may be CRLF, LF, or CR.
const EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;
const LINE_BOUNDARY = /\r\n|\n|\r/;

/**
 * Open an SSE stream over `fetch` (not the native `EventSource`) so that custom
 * headers can be sent — the browser `EventSource` API cannot set them. The
 * response body is read as a stream and parsed into events per the SSE spec.
 */
export function createConnection<T>(url: string, handlers: SseHandlers<T>, options?: SseConnectionOptions): SseConnection {
  let controller: AbortController | null = null;
  let state: SseConnectionStatus = "stopped";

  function dispatch(rawEvent: string) {
    const dataLines: string[] = [];
    for (const line of rawEvent.split(LINE_BOUNDARY)) {
      if (line.startsWith(":")) continue; // comment line
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      if (field !== "data") continue;
      const value = colon === -1 ? "" : line.slice(colon + 1);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }

    if (dataLines.length === 0) return;

    const data = dataLines.join("\n");
    try {
      handlers.onData?.(JSON.parse(data) as T);
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async function run() {
    const ac = new AbortController();
    controller = ac;
    state = "connecting";

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...(options?.headers || {}) },
        credentials: options?.credentials,
        signal: ac.signal
      });

      if (ac.signal.aborted) return;

      if (!response.ok || !response.body) {
        state = "error";
        handlers.onError?.(new Error(`SSE connection failed with status ${response.status}`));
        return;
      }

      state = "open";
      handlers.onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let match: RegExpExecArray | null;
        while ((match = EVENT_BOUNDARY.exec(buffer))) {
          const rawEvent = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          dispatch(rawEvent);
        }
      }

      if (ac.signal.aborted) return;
      state = "stopped";
      handlers.onClose?.();
    } catch (error) {
      if (ac.signal.aborted) return;
      state = "error";
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return {
    connect: () => {
      controller?.abort();
      run();
    },
    stop: () => {
      controller?.abort();
      controller = null;
      state = "stopped";
    },
    status: () => state
  };
}
