# Phase 6: Observability

**Priority**: Medium
**Dependencies**: Phase 2
**Complexity**: Low

---

## Objective

Ensure browser actions are properly logged and observable. Integrate with existing MCP tool call logging, distributed tracing, and real-time screenshot display.

---

## Deliverables

- [ ] 6.1 - Browser actions logged via mcp_tool_call
- [ ] 6.2 - Screenshot handling in logs
- [ ] 6.3 - Login attempt logging (secure)
- [ ] 6.4 - Distributed tracing integration
- [ ] 6.5 - Real-time screenshot display

---

## Task 6.1: Browser Actions Logged via mcp_tool_call

Ensure all browser tool calls are logged through the existing `McpToolCallModel`.

### Existing Logging Flow

Browser tools are Archestra built-in tools, so they automatically go through the MCP Gateway logging:

```typescript
// backend/src/routes/mcp-gateway.ts
// Existing logging captures all tool calls including browser tools

await McpToolCallModel.create({
  agentId: session.agentId,
  mcpServerName: "archestra",
  method: "tools/call",
  toolCall: {
    name: toolName,
    arguments: args
  },
  toolResult: result,
  createdAt: new Date()
});
```

### Browser Tool Log Entry Example

```json
{
  "id": "uuid-123",
  "agentId": "profile-456",
  "mcpServerName": "archestra",
  "method": "tools/call",
  "toolCall": {
    "name": "archestra__browser_navigate",
    "arguments": {
      "url": "https://github.com"
    }
  },
  "toolResult": {
    "status": "navigated",
    "url": "https://github.com",
    "title": "GitHub: Let's build from here",
    "screenshot": "[TRUNCATED]"
  },
  "durationMs": 1523,
  "createdAt": "2025-11-29T10:30:00Z"
}
```

### Acceptance Criteria

- [ ] All browser tool calls appear in mcp_tool_call logs
- [ ] Tool arguments captured
- [ ] Tool results captured (with screenshot handling)
- [ ] Duration tracked

---

## Task 6.2: Screenshot Handling in Logs

Handle large screenshot data in logs to prevent storage issues.

### Files to Modify

- `backend/src/models/mcp-tool-call.ts`

### Screenshot Truncation

```typescript
// backend/src/logging/screenshot-handler.ts

const MAX_SCREENSHOT_LOG_SIZE = 1000; // chars
const SCREENSHOT_PLACEHOLDER = "[SCREENSHOT:base64,{size}KB]";

export function truncateScreenshotInResult(result: unknown): unknown {
  if (typeof result !== "object" || result === null) {
    return result;
  }

  const obj = result as Record<string, unknown>;

  // Deep clone and truncate
  const truncated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "screenshot" && typeof value === "string") {
      // Calculate original size
      const sizeKb = Math.round((value.length * 3) / 4 / 1024);
      truncated[key] = SCREENSHOT_PLACEHOLDER.replace("{size}", sizeKb.toString());
    } else if (typeof value === "object") {
      truncated[key] = truncateScreenshotInResult(value);
    } else {
      truncated[key] = value;
    }
  }

  return truncated;
}

// Usage in logging
const logResult = truncateScreenshotInResult(toolResult);
await McpToolCallModel.create({
  // ...
  toolResult: logResult
});
```

### Optional: Screenshot Storage Table

For future replay functionality:

```typescript
// backend/src/database/schemas/browser-screenshot.ts

export const browserScreenshotTable = pgTable("browser_screenshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  mcpToolCallId: uuid("mcp_tool_call_id")
    .references(() => mcpToolCallTable.id, { onDelete: "cascade" }),
  screenshot: text("screenshot"),  // Base64 or blob reference
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
```

**Note**: Screenshot storage is optional for Phase 1. Real-time display is the primary use case.

### Acceptance Criteria

- [ ] Screenshots truncated in mcp_tool_call logs
- [ ] Original size preserved in placeholder
- [ ] Full screenshot available in real-time responses
- [ ] Optional storage table created (not used in Phase 1)

---

## Task 6.3: Login Attempt Logging (Secure)

Log login attempts without exposing credentials.

### Secure Login Logging

```typescript
// backend/src/browser/login-logging.ts

import { logger } from "@/logging";
import { McpToolCallModel } from "@/models/mcp-tool-call";

interface LoginAttempt {
  profileId: string;
  domain: string;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export async function logLoginAttempt(attempt: LoginAttempt): Promise<void> {
  // Log to structured logger
  logger.info({
    event: "browser_login_attempt",
    profileId: attempt.profileId,
    domain: attempt.domain,
    success: attempt.success,
    error: attempt.error
  });

  // The MCP tool call is already logged via mcp_tool_call table
  // This provides additional structured logging for security auditing
}

// Redact sensitive fields from tool arguments
export function redactLoginArguments(
  args: Record<string, unknown>
): Record<string, unknown> {
  return {
    domain: args.domain,
    usernameSelector: args.usernameSelector,
    passwordSelector: args.passwordSelector,
    submitSelector: args.submitSelector
    // Note: No actual credentials are ever in args
    // (they come from secretManager)
  };
}
```

### Log Entry Example (Login)

