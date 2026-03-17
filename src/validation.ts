import type { MessageRequest, ResponseMode } from "./types.js";

const VALID_TYPES = new Set(["text"]);
const VALID_RESPONSE_MODES = new Set<ResponseMode>([
  "fire-and-forget",
  "wait-for-response",
  "poll",
]);

export interface ValidationResult {
  ok: true;
  data: MessageRequest;
}

export interface ValidationError {
  ok: false;
  error: string;
  details: string;
}

export function validateMessageRequest(
  body: unknown,
): ValidationResult | ValidationError {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      error: "Bad Request",
      details: "Request body must be a JSON object",
    };
  }

  const obj = body as Record<string, unknown>;

  // Required fields
  if (typeof obj.accountId !== "string" || obj.accountId.length === 0) {
    return {
      ok: false,
      error: "Bad Request",
      details: "Missing or invalid required field: accountId",
    };
  }

  if (typeof obj.peer !== "string" || obj.peer.length === 0) {
    return {
      ok: false,
      error: "Bad Request",
      details: "Missing or invalid required field: peer",
    };
  }

  if (typeof obj.type !== "string" || !VALID_TYPES.has(obj.type)) {
    return {
      ok: false,
      error: "Bad Request",
      details: `Missing or invalid required field: type (must be one of: ${[...VALID_TYPES].join(", ")})`,
    };
  }

  if (typeof obj.payload !== "string" || obj.payload.length === 0) {
    return {
      ok: false,
      error: "Bad Request",
      details: "Missing or invalid required field: payload",
    };
  }

  // Optional: timestamp
  if (obj.timestamp !== undefined) {
    if (typeof obj.timestamp !== "string") {
      return {
        ok: false,
        error: "Bad Request",
        details: "Field timestamp must be an ISO 8601 string",
      };
    }
    const parsed = Date.parse(obj.timestamp);
    if (Number.isNaN(parsed)) {
      return {
        ok: false,
        error: "Bad Request",
        details: "Field timestamp is not a valid ISO 8601 date",
      };
    }
  }

  // Optional: responseMode
  const responseMode = (obj.responseMode ?? "fire-and-forget") as ResponseMode;
  if (!VALID_RESPONSE_MODES.has(responseMode)) {
    return {
      ok: false,
      error: "Bad Request",
      details: `Invalid responseMode (must be one of: ${[...VALID_RESPONSE_MODES].join(", ")})`,
    };
  }

  return {
    ok: true,
    data: {
      accountId: obj.accountId as string,
      peer: obj.peer as string,
      type: obj.type as string,
      payload: obj.payload as string,
      timestamp: obj.timestamp as string | undefined,
      responseMode,
    },
  };
}
