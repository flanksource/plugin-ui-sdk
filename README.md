# @flanksource/plugin-ui-sdk

Browser SDK for Mission Control plugin UIs and host apps embedding Mission Control plugins.

The SDK has two layers:

1. **Plugin runtime API**: used inside a plugin UI to call its own backend operations.
2. **Host client API**: used by Backstage/flanksource-ui/customer apps to connect to Mission Control via pass-through cookies or backend proxy auth.

## Install

```sh
pnpm add @flanksource/plugin-ui-sdk
```

## Plugin runtime API

For code running inside a Mission Control plugin UI:

```ts
import { invoke, ready, stream } from "@flanksource/plugin-ui-sdk";
```

### `invoke(operation, bodyOrQueryParams?, options?)`

Calls a plugin backend operation and returns the native `Response`.

```ts
const res = await invoke("query", {
  sql: "select * from users limit 10",
});

if (!res.ok) throw new Error(await res.text());
const rows = await res.json();
```

With parameters:

```ts
const res = await invoke("logs", {
  tail: 100,
  container: "api",
});
```

Use the proxy endpoint for HTTP-style operations:

```ts
const res = await invoke("logs", { tail: 100, container: "api" }, {
  method: "GET",
  proxy: true,
});
```

Behavior:

- Uses the current plugin UI URL to find the installed plugin name.
- Automatically includes the current `config_id`.
- Defaults to `POST /api/plugins/:pluginRef/invoke/:operation`.
- Set `options.proxy: true` to use `/proxy/:operation` instead.
- Sends `{}` when no body is provided for methods that support a body.
- For `GET`/`HEAD`, treats the second argument as query parameters.
- JSON-encodes non-`BodyInit` bodies and sets `content-type: application/json`.

The current URL convention is:

```text
/api/plugins/:pluginRef/ui?config_id=:configId
/api/plugins/:pluginRef/invoke/:operation?config_id=:configId
```

### `stream(operation, query?, options?)`

Opens an SSE stream to a plugin operation. Streaming continues to use Mission Control's `/proxy/` endpoint because `EventSource` uses GET.

```ts
const events = stream("tail-logs", { pod: "api-123", tail: 100 });

events.onmessage = event => {
  console.log(event.data);
};
```

### `ready()`

Signals the host frame that the plugin UI has loaded.

```ts
ready();
```

Posts:

```ts
{ type: "mc.tab.ready" }
```

## Explicit plugin runtime

For native embedding or tests, create a runtime explicitly instead of deriving context from the iframe URL:

```ts
import { createPluginRuntime } from "@flanksource/plugin-ui-sdk";

const runtime = createPluginRuntime({
  pluginRef: "kubernetes-logs",
  configId: "config-123",
  basePath: "/api/plugins",
});

const res = await runtime.invoke("list-pods", {
  namespace: "default",
});
```

## Host client API

For apps embedding Mission Control plugin functionality:

```ts
import { createMissionControlClient } from "@flanksource/plugin-ui-sdk";
```

### Proxy mode

Browser calls the host backend. The host backend injects service auth and proxies to Mission Control.

```ts
const mc = createMissionControlClient({
  mode: "proxy",
  baseUrl: "/api/mission-control",
});
```

### Pass-through mode

Browser calls Mission Control directly using Mission Control cookies/session.

```ts
const mc = createMissionControlClient({
  mode: "pass-through",
  baseUrl: "https://mission-control.example.com",
});
```

Pass-through requires Mission Control cookies and CORS to support credentialed browser requests.

### Plugin discovery

```ts
const plugins = await mc.plugins.list();
const plugin = await mc.plugins.get("kubernetes-logs");
```

### Invoke plugin operations from the host

```ts
const res = await mc.plugins.invoke("kubernetes-logs", "list-pods", {
  namespace: "default",
}, {
  configId: "config-123",
});

const pods = await res.json();
```

### Stream plugin operations from the host

```ts
const events = mc.plugins.stream("kubernetes-logs", "tail-logs", {
  configId: "config-123",
  query: { pod: "api-123", container: "api" },
});
```

## Types

Important exported types:

```ts
type ConnectionMode = "pass-through" | "proxy";
type QueryParams = Record<string, string | number | boolean | null | undefined>; // arrays also supported

interface MissionControlClient {
  mode: ConnectionMode;
  baseUrl: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  plugins: PluginRegistryApi;
}

interface PluginRegistryApi {
  list(): Promise<PluginManifest[]>;
  get(pluginRef: string): Promise<PluginManifest>;
  invoke(pluginRef: string, operation: string, bodyOrQueryParams?: unknown, options?: PluginInvokeOptions): Promise<Response>;
  stream(pluginRef: string, operation: string, request?: PluginStreamRequest): EventSource;
}
```

## UI build guidance

Build plugin UIs as relocatable static apps:

- Use relative asset URLs. For Vite, set `base: "./"`.
- Use hash routing for internal UI routes.
- Use `invoke()` and `stream()` for plugin backend calls instead of hardcoding `/api/plugins/...` URLs.

Vite example:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
});
```

## Development

```sh
pnpm install
pnpm test
pnpm build
```