```json
{
  "id": "uuid-789",
  "agentId": "profile-456",
  "mcpServerName": "archestra",
  "method": "tools/call",
  "toolCall": {
    "name": "archestra__browser_login",
    "arguments": {
      "domain": "github.com",
      "usernameSelector": "#login_field",
      "passwordSelector": "#password",
      "submitSelector": "input[type='submit']"
    }
  },
  "toolResult": {
    "status": "authenticated",
    "domain": "github.com",
    "message": "Login successful",
    "screenshot": "[TRUNCATED]"
  },
  "durationMs": 3245,
  "createdAt": "2025-11-29T10:31:00Z"
}
```

**Security Properties**:
- No username in logs
- No password in logs
- Only domain and selectors logged
- Result shows success/failure only

### Acceptance Criteria

- [ ] Login attempts logged with domain
- [ ] No credentials in any logs
- [ ] Success/failure status logged
- [ ] Structured logging for audit trail

---

## Task 6.4: Distributed Tracing Integration

Integrate browser tools with OpenTelemetry tracing.

### Files to Modify

- `backend/src/archestra-mcp-server.ts`

### Tracing Implementation

```typescript
// backend/src/browser/tracing.ts

import { trace, SpanStatusCode, Span } from "@opentelemetry/api";

const tracer = trace.getTracer("browser-tools");

export async function withBrowserSpan<T>(
  toolName: string,
  profileId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    `browser.${toolName.replace("archestra__browser_", "")}`,
    async (span) => {
      try {
        span.setAttribute("browser.tool", toolName);
        span.setAttribute("agent.id", profileId);

        const result = await fn(span);

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

// Usage in browser tool execution
case "archestra__browser_navigate": {
  return withBrowserSpan(toolName, profile.id, async (span) => {
    span.setAttribute("browser.url", args.url);

    const result = await executeBrowserCommand(...);

    span.setAttribute("browser.page_title", result.title);
    span.setAttribute("browser.duration_ms", result.durationMs);

    return successResult(result);
  });
}
```

### Trace Attributes

| Attribute | Description | Example |
|-----------|-------------|---------|
| `browser.tool` | Tool name | `archestra__browser_navigate` |
| `browser.url` | Target URL | `https://github.com` |
| `browser.page_title` | Page title | `GitHub: Let's build...` |
| `browser.duration_ms` | Operation duration | `1523` |
| `browser.session_id` | Session ID | `browser-profile-123-...` |
| `agent.id` | Profile ID | `profile-123` |

### Acceptance Criteria

- [ ] Browser tool calls create spans
- [ ] Spans include relevant attributes
- [ ] Errors recorded in traces
- [ ] Traces visible in Tempo/Grafana

---

## Task 6.5: Real-time Screenshot Display

Ensure screenshots are available for real-time display without persistence.

### Architecture

```
Browser Tool Execution
         |
         v
    Screenshot captured (base64)
         |
         +---> mcp_tool_call (truncated)
         |
         +---> Tool response (full)
         |
         v
    Frontend renders BrowserPreview
```

### Response Flow

```typescript
// Full screenshot in real-time response
return {
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "navigated",
      url: args.url,
      title: result.title,
      screenshot: result.screenshot  // Full base64 for UI
    })
  }],
  isError: false
};

// Truncated for logging
const logResult = truncateScreenshotInResult(result);
await McpToolCallModel.create({
  toolResult: logResult  // "[SCREENSHOT:base64,450KB]"
});
```

### Frontend Handling

```typescript
// Frontend receives full screenshot in tool result
function handleToolResult(toolName: string, result: unknown) {
  if (isBrowserTool(toolName)) {
    const parsed = JSON.parse(result.content[0].text);

    if (parsed.screenshot) {
      // Display immediately - not stored persistently
      return <BrowserPreview screenshot={parsed.screenshot} />;
    }
  }
}
```

### Acceptance Criteria

- [ ] Full screenshot in real-time response
- [ ] Truncated screenshot in logs
- [ ] BrowserPreview renders immediately
- [ ] No screenshot persistence in Phase 1

---

## Observability Dashboard Queries

### Grafana: Browser Tool Usage

```promql
# Browser tool calls per minute
rate(mcp_tool_calls_total{tool_name=~"archestra__browser_.*"}[1m])

# Browser tool latency
histogram_quantile(0.95,
  rate(mcp_tool_call_duration_seconds_bucket{tool_name=~"archestra__browser_.*"}[5m])
)

# Browser login attempts
sum(rate(mcp_tool_calls_total{tool_name="archestra__browser_login"}[1h])) by (status)
```

### Tempo: Trace Query

```
{resource.service.name="archestra-backend"} | json | browser.tool != ""
```

### Loki: Log Query

```logql
{app="archestra-backend"} |= "archestra__browser" | json
```

---

## Future Enhancement: Session Recording

For future MP4 recording capability:

```typescript
// backend/src/browser/recording.ts

interface RecordingConfig {
  enabled: boolean;
  format: "mp4" | "webm";
  quality: "low" | "medium" | "high";
  maxDurationSeconds: number;
}

// Not implemented in Phase 1
// Placeholder for Phase 7 WebRTC enhancement
```

---

## Definition of Done

- [ ] All tasks completed
- [ ] Browser tools appear in mcp_tool_call logs
- [ ] Screenshots truncated in logs
- [ ] Login logging is secure (no credentials)
- [ ] Traces include browser spans
- [ ] Real-time screenshots work in UI
- [ ] Code reviewed and approved

---

*Task file for Phase 6 of Browser Integration*
