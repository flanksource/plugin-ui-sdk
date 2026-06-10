export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export type InvokeOptions = Omit<RequestInit, "body"> & {
  proxy?: boolean;
};

export type StreamOptions = EventSourceInit;

export type ConnectionMode = "pass-through" | "proxy";

export type PluginComponentType = "panel" | "table" | "timeseries" | "action";

export type PluginRuntimeContext = {
  pluginRef: string;
  configId?: string;
  basePath?: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
};

export type PluginRuntime = {
  pluginRef: string;
  configId?: string;
  basePath: string;
  operationURL(operation: string, bodyOrQueryParams?: unknown, options?: InvokeOptions): string;
  invoke(operation: string, bodyOrQueryParams?: unknown, options?: InvokeOptions): Promise<Response>;
  stream(operation: string, query?: QueryParams, options?: StreamOptions): EventSource;
};

export type MissionControlClientOptions = {
  mode: ConnectionMode;
  baseUrl: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
};

export type MissionControlClient = {
  mode: ConnectionMode;
  baseUrl: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  plugins: PluginRegistryApi;
};

export type PluginRegistryApi = {
  list(): Promise<PluginManifest[]>;
  get(pluginRef: string): Promise<PluginManifest>;
  invoke(pluginRef: string, operation: string, bodyOrQueryParams?: unknown, options?: PluginInvokeOptions): Promise<Response>;
  stream(pluginRef: string, operation: string, request?: PluginStreamRequest): EventSource;
};

export type PluginManifest = {
  ref: string;
  name: string;
  version?: string;
  description?: string;
  operations?: PluginOperation[];
  components?: PluginComponent[];
};

