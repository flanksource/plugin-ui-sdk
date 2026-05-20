# @flanksource/plugin-ui-sdk

Browser SDK for Mission Control plugin UIs.

The SDK keeps plugin UIs from hardcoding Mission Control routing details or the installed plugin name. A plugin can be installed as `postgres`, `my-postgres`, or any other CRD name; the SDK derives the correct route from the iframe URL.

## Install

```sh
pnpm add @flanksource/plugin-ui-sdk
```

## API

There are three public functions:

```ts
import { invoke, ready, stream } from "@flanksource/plugin-ui-sdk";
```

### `invoke(operation, body?, options?)`

Calls a plugin HTTP operation through Mission Control and returns the native `Response`.

```ts
const res = await invoke("query", {
  sql: "select * from users limit 10",
});

if (!res.ok) throw new Error(await res.text());
const rows = await res.json();
```

With query parameters:

```ts
const res = await invoke("logs", undefined, {
  method: "GET",
  query: { tail: 100, container: "api" },
});
```

Behavior:

- Uses the current iframe URL to find the installed plugin name.
- Automatically includes the current `config_id`.
- Defaults to `POST` when `body` is provided.
- Defaults to `GET` when no `body` is provided.
- JSON-encodes non-`BodyInit` bodies and sets `content-type: application/json`.
- Returns `Response`; callers decide whether to use `.json()`, `.text()`, `.blob()`, etc.

### `stream(operation, query?, options?)`

Opens an SSE stream to a plugin HTTP operation and returns the native `EventSource`.

```ts
const events = stream("tail-logs", { pod: "api-123", tail: 100 });

events.onmessage = event => {
  console.log(JSON.parse(event.data));
};

events.onerror = () => events.close();
```

The plugin operation should respond with `text/event-stream`.

### `ready()`

Signals Mission Control that the iframe is ready.

```ts
ready();
```

## UI build guidance

Build the UI as a relocatable static app:

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
