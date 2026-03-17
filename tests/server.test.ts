import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { ChannelConfig, OpenClawPluginApi } from "../src/types.js";
import { ResponseBridge } from "../src/channel.js";
import { createRestServer } from "../src/server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PORT = 17800;
const TEST_TOKEN = "test-secret-token";

function makeConfig(overrides?: Partial<ChannelConfig>): ChannelConfig {
  return {
    port: TEST_PORT,
    token: TEST_TOKEN,
    responseTimeout: 2,
    accounts: {
      "voice-satellite": { enabled: true },
      "home-assistant": { enabled: true },
      disabled: { enabled: false },
    },
    ...overrides,
  };
}

function makeMockApi(config: ChannelConfig): OpenClawPluginApi {
  return {
    config,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    registerChannel: vi.fn(),
    registerService: vi.fn(),
    dispatchMessage: vi.fn().mockResolvedValue({ messageId: "msg_test123" }),
  };
}

function request(
  method: string,
  path: string,
  opts?: { body?: unknown; token?: string | null },
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts?.token !== null) {
      headers["Authorization"] = `Bearer ${opts?.token ?? TEST_TOKEN}`;
    }
    let bodyStr: string | undefined;
    if (opts?.body !== undefined) {
      bodyStr = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let data: unknown;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("REST Channel HTTP Server", () => {
  let server: http.Server;
  let api: OpenClawPluginApi;
  let bridge: ResponseBridge;

  beforeAll(async () => {
    const config = makeConfig();
    api = makeMockApi(config);
    bridge = new ResponseBridge();
    server = createRestServer(config, api, bridge);
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  });

  afterAll(async () => {
    bridge.clear();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  // ----- Health -----------------------------------------------------------

  describe("GET /health", () => {
    it("returns status ok without auth", async () => {
      const res = await request("GET", "/health", { token: null });
      expect(res.status).toBe(200);
      const body = res.data as { status: string; channel: string; uptime: number };
      expect(body.status).toBe("ok");
      expect(body.channel).toBe("rest-channel");
      expect(typeof body.uptime).toBe("number");
    });
  });

  // ----- Auth -------------------------------------------------------------

  describe("Authentication", () => {
    it("rejects requests without auth header", async () => {
      const res = await request("POST", "/message", {
        token: null,
        body: {},
      });
      expect(res.status).toBe(401);
    });

    it("rejects requests with wrong token", async () => {
      const res = await request("POST", "/message", {
        token: "wrong-token",
        body: {},
      });
      expect(res.status).toBe(401);
    });
  });

  // ----- POST /message validation ----------------------------------------

  describe("POST /message — validation", () => {
    it("rejects invalid JSON", async () => {
      const res = await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: TEST_PORT,
            path: "/message",
            method: "POST",
            headers: {
              Authorization: `Bearer ${TEST_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
              resolve({
                status: res.statusCode ?? 0,
                data: JSON.parse(Buffer.concat(chunks).toString()),
              });
            });
          },
        );
        req.on("error", reject);
        req.write("not json");
        req.end();
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing required fields", async () => {
      const res = await request("POST", "/message", {
        body: { accountId: "voice-satellite" },
      });
      expect(res.status).toBe(400);
      expect((res.data as { details: string }).details).toContain("peer");
    });

    it("rejects invalid message type", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "kitchen",
          type: "video",
          payload: "hello",
        },
      });
      expect(res.status).toBe(400);
      expect((res.data as { details: string }).details).toContain("type");
    });

    it("rejects invalid timestamp", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "kitchen",
          type: "text",
          payload: "hello",
          timestamp: "not-a-date",
        },
      });
      expect(res.status).toBe(400);
      expect((res.data as { details: string }).details).toContain("timestamp");
    });
  });

  // ----- POST /message — account checks ----------------------------------

  describe("POST /message — accounts", () => {
    it("rejects unknown account", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "unknown",
          peer: "kitchen",
          type: "text",
          payload: "hello",
        },
      });
      expect(res.status).toBe(403);
    });

    it("rejects disabled account", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "disabled",
          peer: "kitchen",
          type: "text",
          payload: "hello",
        },
      });
      expect(res.status).toBe(403);
    });
  });

  // ----- POST /message — fire-and-forget ---------------------------------

  describe("POST /message — fire-and-forget", () => {
    it("returns 202 accepted", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "kitchen",
          type: "text",
          payload: "turn on the lights",
        },
      });
      expect(res.status).toBe(202);
      const body = res.data as { messageId: string; status: string };
      expect(body.status).toBe("accepted");
      expect(body.messageId).toBe("msg_test123");
    });

    it("dispatches message to gateway", async () => {
      await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "kitchen",
          type: "text",
          payload: "turn on the lights",
          timestamp: "2026-03-11T19:30:00Z",
        },
      });
      expect(api.dispatchMessage).toHaveBeenCalledWith({
        channel: "rest-channel",
        accountId: "voice-satellite",
        peer: "kitchen",
        type: "text",
        text: "turn on the lights",
        timestamp: "2026-03-11T19:30:00Z",
      });
    });

    it("uses fire-and-forget as default responseMode", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "kitchen",
          type: "text",
          payload: "test",
        },
      });
      expect(res.status).toBe(202);
      expect((res.data as { status: string }).status).toBe("accepted");
    });
  });

  // ----- POST /message — wait-for-response --------------------------------

  describe("POST /message — wait-for-response", () => {
    it("returns 200 with agent response", async () => {
      // Simulate agent response arriving after a short delay
      setTimeout(() => {
        bridge.resolveResponse("voice-satellite", "living-room", "Lights are on!");
      }, 100);

      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "living-room",
          type: "text",
          payload: "turn on the lights",
          responseMode: "wait-for-response",
        },
      });

      expect(res.status).toBe(200);
      const body = res.data as { messageId: string; status: string; response: string };
      expect(body.status).toBe("completed");
      expect(body.response).toBe("Lights are on!");
    });

    it("returns 202 on timeout", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "timeout-peer",
          type: "text",
          payload: "slow request",
          responseMode: "wait-for-response",
        },
      });

      expect(res.status).toBe(202);
      const body = res.data as { messageId: string; status: string; message: string };
      expect(body.status).toBe("timeout");
      expect(body.message).toContain("2 seconds");
    });
  });

  // ----- POST /message — poll (not implemented) ---------------------------

  describe("POST /message — poll", () => {
    it("returns 501 Not Implemented", async () => {
      const res = await request("POST", "/message", {
        body: {
          accountId: "voice-satellite",
          peer: "kitchen",
          type: "text",
          payload: "test",
          responseMode: "poll",
        },
      });
      expect(res.status).toBe(501);
    });
  });

  // ----- 404 --------------------------------------------------------------

  describe("Unknown routes", () => {
    it("returns 404 for unknown paths", async () => {
      const res = await request("GET", "/unknown");
      expect(res.status).toBe(404);
    });
  });
});