export type PluginOperation = {
  name: string;
  method?: "GET" | "POST";
  streaming?: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type PluginComponent = {
  name: string;
  type: PluginComponentType;
  operation?: string;
};

export type PluginInvokeOptions = InvokeOptions & {
  configId?: string;
};

export type PluginStreamRequest = {
  configId?: string;
  query?: QueryParams;
  init?: EventSourceInit;
};

const DEFAULT_PLUGIN_BASE_PATH = "/api/plugins";
const FALLBACK_BASE_URL = "http://plugin-ui-sdk.local";
const CONFIG_ID_QUERY_PARAM = "config_id";
const PLUGIN_UI_PATH_PATTERN = /^\/api\/plugins\/([^/]+)\/ui(?:\/|$)/;
const READY_MESSAGE = { type: "mc.tab.ready" } as const;

/**
 * Calls a backend operation for the current plugin UI.
 *
 * This preserves the original iframe/runtime behavior: context is derived from
 * /api/plugins/<plugin>/ui?config_id=<config>.
 */
export async function invoke(
  operation: string,
  body?: unknown,
  options: InvokeOptions = {},
): Promise<Response> {
  return runtimeFromWindow().invoke(operation, body, options);
}

/** Opens an SSE stream for the current plugin UI. */
export function stream(
  operation: string,
  query?: QueryParams,
  options?: StreamOptions,
): EventSource {
  return runtimeFromWindow().stream(operation, query, options);
}

/** Signals the host frame that the plugin UI is ready. */
export function ready(): void {
  currentWindow().parent.postMessage(READY_MESSAGE, "*");
}

/**
 * Creates an explicit plugin runtime. Useful for native embedding, tests, and
 * host apps that do not run the plugin UI at /api/plugins/<plugin>/ui.
 */
export function createPluginRuntime(context: PluginRuntimeContext): PluginRuntime {
  const pluginRef = requireNonBlank(context.pluginRef, "pluginRef");
  const configId = normalizeOptionalString(context.configId);
  const basePath = normalizeBasePath(context.basePath ?? DEFAULT_PLUGIN_BASE_PATH);
  const fetchImpl = context.fetch;
  const EventSourceImpl = context.EventSource;

  const operationURL = (
    operation: string,
    bodyOrQueryParams?: unknown,
    options: InvokeOptions = {},
  ): string =>
    pluginOperationURL(
      {
        basePath,
        pluginRef,
        operation,
        configId,
        query: queryForMethod(options.method, bodyOrQueryParams),
      },
      options.proxy ? "proxy" : "invoke",
    );

  return {
    pluginRef,
    configId,
    basePath,
    operationURL,
    invoke(
      operation: string,
      bodyOrQueryParams?: unknown,
      options: InvokeOptions = {},
    ): Promise<Response> {
      return invokeURL(
        fetchImpl ?? globalFetch(),
        operationURL(operation, bodyOrQueryParams, options),
        bodyOrQueryParams,
        options,
      );
    },
    stream(operation: string, query?: QueryParams, options?: StreamOptions): EventSource {
      const EventSourceCtor = EventSourceImpl ?? globalEventSource();
      return new EventSourceCtor(
        pluginProxyOperationURL({
          basePath,
          pluginRef,
          operation,
          configId,
          query,
        }),
        options,
      );
    },
  };
}

/** Creates a host-side Mission Control client for proxy or pass-through mode. */
export function createMissionControlClient(options: MissionControlClientOptions): MissionControlClient {
  const mode = options.mode;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalFetch();
  const EventSourceImpl = options.EventSource;
  const defaultCredentials = credentialsForMode(mode);
  const pluginBasePath = joinURL(baseUrl, DEFAULT_PLUGIN_BASE_PATH);

  const request = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(joinURL(baseUrl, path), withDefaultCredentials(init, defaultCredentials));

  const runtimeFor = (pluginRef: string, configId?: string): PluginRuntime =>
    createPluginRuntime({
      pluginRef,
      configId,
      basePath: pluginBasePath,
      fetch: fetchImpl,
      EventSource: EventSourceImpl,
    });

  const plugins: PluginRegistryApi = {
    async list(): Promise<PluginManifest[]> {
      return responseJSON<PluginManifest[]>(
        await request(DEFAULT_PLUGIN_BASE_PATH),
        "failed to list plugins",
      );
    },

    async get(pluginRef: string): Promise<PluginManifest> {
      return responseJSON<PluginManifest>(
        await request(`${DEFAULT_PLUGIN_BASE_PATH}/${encodeURIComponent(pluginRef)}`),
        `failed to get plugin ${pluginRef}`,
      );
    },

    invoke(
      pluginRef: string,
      operation: string,
      bodyOrQueryParams?: unknown,
      options: PluginInvokeOptions = {},
    ): Promise<Response> {
      const { configId, ...invokeOptions } = options;
      return runtimeFor(pluginRef, configId).invoke(
        operation,
        bodyOrQueryParams,
        {
          ...invokeOptions,
          credentials: invokeOptions.credentials ?? defaultCredentials,
        },
      );
    },

    stream(
      pluginRef: string,
      operation: string,
      pluginRequest: PluginStreamRequest = {},
    ): EventSource {
      return runtimeFor(pluginRef, pluginRequest.configId).stream(
        operation,
        pluginRequest.query,
        {
          ...pluginRequest.init,
          withCredentials: pluginRequest.init?.withCredentials ?? mode === "pass-through",
        },
      );
    },
  };

  return {
    mode,
    baseUrl,
    request,
    plugins,
  };
}

function runtimeFromWindow(): PluginRuntime {
  const { pluginRef, configId } = runtimeContext(currentWindow());
  return createPluginRuntime({
    pluginRef,
    configId,
    basePath: DEFAULT_PLUGIN_BASE_PATH,
  });
}

function invokeURL(
  fetchImpl: typeof fetch,
  url: string,
  body?: unknown,
  options: InvokeOptions = {},
): Promise<Response> {
  const { proxy: _proxy, method: configuredMethod, ...requestInit } = options;
  const method = requestMethod(configuredMethod);
  const bodyless = isBodylessMethod(method);
  const payload = body === undefined ? {} : body;
  const headers = new Headers(requestInit.headers);
  const encodedBody = bodyless ? undefined : encodeBody(payload, headers);

  return fetchImpl(url, {
    ...requestInit,
    method,
    credentials: requestInit.credentials ?? "same-origin",
    headers,
    body: encodedBody,
  });
}

type WindowRuntimeContext = {
  pluginRef: string;
  configId: string;
};

function runtimeContext(win: Window): WindowRuntimeContext {
  const match = PLUGIN_UI_PATH_PATTERN.exec(win.location.pathname);
  if (!match) {
    throw sdkError("expected to run under /api/plugins/<plugin>/ui");
  }

  const configId = new URLSearchParams(win.location.search).get(CONFIG_ID_QUERY_PARAM);
  if (!configId) {
    throw sdkError("missing config_id in plugin UI URL");
  }

  return {
    pluginRef: decodeURIComponent(match[1]),
    configId,
  };
}

function pluginProxyOperationURL(args: {
  basePath: string;
  pluginRef: string;
  operation: string;
  configId?: string;
  query?: QueryParams;
}): string {
  return pluginOperationURL(args, "proxy");
}

function pluginOperationURL(
  args: {
    basePath: string;
    pluginRef: string;
    operation: string;
    configId?: string;
    query?: QueryParams;
  },
  endpoint: "invoke" | "proxy",
): string {
  const operation = validateOperation(args.operation);
  const url = new URL(
    `${args.basePath}/${encodeURIComponent(args.pluginRef)}/${endpoint}/${encodeURIComponent(operation)}`,
    fallbackBaseURL(),
  );

  if (args.configId) url.searchParams.set(CONFIG_ID_QUERY_PARAM, args.configId);
  appendQuery(url.searchParams, args.query);

  return stripFallbackOrigin(url);
}

function validateOperation(operation: string): string {
  const normalized = requireNonBlank(operation, "operation");
  if (normalized.includes("/")) {
    throw sdkError("operation must be a single path segment");
  }
  return normalized;
}

function appendQuery(searchParams: URLSearchParams, query?: QueryParams): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (key === CONFIG_ID_QUERY_PARAM) continue;

    for (const item of queryValues(value)) {
      if (item === null || item === undefined) continue;
      searchParams.append(key, String(item));
    }
  }
}

