import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMissionControlClient,
  createPluginRuntime,
  invoke,
  ready,
  stream,
} from "../src/index.js";

type WindowStub = {
  location: URL;
  parent: { postMessage: ReturnType<typeof vi.fn> };
};

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function setWindow(path: string): WindowStub {
  const win = {
    location: new URL(`https://mc.example.com${path}`),
    parent: { postMessage: vi.fn() },
  } as unknown as WindowStub;

  vi.stubGlobal("window", win);
  return win;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWindow !== undefined) vi.stubGlobal("window", originalWindow);
  if (originalFetch !== undefined) vi.stubGlobal("fetch", originalFetch);
  if (originalEventSource !== undefined) vi.stubGlobal("EventSource", originalEventSource);
});

describe("invoke", () => {
  it("derives the installed plugin name and config_id from the iframe URL", async () => {
    setWindow("/api/plugins/my-postgres/ui/query?config_id=config-123");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await invoke("explain", { sql: "select 1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/plugins/my-postgres/invoke/explain?config_id=config-123",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify({ sql: "select 1" }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("defaults to POST and sends the second argument as the invoke body", async () => {
    setWindow("/api/plugins/kubernetes-logs/ui/logs?config_id=abc");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await invoke("logs", { tail: 100, container: "api", empty: null, repeated: ["a", "b"] });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/plugins/kubernetes-logs/invoke/logs?config_id=abc",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ tail: 100, container: "api", empty: null, repeated: ["a", "b"] }));
  });

  it("uses the proxy endpoint and query params for GET requests", async () => {
    setWindow("/api/plugins/kubernetes-logs/ui/logs?config_id=abc");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await invoke("logs", { tail: 100, container: "api", empty: null, repeated: ["a", "b"] }, {
      method: "GET",
      proxy: true,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/plugins/kubernetes-logs/proxy/logs?config_id=abc&tail=100&container=api&repeated=a&repeated=b",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("sends an empty params object when body and query are omitted", async () => {
    setWindow("/api/plugins/my-postgres/ui/query?config_id=config-123");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await invoke("databases-list");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/plugins/my-postgres/invoke/databases-list?config_id=config-123",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({}));
  });
});

describe("stream", () => {
  it("opens an EventSource to the operation URL", () => {
    setWindow("/api/plugins/kubernetes-logs/ui/logs?config_id=abc");

    const eventSourceMock = vi.fn(function EventSourceStub(this: { url: string; options?: EventSourceInit }, url: string, options?: EventSourceInit) {
      this.url = url;
      this.options = options;
    });
    vi.stubGlobal("EventSource", eventSourceMock);

    stream("tail", { pod: "api" }, { withCredentials: true });

    expect(eventSourceMock).toHaveBeenCalledWith(
      "/api/plugins/kubernetes-logs/proxy/tail?config_id=abc&pod=api",
      { withCredentials: true },
    );
  });
});

describe("ready", () => {
  it("posts the ready message to the parent frame", () => {
    const win = setWindow("/api/plugins/demo/ui?config_id=abc");

    ready();

    expect(win.parent.postMessage).toHaveBeenCalledWith({ type: "mc.tab.ready" }, "*");
  });
});

describe("createPluginRuntime", () => {
  it("creates operation URLs without relying on window", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const runtime = createPluginRuntime({
      pluginRef: "kubernetes-logs",
      configId: "config-123",
      fetch: fetchMock,
    });

    expect(runtime.operationURL("pods", { namespace: "default" })).toBe(
      "/api/plugins/kubernetes-logs/invoke/pods?config_id=config-123",
    );
    expect(runtime.operationURL("pods", { namespace: "default" }, { method: "GET", proxy: true })).toBe(
      "/api/plugins/kubernetes-logs/proxy/pods?config_id=config-123&namespace=default",
    );

    await runtime.invoke("pods", { namespace: "default" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/plugins/kubernetes-logs/invoke/pods?config_id=config-123",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ namespace: "default" }));
  });

  it("supports custom base paths for host embedding", () => {
    const runtime = createPluginRuntime({
      pluginRef: "cost",
      configId: "abc",
      basePath: "/api/mission-control/api/plugins",
    });

    expect(runtime.operationURL("monthly")).toBe(
      "/api/mission-control/api/plugins/cost/invoke/monthly?config_id=abc",
    );
  });
});

describe("createMissionControlClient", () => {
  it("uses same-origin credentials for proxy mode", async () => {
    const fetchMock = vi.fn(async () => new Response("[]"));
    const client = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/api/mission-control",
      fetch: fetchMock,
    });

    await client.plugins.list();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/mission-control/api/plugins");
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("same-origin");
  });

  it("uses include credentials for pass-through mode", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const client = createMissionControlClient({
      mode: "pass-through",
      baseUrl: "https://mc.example.com",
      fetch: fetchMock,
    });

    await client.plugins.invoke("kubernetes-logs", "pods", { namespace: "default" }, {
      configId: "config-123",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://mc.example.com/api/plugins/kubernetes-logs/invoke/pods?config_id=config-123",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });
});
