import { appendQueryParam } from "./utils";

export type WsConnectionStatus = "connecting" | "open" | "reconnecting" | "stopped";

export type WsHandlers<TReceive> = {
  onMessage?: (message: TReceive) => void;
  onBinary?: (data: ArrayBuffer) => void;
  onOpen?: () => void;
  onClose?: (event: { code: number; reason: string }) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: WsConnectionStatus) => void;
};

export type WsReconnectPolicy = {
  minDelayMs?: number;
  maxDelayMs?: number;
};

export type WsConnectionOptions = {
  protocols?: string | string[];
  reconnect?: boolean | WsReconnectPolicy;
  // Read on every attempt, so a rotated bearer reaches the next reconnect. Sent only where the handshake takes headers.
  headers?: () => Record<string, string> | undefined;
};

export type WsConnection<TSend> = {
  connect: () => void;
  stop: () => void;
  send: (message: TSend) => boolean;
  sendBinary: (data: BufferSource) => boolean;
  status: () => WsConnectionStatus;
};

const READY_STATE_OPEN = 1;

type HeaderedWebSocket = new (url: string, init: { protocols?: string | string[]; headers: Record<string, string> }) => WebSocket;

type ServerGlobals = { Bun?: unknown; process?: { versions?: { node?: string } } };

// Bun and Node take handshake headers in an init object; a browser (window or worker) would read that object as a
// subprotocol and throw, and it never sends custom upgrade headers anyway.
const HANDSHAKE_TAKES_HEADERS = (() => {
  const runtime = globalThis as ServerGlobals;
  return runtime.Bun !== undefined || typeof runtime.process?.versions?.node === "string";
})();

function openSocket(url: string, options?: WsConnectionOptions): WebSocket {
  const headers = HANDSHAKE_TAKES_HEADERS ? options?.headers?.() : undefined;
  if (headers && Object.keys(headers).length > 0) {
    const init = options?.protocols === undefined ? { headers } : { headers, protocols: options.protocols };
    return new (WebSocket as unknown as HeaderedWebSocket)(url, init);
  }
  return options?.protocols === undefined ? new WebSocket(url) : new WebSocket(url, options.protocols);
}

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

export function createWsConnection<TSend, TReceive>(url: string, handlers: WsHandlers<TReceive>, options?: WsConnectionOptions): WsConnection<TSend> {
  const reconnect = options?.reconnect ?? true;
  const policy = typeof reconnect === "object" ? reconnect : {};
  const minDelayMs = policy.minDelayMs ?? 500;
  const maxDelayMs = policy.maxDelayMs ?? 15_000;

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
      ws = openSocket(url, options);
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      scheduleReconnect();
      return;
    }

    socket = ws;
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