function queryValues(value: QueryValue | readonly QueryValue[]): readonly QueryValue[] {
  return isQueryValueArray(value) ? value : [value];
}

function isQueryValueArray(value: QueryValue | readonly QueryValue[]): value is readonly QueryValue[] {
  return Array.isArray(value);
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

function requestMethod(method: string | undefined): string {
  return (method ?? "POST").toUpperCase();
}

function isBodylessMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function queryForMethod(
  method: string | undefined,
  bodyOrQueryParams: unknown,
): QueryParams | undefined {
  if (!isBodylessMethod(requestMethod(method))) return undefined;
  if (bodyOrQueryParams === undefined || bodyOrQueryParams === null) return undefined;
  if (isPlainQueryParams(bodyOrQueryParams)) return bodyOrQueryParams;
  throw sdkError("GET and HEAD requests require query params as a plain object");
}

function isPlainQueryParams(value: unknown): value is QueryParams {
  if (!value || typeof value !== "object") return false;
  if (isBodyInit(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function credentialsForMode(mode: ConnectionMode): RequestCredentials {
  return mode === "pass-through" ? "include" : "same-origin";
}

function withDefaultCredentials(init: RequestInit, credentials: RequestCredentials): RequestInit {
  return {
    ...init,
    credentials: init.credentials ?? credentials,
  };
}

async function responseJSON<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    throw sdkError(`${message}: ${response.status} ${response.statusText}`.trim());
  }

  return response.json() as Promise<T>;
}

function currentWindow(): Window {
  if (typeof window === "undefined") {
    throw sdkError("window is not available in this environment");
  }
  return window;
}

function globalFetch(): typeof fetch {
  if (typeof fetch === "undefined") {
    throw sdkError("fetch is not available in this environment");
  }
  return fetch;
}

function globalEventSource(): typeof EventSource {
  if (typeof EventSource === "undefined") {
    throw sdkError("EventSource is not available in this environment");
  }
  return EventSource;
}

function normalizeBasePath(basePath: string): string {
  return requireNonBlank(trimTrailingSlash(basePath), "basePath");
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw sdkError("baseUrl is required");
  return trimTrailingSlash(trimmed);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw sdkError(`${field} is required`);
  return trimmed;
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function joinURL(base: string, path: string): string {
  return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

function fallbackBaseURL(): string {
  if (typeof window !== "undefined") return window.location.href;
  return FALLBACK_BASE_URL;
}

function stripFallbackOrigin(url: URL): string {
  if (url.origin === FALLBACK_BASE_URL) {
    return `${url.pathname}${url.search}`;
  }

  if (typeof window !== "undefined" && url.origin === window.location.origin) {
    return `${url.pathname}${url.search}`;
  }

  return url.toString();
}

function sdkError(message: string): Error {
  return new Error(`plugin-ui-sdk: ${message}`);
}
