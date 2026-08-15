import { appendQueryParam } from "./utils";

export type WsConnectionStatus = "connecting" | "open" | "reconnecting" | "stopped";

/**
 * Lifecycle handlers for a WebSocket connection. Every handler is optional.
 *
 * - `onMessage`      fires once per received text frame, with the JSON-parsed payload.
 * - `onBinary`       fires once per received binary frame, with the raw bytes. Only
 *                    endpoints that carry binary alongside their typed protocol (live
 *                    media, chunked transfers) send these; leave it unset otherwise.
 * - `onOpen`         fires every time the socket is established — including after an
 *                    automatic reconnect. Send your handshake/subscription frames here:
 *                    anything the server needs to relearn must be re-sent per open.
 * - `onClose`        fires when the server or the network closes the socket. A manual
 *                    `stop()` does not trigger it. When reconnection is enabled, an
 *                    automatic reconnect is scheduled right after it fires.
 * - `onError`        fires on a connection failure or when a frame can't be parsed as
 *                    JSON. The socket close (and reconnect) is reported via `onClose`.
 * - `onStatusChange` fires on every `WsConnectionStatus` transition — the single
 *                    source of truth for connection state in UIs.
 */
export type WsHandlers<TReceive> = {
  onMessage?: (message: TReceive) => void;
  onBinary?: (data: ArrayBuffer) => void;
  onOpen?: () => void;
  onClose?: (event: { code: number; reason: string }) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: WsConnectionStatus) => void;
};

/**
 * Exponential backoff bounds for automatic reconnection. The delay doubles per
 * consecutive failure from `minDelayMs` (default 500) up to `maxDelayMs`
 * (default 15000), with random jitter to avoid thundering herds; a successful
 * open resets the ladder.
 */
export type WsReconnectPolicy = {
  minDelayMs?: number;
  maxDelayMs?: number;
};

export type WsConnectionOptions = {
  /**
   * WebSocket subprotocols for the handshake. The browser WebSocket API cannot
   * set arbitrary headers, so `Sec-WebSocket-Protocol` is the only client-set
   * handshake field — some backends use it to carry auth tokens.
   */
  protocols?: string | string[];
  /**
   * Reconnect automatically after any non-manual close (default true). Pass
   * `false` to disable, or a policy object to tune the backoff. A manual
   * `stop()` always wins over a pending or future reconnect.
   */
  reconnect?: boolean | WsReconnectPolicy;
};

export type WsConnection<TSend> = {
  connect: () => void;
  stop: () => void;
  /**
   * JSON-serialize and send one frame. Returns false (and sends nothing) when
   * the socket is not open — there is no buffering, by design: after a
   * reconnect the server has lost all connection state anyway, so senders must
   * re-establish it in `onOpen` rather than rely on queued frames.
   */
  send: (message: TSend) => boolean;
  /**
   * Send one raw binary frame, under the same no-buffering rule as `send`.
   * Only meaningful on an endpoint whose protocol defines binary payloads;
   * anywhere else the server ignores them.
   */
  sendBinary: (data: BufferSource) => boolean;
  status: () => WsConnectionStatus;
};

// readyState constants — avoids touching the WebSocket global before the
// environment check in `open()`.
const READY_STATE_OPEN = 1;

/**
 * Map the configured host's HTTP scheme onto the WebSocket one; hosts already
 * speaking ws(s) pass through untouched.
 */
function toWsScheme(url: string): string {
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
}

export function buildWsUrl(host: string, endpoint: string, params: { path?: Record<string, string>; query?: Record<string, unknown> }): string {
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

  return `${toWsScheme(host)}${url}${queryString}`;
}

/**
 * Open a bidirectional WebSocket speaking JSON text frames both ways, with
 * automatic reconnection.
 *
 * The browser WebSocket API cannot set request headers, so unlike tapi's
 * fetch-based routes there is no `headers` support here — cookies still ride
 * along under the browser's normal cookie rules, and `protocols` is available
 * for subprotocol-based auth schemes.
 */
export function createWsConnection<TSend, TReceive>(url: string, handlers: WsHandlers<TReceive>, options?: WsConnectionOptions): WsConnection<TSend> {
  const reconnect = options?.reconnect ?? true;
  const policy = typeof reconnect === "object" ? reconnect : {};
  const minDelayMs = policy.minDelayMs ?? 500;
  const maxDelayMs = policy.maxDelayMs ?? 15_000;

  // `socket` tracks the one live WebSocket; callbacks from any other instance
  // (superseded by connect(), detached by stop()) are stale and ignored.
  let socket: WebSocket | null = null;
  let state: WsConnectionStatus = "stopped";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  function setState(next: WsConnectionStatus) {
    if (state === next) return;
    state = next;
    handlers.onStatusChange?.(next);
  }

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function scheduleReconnect() {
    if (reconnect === false) {
      setState("stopped");
      return;
    }
    const backoff = Math.min(maxDelayMs, minDelayMs * 2 ** failures);
    failures += 1;
    setState("reconnecting");
    // Full-ish jitter: half the backoff fixed, half random.
    timer = setTimeout(open, backoff / 2 + Math.random() * (backoff / 2));
  }

  function open() {
    clearTimer();

    if (typeof WebSocket === "undefined") {
      setState("stopped");
      handlers.onError?.(new Error("WebSocket is not available in this environment"));
      return;
    }

    let ws: WebSocket;
    try {
      ws = options?.protocols === undefined ? new WebSocket(url) : new WebSocket(url, options.protocols);
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      scheduleReconnect();
      return;
    }

    socket = ws;
    // Binary frames arrive as ArrayBuffer rather than Blob, so `onBinary` can
    // read them synchronously — a media consumer cannot await a Blob per frame.
    ws.binaryType = "arraybuffer";
    if (state !== "reconnecting") setState("connecting");

    ws.onopen = () => {
      if (socket !== ws) return;
      failures = 0;
      setState("open");
      handlers.onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws) return;
      if (typeof event.data !== "string") {
        if (event.data instanceof ArrayBuffer) handlers.onBinary?.(event.data);
        return;
      }
      try {
        handlers.onMessage?.(JSON.parse(event.data) as TReceive);
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    ws.onerror = () => {
      if (socket !== ws) return;
      // The browser error event carries no detail; the close (with code) and
      // the reconnect are handled by onclose, which always follows.
      handlers.onError?.(new Error("WebSocket connection error"));
    };

    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      handlers.onClose?.({ code: event.code, reason: event.reason });
      scheduleReconnect();
    };
  }

  return {
    connect: () => {
      const previous = socket;
      socket = null; // stale-ify callbacks of the socket being replaced
      clearTimer();
      failures = 0;
      previous?.close();
      open();
    },
    stop: () => {
      const previous = socket;
      socket = null;
      clearTimer();
      setState("stopped");
      previous?.close();
    },
    send: (message: TSend) => {
      if (!socket || socket.readyState !== READY_STATE_OPEN) return false;
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    sendBinary: (data: BufferSource) => {
      if (!socket || socket.readyState !== READY_STATE_OPEN) return false;
      try {
        socket.send(data);
        return true;
      } catch {
        return false;
      }
    },
    status: () => state
  };
}
