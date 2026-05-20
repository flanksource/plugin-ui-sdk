export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export type InvokeOptions = Omit<RequestInit, "body"> & {
  query?: QueryParams;
};

export type StreamOptions = EventSourceInit;

const readyMessage = { type: "mc.tab.ready" } as const;

type RuntimeContext = {
  pluginRefSegment: string;
  configId: string;
};

export async function invoke(
  operation: string,
  body?: unknown,
  options: InvokeOptions = {},
): Promise<Response> {
  const { query, ...requestInit } = options;
  const hasBody = body !== undefined;
  const method = (requestInit.method ?? (hasBody ? "POST" : "GET")).toUpperCase();

  if (hasBody && (method === "GET" || method === "HEAD")) {
    throw new Error(`plugin-ui-sdk: ${method} requests cannot include a body; use query params instead`);
  }

  const headers = new Headers(requestInit.headers);
  const encodedBody = hasBody ? encodeBody(body, headers) : undefined;

  return fetch(operationURL(operation, query), {
    ...requestInit,
    method,
    credentials: requestInit.credentials ?? "same-origin",
    headers,
    body: encodedBody,
  });
}

export function stream(
  operation: string,
  query?: QueryParams,
  options?: StreamOptions,
): EventSource {
  if (typeof EventSource === "undefined") {
    throw new Error("plugin-ui-sdk: EventSource is not available in this environment");
  }
  return new EventSource(operationURL(operation, query), options);
}

export function ready(): void {
  currentWindow().parent.postMessage(readyMessage, "*");
}

function operationURL(operation: string, query?: QueryParams): string {
  validateOperation(operation);

  const win = currentWindow();
  const ctx = runtimeContext(win);
  const url = new URL(
    `/api/plugins/${ctx.pluginRefSegment}/proxy/${encodeURIComponent(operation)}`,
    win.location.href,
  );

  url.searchParams.set("config_id", ctx.configId);
  appendQuery(url.searchParams, query);

  return `${url.pathname}${url.search}`;
}

function runtimeContext(win: Window): RuntimeContext {
  const match = win.location.pathname.match(/^\/api\/plugins\/([^/]+)\/ui(?:\/|$)/);
  if (!match) {
    throw new Error("plugin-ui-sdk: expected to run under /api/plugins/<plugin>/ui");
  }

  const configId = new URLSearchParams(win.location.search).get("config_id");
  if (!configId) {
    throw new Error("plugin-ui-sdk: missing config_id in plugin UI URL");
  }

  return {
    pluginRefSegment: match[1],
    configId,
  };
}

function validateOperation(operation: string): void {
  if (!operation.trim()) {
    throw new Error("plugin-ui-sdk: operation is required");
  }
  if (operation.includes("/")) {
    throw new Error("plugin-ui-sdk: operation must be a single path segment");
  }
}

function appendQuery(searchParams: URLSearchParams, query?: QueryParams): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (key === "config_id") continue;

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === null || item === undefined) continue;
      searchParams.append(key, String(item));
    }
  }
}

function encodeBody(body: unknown, headers: Headers): BodyInit {
  if (isBodyInit(body)) return body;

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(body);
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof FormData !== "undefined" && value instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) ||
    (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) ||
    (typeof ReadableStream !== "undefined" && value instanceof ReadableStream)
  );
}

function currentWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("plugin-ui-sdk: window is not available in this environment");
  }
  return window;
}
