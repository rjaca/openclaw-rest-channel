import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ResponseBridge } from "./channel.js";
import type {
  ChannelConfig,
  ErrorResponse,
  HealthResponse,
  MessageAcceptedResponse,
  MessageCompletedResponse,
  MessageTimeoutResponse,
  OpenClawPluginApi,
} from "./types.js";
import { validateMessageRequest } from "./validation.js";

const CHANNEL_ID = "rest-channel";

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

export function createRestServer(
  config: ChannelConfig,
  api: OpenClawPluginApi,
  bridge: ResponseBridge,
  runtime: any,
): Server {
  const startTime = Date.now();
  const port = config.port ?? 7800;
  const token = config.token;
  const responseTimeout = (config.responseTimeout ?? 60) * 1000; // ms

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      api.logger.error("Unhandled error in REST channel server", err);
      sendJson(res, 500, { error: "Internal Server Error" } satisfies ErrorResponse);
    }
  });

  // ------ Request handling --------------------------------------------------

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method?.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // Health check — no auth required
    if (method === "GET" && path === "/health") {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      sendJson(res, 200, {
        status: "ok",
        channel: CHANNEL_ID,
        uptime,
      } satisfies HealthResponse);
      return;
    }

    // All other routes require auth
    if (!authenticate(req)) {
      sendJson(res, 401, { error: "Unauthorized" } satisfies ErrorResponse);
      return;
    }

    // POST /message
    if (method === "POST" && path === "/message") {
      const body = await readBody(req);
      await handleMessage(body, res);
      return;
    }

    // 404
    sendJson(res, 404, { error: "Not Found" } satisfies ErrorResponse);
  }

  // ------ POST /message -----------------------------------------------------

  async function handleMessage(rawBody: string, res: ServerResponse): Promise<void> {
    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, {
        error: "Bad Request",
        details: "Invalid JSON body",
      } satisfies ErrorResponse);
      return;
    }

    // Validate
    const result = validateMessageRequest(parsed);
    if (!result.ok) {
      sendJson(res, 400, {
        error: result.error,
        details: result.details,
      } satisfies ErrorResponse);
      return;
    }

    const msg = result.data;

    // Check account
    const accountCfg = config.accounts?.[msg.accountId];
    if (!accountCfg) {
      sendJson(res, 403, {
        error: "Forbidden",
        details: `Account "${msg.accountId}" is not configured`,
      } satisfies ErrorResponse);
      return;
    }
    if (accountCfg.enabled === false) {
      sendJson(res, 403, {
        error: "Forbidden",
        details: `Account "${msg.accountId}" is disabled`,
      } satisfies ErrorResponse);
      return;
    }

    // Poll mode — not implemented in v1
    if (msg.responseMode === "poll") {
      sendJson(res, 501, {
        error: "Not Implemented",
        details: 'responseMode "poll" is not supported in v1',
      } satisfies ErrorResponse);
      return;
    }

    // Dispatch to gateway via runtime API
    const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Build the dispatch function (not yet called)
    function startDispatch() {
      // Load current config at dispatch time (not stale from startup)
      const cfg = runtime.config.loadConfig();

      const route = runtime.channel.routing.resolveAgentRoute({
        cfg,
        channel: CHANNEL_ID,
        accountId: msg.accountId,
        peer: { kind: "direct", id: msg.peer },
      });

      const ctx = runtime.channel.reply.finalizeInboundContext({
        Body: msg.payload,
        RawBody: msg.payload,
        CommandBody: msg.payload,
        From: msg.peer,
        To: msg.accountId,
        SessionKey: route.sessionKey,
        AccountId: msg.accountId,
        ChatType: "direct",
        Provider: CHANNEL_ID,
        Surface: CHANNEL_ID,
        OriginatingChannel: CHANNEL_ID,
        CommandAuthorized: false,
      });

      return runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx,
        cfg,
        dispatcherOptions: {
          deliver: async (payload: any, info: any) => {
            if (info.kind !== "final") return;
            bridge.resolveResponse(msg.accountId, msg.peer, payload.text ?? "");
          },
          onError: (err: any) => {
            api.logger.error("Dispatch reply error", err);
          },
        },
        replyOptions: {
          disableBlockStreaming: true,
        },
      });
    }

    // Fire-and-forget — dispatch async, return immediately
    if (!msg.responseMode || msg.responseMode === "fire-and-forget") {
      startDispatch().catch((err: any) => {
        api.logger.error(`Dispatch error: ${err?.message ?? err}`);
      });
      sendJson(res, 202, {
        messageId,
        status: "accepted",
      } satisfies MessageAcceptedResponse);
      return;
    }

    // Wait-for-response — register waiter BEFORE dispatching
    const responsePromise = bridge.waitForResponse(
      messageId,
      msg.accountId,
      msg.peer,
      responseTimeout,
    );

    // Start dispatch (don't await — the deliver callback resolves the bridge)
    startDispatch().catch((err: any) => {
      api.logger.error(`Dispatch error: ${err?.message ?? err}`);
    });

    try {
      const responseText = await responsePromise;
      sendJson(res, 200, {
        messageId,
        status: "completed",
        response: responseText,
      } satisfies MessageCompletedResponse);
    } catch {
      const timeoutSec = Math.floor(responseTimeout / 1000);
      sendJson(res, 202, {
        messageId,
        status: "timeout",
        message: `Agent did not respond within ${timeoutSec} seconds. The request is still being processed.`,
      } satisfies MessageTimeoutResponse);
    }
  }

  // ------ Auth --------------------------------------------------------------

  function authenticate(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!header) {
      api.logger.debug("Auth failed: no Authorization header");
      return false;
    }
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      api.logger.debug("Auth failed: Authorization header is not Bearer format");
      return false;
    }
    if (match[1] !== token) {
      api.logger.debug("Auth failed: token mismatch");
      return false;
    }
    return true;
  }

  // ------ Helpers -----------------------------------------------------------

  function corsHeaders(): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }

  return server;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024; // 1 MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
