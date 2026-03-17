import type {
  ChannelConfig,
  ChannelPlugin,
  PendingResponse,
  SendTextArgs,
} from "./types.js";

// ---------------------------------------------------------------------------
// Response bridge
//
// Coordinates between the HTTP server (which holds connections open for
// wait-for-response mode) and the channel's outbound.sendText (called by
// the gateway when the agent produces a reply).
//
// Keyed by "accountId:peer" — each device/peer can have at most one
// pending synchronous request at a time. If a second request arrives for
// the same peer while one is already pending, the first one is resolved
// with the next agent response and the new request takes over.
// ---------------------------------------------------------------------------

export class ResponseBridge {
  private pending = new Map<string, PendingResponse[]>();

  private key(accountId: string, peer: string): string {
    return `${accountId}:${peer}`;
  }

  /**
   * Register a pending response for wait-for-response mode.
   * Returns a promise that resolves with the agent's response text,
   * or rejects on timeout.
   */
  waitForResponse(
    messageId: string,
    accountId: string,
    peer: string,
    timeoutMs: number,
  ): Promise<string> {
    const k = this.key(accountId, peer);

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this pending entry on timeout
        const queue = this.pending.get(k);
        if (queue) {
          const idx = queue.findIndex((p) => p.messageId === messageId);
          if (idx !== -1) queue.splice(idx, 1);
          if (queue.length === 0) this.pending.delete(k);
        }
        reject(new Error("timeout"));
      }, timeoutMs);

      const entry: PendingResponse = { messageId, resolve, timer };

      const queue = this.pending.get(k);
      if (queue) {
        queue.push(entry);
      } else {
        this.pending.set(k, [entry]);
      }
    });
  }

  /**
   * Called by outbound.sendText when the agent produces a reply.
   * Resolves the oldest pending response for the given accountId:peer.
   * Returns true if a pending response was resolved, false otherwise.
   */
  resolveResponse(accountId: string, peer: string, text: string): boolean {
    const k = this.key(accountId, peer);
    const queue = this.pending.get(k);
    if (!queue || queue.length === 0) return false;

    const entry = queue.shift()!;
    clearTimeout(entry.timer);
    entry.resolve(text);

    if (queue.length === 0) this.pending.delete(k);
    return true;
  }

  /** Clean up all pending responses (used during shutdown). */
  clear(): void {
    for (const queue of this.pending.values()) {
      for (const entry of queue) {
        clearTimeout(entry.timer);
      }
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Channel plugin factory
// ---------------------------------------------------------------------------

export function createChannelPlugin(bridge: ResponseBridge): ChannelPlugin {
  return {
    id: "rest-channel",

    meta: {
      id: "rest-channel",
      label: "REST Channel",
      blurb:
        "Generic REST API channel for external devices and services",
      selectionLabel: "REST",
      aliases: ["rest"],
    },

    capabilities: {
      chatTypes: ["direct"],
    },

    config: {
      listAccountIds(cfg: ChannelConfig): string[] {
        return Object.keys(cfg.accounts ?? {});
      },

      resolveAccount(cfg: ChannelConfig, accountId: string) {
        return cfg.accounts?.[accountId];
      },
    },

    outbound: {
      deliveryMode: "direct",

      async sendText({ text, ctx }: SendTextArgs): Promise<{ ok: boolean }> {
        const accountId = ctx.accountId;
        const peer = ctx.peer;

        // Try to resolve a pending wait-for-response request
        const resolved = bridge.resolveResponse(accountId, peer, text);

        // Even if there's no pending HTTP request (fire-and-forget mode),
        // the delivery is considered successful — the message was processed.
        return { ok: resolved };
      },
    },
  };
}
