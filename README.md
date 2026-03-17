# REST Channel for OpenClaw

A generic REST API channel plugin for [OpenClaw](https://openclaw.ai) that enables external devices and services to send messages into the agent via HTTP.

Ideal for IoT devices, voice satellites, custom UIs, and any system that can make HTTP requests.

## Features

- Bearer token authentication
- Two response modes:
  - **fire-and-forget** — returns immediately with `202 Accepted`
  - **wait-for-response** — holds the connection until the agent replies (or times out)
- Multi-account support
- CORS enabled
- Health check endpoint

## Requirements

- OpenClaw >= 1.0.0
- Node.js >= 18

## Installation

### From a local folder

Clone this repository into your machine:

```bash
git clone https://github.com/rjaca/openclaw-rest-channel.git
```

Then install it as a local plugin:

```bash
openclaw plugin install ./openclaw-rest-channel
```

### From npm (when published)

```bash
openclaw plugin install rest-channel
```

## Configuration

Add the plugin configuration to your `~/.openclaw/openclaw.json` under `plugins.entries`:

```json
{
  "plugins": {
    "entries": {
      "rest-channel": {
        "enabled": true,
        "config": {
          "token": "your-secret-token-here",
          "port": 7800,
          "responseTimeout": 60,
          "accounts": {
            "voice-satellite": {},
            "my-app": {}
          }
        }
      }
    }
  }
}
```

### Configuration options

| Option | Type | Default | Required | Description |
|--------|------|---------|----------|-------------|
| `token` | string | — | Yes | Bearer token for authenticating HTTP requests |
| `port` | number | `7800` | No | Port the REST server listens on |
| `responseTimeout` | number | `60` | No | Seconds to wait before timing out a wait-for-response request |
| `accounts` | object | — | No | Map of account IDs. Each key is an account name; set `{ "enabled": false }` to disable one |

## Usage

### Health check

```bash
curl http://localhost:7800/health
```

```json
{ "status": "ok", "channel": "rest-channel", "uptime": 123 }
```

### Send a message (fire-and-forget)

```bash
curl -X POST http://localhost:7800/message \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "voice-satellite",
    "peer": "kitchen",
    "type": "text",
    "payload": "Turn on the lights"
  }'
```

```json
{ "messageId": "msg_abc123", "status": "accepted" }
```

### Send a message (wait-for-response)

```bash
curl -X POST http://localhost:7800/message \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "voice-satellite",
    "peer": "kitchen",
    "type": "text",
    "payload": "What is the weather today?",
    "responseMode": "wait-for-response"
  }'
```

```json
{ "messageId": "msg_abc123", "status": "completed", "response": "It's 72F and sunny today." }
```

If the agent doesn't respond within the timeout:

```json
{ "messageId": "msg_abc123", "status": "timeout", "message": "Agent did not respond within 60 seconds. The request is still being processed." }
```

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountId` | string | Yes | Must match a configured account |
| `peer` | string | Yes | Identifier for the sender/device (e.g. `"kitchen"`, `"user-123"`) |
| `type` | string | Yes | Message type (e.g. `"text"`) |
| `payload` | string | Yes | The message content |
| `timestamp` | string | No | ISO 8601 timestamp |
| `responseMode` | string | No | `"fire-and-forget"` (default) or `"wait-for-response"` |

### Error responses

| Status | Meaning |
|--------|---------|
| `400` | Invalid JSON or missing required fields |
| `401` | Missing or invalid bearer token |
| `403` | Account not configured or disabled |
| `404` | Unknown endpoint |
| `500` | Internal server error |
| `501` | Unsupported feature (e.g. `responseMode: "poll"`) |

## Development

```bash
npm install
npm test
```

## License

MIT
