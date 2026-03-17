import { describe, it, expect, vi } from "vitest";
import { ResponseBridge, createChannelPlugin } from "../src/channel.js";
import { validateMessageRequest } from "../src/validation.js";

// ---------------------------------------------------------------------------
// ResponseBridge
// ---------------------------------------------------------------------------

describe("ResponseBridge", () => {
  it("resolves a pending response", async () => {
    const bridge = new ResponseBridge();

    const promise = bridge.waitForResponse("msg_1", "sat", "kitchen", 5000);

    // Simulate agent responding
    const resolved = bridge.resolveResponse("sat", "kitchen", "Done!");
    expect(resolved).toBe(true);

    const text = await promise;
    expect(text).toBe("Done!");
  });

  it("returns false when no pending response exists", () => {
    const bridge = new ResponseBridge();
    const resolved = bridge.resolveResponse("sat", "kitchen", "Hello");
    expect(resolved).toBe(false);
  });

  it("times out pending responses", async () => {
    const bridge = new ResponseBridge();

    await expect(
      bridge.waitForResponse("msg_1", "sat", "kitchen", 50),
    ).rejects.toThrow("timeout");
  });

  it("handles FIFO ordering for same peer", async () => {
    const bridge = new ResponseBridge();

    const p1 = bridge.waitForResponse("msg_1", "sat", "kitchen", 5000);
    const p2 = bridge.waitForResponse("msg_2", "sat", "kitchen", 5000);

    bridge.resolveResponse("sat", "kitchen", "First");
    bridge.resolveResponse("sat", "kitchen", "Second");

    expect(await p1).toBe("First");
    expect(await p2).toBe("Second");
  });

  it("isolates different peers", async () => {
    const bridge = new ResponseBridge();

    const pKitchen = bridge.waitForResponse("msg_1", "sat", "kitchen", 5000);
    const pLiving = bridge.waitForResponse("msg_2", "sat", "living", 5000);

    bridge.resolveResponse("sat", "living", "Living response");
    bridge.resolveResponse("sat", "kitchen", "Kitchen response");

    expect(await pKitchen).toBe("Kitchen response");
    expect(await pLiving).toBe("Living response");
  });

  it("clears all pending responses", () => {
    const bridge = new ResponseBridge();

    // These will timeout but we're clearing before that
    bridge.waitForResponse("msg_1", "sat", "kitchen", 60000).catch(() => {});
    bridge.waitForResponse("msg_2", "sat", "living", 60000).catch(() => {});

    // Should not throw
    bridge.clear();

    // Resolving after clear should return false
    expect(bridge.resolveResponse("sat", "kitchen", "test")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChannelPlugin
// ---------------------------------------------------------------------------

describe("createChannelPlugin", () => {
  it("has correct id and meta", () => {
    const bridge = new ResponseBridge();
    const plugin = createChannelPlugin(bridge);

    expect(plugin.id).toBe("rest-channel");
    expect(plugin.meta.id).toBe("rest-channel");
    expect(plugin.meta.label).toBe("REST Channel");
    expect(plugin.capabilities.chatTypes).toEqual(["direct"]);
  });

  it("lists account IDs from config", () => {
    const bridge = new ResponseBridge();
    const plugin = createChannelPlugin(bridge);

    const ids = plugin.config.listAccountIds({
      token: "x",
      accounts: {
        "voice-satellite": { enabled: true },
        "home-assistant": { enabled: true },
      },
    });

    expect(ids).toEqual(["voice-satellite", "home-assistant"]);
  });

  it("returns empty array when no accounts configured", () => {
    const bridge = new ResponseBridge();
    const plugin = createChannelPlugin(bridge);

    expect(plugin.config.listAccountIds({ token: "x" })).toEqual([]);
  });

  it("resolves account config", () => {
    const bridge = new ResponseBridge();
    const plugin = createChannelPlugin(bridge);

    const cfg = { token: "x", accounts: { sat: { enabled: true } } };
    expect(plugin.config.resolveAccount(cfg, "sat")).toEqual({ enabled: true });
    expect(plugin.config.resolveAccount(cfg, "unknown")).toBeUndefined();
  });

  it("sendText resolves pending response via bridge", async () => {
    const bridge = new ResponseBridge();
    const plugin = createChannelPlugin(bridge);

    const promise = bridge.waitForResponse("msg_1", "sat", "kitchen", 5000);

    const result = await plugin.outbound.sendText({
      text: "Lights on!",
      ctx: { channel: "rest-channel", accountId: "sat", peer: "kitchen" },
    });

    expect(result.ok).toBe(true);
    expect(await promise).toBe("Lights on!");
  });

  it("sendText returns ok:false when no pending request", async () => {
    const bridge = new ResponseBridge();
    const plugin = createChannelPlugin(bridge);

    const result = await plugin.outbound.sendText({
      text: "No one is listening",
      ctx: { channel: "rest-channel", accountId: "sat", peer: "kitchen" },
    });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateMessageRequest", () => {
  const validBody = {
    accountId: "voice-satellite",
    peer: "kitchen",
    type: "text",
    payload: "turn on the lights",
  };

  it("accepts valid minimal request", () => {
    const result = validateMessageRequest(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.accountId).toBe("voice-satellite");
      expect(result.data.responseMode).toBe("fire-and-forget");
    }
  });

  it("accepts valid full request", () => {
    const result = validateMessageRequest({
      ...validBody,
      timestamp: "2026-03-11T19:30:00Z",
      responseMode: "wait-for-response",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.responseMode).toBe("wait-for-response");
      expect(result.data.timestamp).toBe("2026-03-11T19:30:00Z");
    }
  });

  it("rejects non-object body", () => {
    expect(validateMessageRequest("string").ok).toBe(false);
    expect(validateMessageRequest(null).ok).toBe(false);
    expect(validateMessageRequest([]).ok).toBe(false);
  });

  it("rejects empty accountId", () => {
    const result = validateMessageRequest({ ...validBody, accountId: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects missing peer", () => {
    const { peer, ...noPeer } = validBody;
    const result = validateMessageRequest(noPeer);
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported type", () => {
    const result = validateMessageRequest({ ...validBody, type: "audio" });
    expect(result.ok).toBe(false);
  });

  it("rejects empty payload", () => {
    const result = validateMessageRequest({ ...validBody, payload: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid timestamp", () => {
    const result = validateMessageRequest({ ...validBody, timestamp: "nope" });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid responseMode", () => {
    const result = validateMessageRequest({ ...validBody, responseMode: "stream" });
    expect(result.ok).toBe(false);
  });
});
