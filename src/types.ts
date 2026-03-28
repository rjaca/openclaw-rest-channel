// ---------------------------------------------------------------------------
// OpenClaw Plugin SDK types (stub)
//
// These mirror the subset of the SDK we use. When the real
// `openclaw/plugin-sdk` package is available, swap the import and remove
// this section.
// ---------------------------------------------------------------------------

export interface OpenClawLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface SendTextArgs {
  text: string;
  ctx: OutboundContext;
}

export interface OutboundContext {
  channel: string;
  accountId: string;
  peer: string;
  /** Opaque metadata attached by the gateway — may include inReplyTo, etc. */
  [key: string]: unknown;
}

export interface ChannelPlugin {
  id: string;
  meta: {
    id: string;
    label: string;
    blurb: string;
    aliases?: string[];
    selectionLabel?: string;
    docsPath?: string;
    detailLabel?: string;
    systemImage?: string;
    preferOver?: string[];
  };
  capabilities: {
    chatTypes: ("direct" | "group" | "channel")[];
  };
  config: {
    listAccountIds: (cfg: ChannelConfig) => string[];
    resolveAccount: (
      cfg: ChannelConfig,
      accountId: string,
    ) => AccountConfig | undefined;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (args: SendTextArgs) => Promise<{ ok: boolean }>;
  };
}

export interface OpenClawPluginServiceContext {
  config: Record<string, unknown>;
  workspaceDir?: string;
  stateDir: string;
  logger: OpenClawLogger;
}

export interface OpenClawPluginApi {
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  runtime: Record<string, any>;
  logger: OpenClawLogger;
  registerChannel(opts: { plugin: ChannelPlugin }): void;
  registerService(opts: {
    id: string;
    start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
    stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  }): void;
}

// ---------------------------------------------------------------------------
// Channel configuration
// ---------------------------------------------------------------------------

export interface AccountConfig {
  enabled?: boolean;
}

export interface ChannelConfig {
  port?: number;
  token: string;
  responseTimeout?: number;
  accounts?: Record<string, AccountConfig>;
}

// ---------------------------------------------------------------------------
// REST API types
// ---------------------------------------------------------------------------

export type ResponseMode = "fire-and-forget" | "wait-for-response" | "poll";

export interface MessageRequest {
  accountId: string;
  peer: string;
  type: string;
  payload: string;
  timestamp?: string;
  responseMode?: ResponseMode;
}

export interface MessageAcceptedResponse {
  messageId: string;
  status: "accepted";
}

export interface MessageCompletedResponse {
  messageId: string;
  status: "completed";
  response: string;
}

export interface MessageTimeoutResponse {
  messageId: string;
  status: "timeout";
  message: string;
}

export interface HealthResponse {
  status: "ok";
  channel: "rest-channel";
  uptime: number;
}

export interface ErrorResponse {
  error: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Internal: pending response tracking for wait-for-response mode
// ---------------------------------------------------------------------------

export interface PendingResponse {
  messageId: string;
  resolve: (text: string) => void;
  timer: ReturnType<typeof setTimeout>;
}
