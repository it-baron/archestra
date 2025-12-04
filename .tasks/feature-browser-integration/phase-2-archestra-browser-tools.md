# Phase 2: Archestra Browser Tools

**Priority**: Critical
**Dependencies**: Phase 1
**Complexity**: Medium

---

## Objective

Add built-in browser tools to `archestra-mcp-server.ts` that proxy to the browser pod. These tools are automatically available to all profiles and bypass tool invocation policies (as they are Archestra built-in tools).

---

## Deliverables

- [ ] 2.1 - Extend SessionData with browser state
- [ ] 2.2 - Implement browser tool handlers
- [ ] 2.3 - Add browser pod lifecycle management
- [ ] 2.4 - Write tests

---

## Task 2.1: Extend SessionData

Extend the `SessionData` interface in MCP Gateway to include browser state.

### Files to Modify

- `backend/src/routes/mcp-gateway.ts`

### Changes

```typescript
// backend/src/routes/mcp-gateway.ts

interface BrowserState {
  mcpServerId: string;      // ID of browser MCP server pod
  sessionId: string;        // Playwright session ID
  currentUrl?: string;      // Current page URL
  lastScreenshot?: string;  // Base64 screenshot for UI
  createdAt: Date;          // Session creation time
}

interface SessionData {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastAccess: number;
  agentId: string;
  agent?: { id: string; name: string };
  // NEW: Browser state
  browserState?: BrowserState;
}
```

### Browser State Lifecycle

1. **Creation**: When `archestra__browser_open` is called
2. **Update**: After each browser action (URL, screenshot)
3. **Cleanup**: When session expires or `archestra__browser_close` is called

### Acceptance Criteria

- [ ] SessionData type includes browserState
- [ ] Browser state persists across tool calls in same session
- [ ] Browser state cleaned up on session expiry

---

## Task 2.2: Implement Browser Tool Handlers

Add browser tools to the Archestra MCP server.

### Files to Modify

- `backend/src/archestra-mcp-server.ts`

### New Tools

#### archestra__browser_open

```typescript
{
  name: "archestra__browser_open",
  description: "Open a browser session for web browsing. Call this before using other browser tools.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Initial URL to navigate to (optional)"
      }
    }
  }
}
```

#### archestra__browser_navigate

```typescript
{
  name: "archestra__browser_navigate",
  description: "Navigate the browser to a URL",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to navigate to"
      }
    },
    required: ["url"]
  }
}
```

#### archestra__browser_screenshot

```typescript
{
  name: "archestra__browser_screenshot",
  description: "Take a screenshot of the current page. Returns base64-encoded PNG image.",
  inputSchema: {
    type: "object",
    properties: {
      fullPage: {
        type: "boolean",
        default: false,
        description: "Capture full page or viewport only"
      }
    }
  }
}
```

#### archestra__browser_click

```typescript
{
  name: "archestra__browser_click",
  description: "Click on an element by coordinates or CSS selector",
  inputSchema: {
    type: "object",
    properties: {
      x: {
        type: "number",
        description: "X coordinate (from screenshot)"
      },
      y: {
        type: "number",
        description: "Y coordinate (from screenshot)"
      },
      selector: {
        type: "string",
        description: "CSS selector (alternative to coordinates)"
      }
    }
  }
}
```

#### archestra__browser_type

```typescript
{
  name: "archestra__browser_type",
  description: "Type text into a form field",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector for input field"
      },
      text: {
        type: "string",
        description: "Text to type"
      },
      clear: {
        type: "boolean",
        default: true,
        description: "Clear field before typing"
      }
    },
    required: ["selector", "text"]
  }
}
```

#### archestra__browser_get_content

```typescript
{
  name: "archestra__browser_get_content",
  description: "Get the page content for analysis. Use 'accessibility' format to find form selectors.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["text", "accessibility", "links"],
        default: "accessibility",
        description: "Output format: text (plain text), accessibility (with form selectors), links (all links)"
      }
    }
  }
}
```

#### archestra__browser_scroll

```typescript
{
  name: "archestra__browser_scroll",
  description: "Scroll the page in a direction",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Scroll direction"
      },
      amount: {
        type: "number",
        default: 500,
        description: "Scroll amount in pixels"
      }
    },
    required: ["direction"]
  }
}
```

#### archestra__browser_close

```typescript
{
  name: "archestra__browser_close",
  description: "Close the browser session and release resources",
  inputSchema: {
    type: "object",
    properties: {}
  }
}
```

### Tool Execution Logic

```typescript
async function executeArchestraBrowserTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ArchestraToolContext
): Promise<CallToolResult> {
  const { profile, session } = context;

  switch (toolName) {
    case "archestra__browser_open": {
      // 1. Find or create browser MCP server for this profile
      const browserServer = await ensureBrowserServerExists(profile.id);

      // 2. Initialize browser session
      const sessionId = `browser-${profile.id}-${Date.now()}`;

      // 3. Store in gateway session
      session.browserState = {
        mcpServerId: browserServer.id,
        sessionId,
        currentUrl: args.url as string | undefined,
        createdAt: new Date()
      };

      // 4. Navigate if URL provided
      if (args.url) {
        await executeBrowserCommand(browserServer.id, "browser_navigate", {
          url: args.url,
          sessionId
        });
      }

      // 5. Take initial screenshot
      const screenshot = await executeBrowserCommand(
        browserServer.id,
        "browser_screenshot",
        { sessionId }
      );

      session.browserState.lastScreenshot = screenshot.image;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "opened",
            sessionId,
            url: args.url || "about:blank",
            screenshot: screenshot.image
          })
        }],
        isError: false
      };
    }

    case "archestra__browser_navigate": {
      if (!session.browserState) {
        return errorResult("No browser session. Call archestra__browser_open first.");
      }

      await executeBrowserCommand(
        session.browserState.mcpServerId,
        "browser_navigate",
        { url: args.url, sessionId: session.browserState.sessionId }
      );

      session.browserState.currentUrl = args.url as string;

      // Auto-screenshot after navigation
      const screenshot = await executeBrowserCommand(
        session.browserState.mcpServerId,
        "browser_screenshot",
        { sessionId: session.browserState.sessionId }
      );

      session.browserState.lastScreenshot = screenshot.image;

      return successResult({
        status: "navigated",
        url: args.url,
        screenshot: screenshot.image
      });
    }

    // ... similar for other tools
  }
}
```

### Acceptance Criteria

- [ ] All 8 browser tools implemented
- [ ] Tools return proper MCP CallToolResult format
- [ ] Screenshot included in navigate/screenshot responses
- [ ] Error handling for missing browser session

---

## Task 2.3: Browser Pod Lifecycle Management

Manage browser pod lifecycle per profile.

### Files to Create

- `backend/src/browser/browser-server-manager.ts`

### Implementation

```typescript
// backend/src/browser/browser-server-manager.ts

import { McpServerModel } from "@/models/mcp-server";
import { K8sPodManager } from "@/mcp-server-runtime/k8s-pod";

const BROWSER_MCP_CATALOG_NAME = "Archestra Browser";

export async function ensureBrowserServerExists(
  profileId: string
): Promise<{ id: string; status: string }> {
  // Check if browser server already exists for this profile
  const existingServer = await McpServerModel.findByProfileAndName(
    profileId,
    `browser-${profileId}`
  );

  if (existingServer) {
    // Ensure pod is running
    await ensurePodRunning(existingServer.id);
    return { id: existingServer.id, status: "running" };
  }

  // Create new browser MCP server for profile
  const browserServer = await McpServerModel.createFromCatalog({
    name: `browser-${profileId}`,
    catalogName: BROWSER_MCP_CATALOG_NAME,
    profileId,
    isSystemServer: true
  });

  // Start the pod
  await startBrowserPod(browserServer.id);

  return { id: browserServer.id, status: "starting" };
}

async function startBrowserPod(serverId: string): Promise<void> {
  const podManager = new K8sPodManager();
  await podManager.startPod(serverId);
}

async function ensurePodRunning(serverId: string): Promise<void> {
  const podManager = new K8sPodManager();
  const status = await podManager.getPodStatus(serverId);

  if (status !== "Running") {
    await podManager.restartPod(serverId);
  }
}

export async function executeBrowserCommand(
  serverId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const server = await McpServerModel.findById(serverId);

  // Use existing MCP proxy to call browser pod
  const response = await fetch(`http://localhost:9000/mcp_proxy/${serverId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: tool, arguments: args },
      id: Date.now()
    })
  });

  const result = await response.json();
  return result.result;
}
```

### Acceptance Criteria

- [ ] Browser pod created on first browser tool call
- [ ] Pod reused for subsequent calls from same profile
- [ ] Pod restarted if not running
- [ ] Proper error handling for pod failures

---

## Task 2.4: Write Tests

Write tests for browser tools and lifecycle management.

### Unit Tests

```typescript
// backend/src/browser/__tests__/browser-tools.test.ts
import { test, expect } from "@/test";
import { executeArchestraBrowserTool } from "../browser-tools";

test("archestra__browser_open creates session", async ({ makeAgent }) => {
  const agent = await makeAgent();
  const session = { agentId: agent.id };

  const result = await executeArchestraBrowserTool(
    "archestra__browser_open",
    { url: "https://example.com" },
    { profile: agent, session }
  );

  expect(result.isError).toBe(false);
  expect(session.browserState).toBeDefined();
  expect(session.browserState.sessionId).toContain(agent.id);
});

test("archestra__browser_navigate requires session", async ({ makeAgent }) => {
  const agent = await makeAgent();
  const session = { agentId: agent.id };

  const result = await executeArchestraBrowserTool(
    "archestra__browser_navigate",
    { url: "https://example.com" },
    { profile: agent, session }
  );

  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text).error).toContain("No browser session");
});
```

### Integration Tests

```typescript
// backend/src/browser/__tests__/browser-lifecycle.integration.test.ts
import { test, expect } from "@/test";
import { ensureBrowserServerExists } from "../browser-server-manager";

test("creates browser server for profile", async ({ makeAgent }) => {
  const agent = await makeAgent();

  const server = await ensureBrowserServerExists(agent.id);

  expect(server.id).toBeDefined();
  expect(server.status).toBe("starting");
});

test("reuses existing browser server", async ({ makeAgent }) => {
  const agent = await makeAgent();

  const server1 = await ensureBrowserServerExists(agent.id);
  const server2 = await ensureBrowserServerExists(agent.id);

  expect(server1.id).toBe(server2.id);
});
```

### Acceptance Criteria

- [ ] All unit tests pass
- [ ] Integration tests pass with mocked K8s
- [ ] Error cases covered

---

## Technical Notes

### Tool Response Format

All browser tools return JSON in the text content:

```typescript
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "success" | "error",
      // Tool-specific data
      screenshot?: string,  // Base64 PNG
      url?: string,
      title?: string,
      content?: string | object,
      error?: string
    })
  }],
  isError: boolean
}
```

### Auto-Screenshot Behavior

The following tools automatically include a screenshot in the response:
- `archestra__browser_open`
- `archestra__browser_navigate`
- `archestra__browser_click`
- `archestra__browser_scroll`

This allows the agent to see the result of their action.

### Error Handling

```typescript
function errorResult(message: string): CallToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ status: "error", error: message })
    }],
    isError: true
  };
}

function successResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ status: "success", ...data })
    }],
    isError: false
  };
}
```

---

## Definition of Done

- [ ] All tasks completed
- [ ] All tests passing
- [ ] Browser tools visible in Archestra tool list
- [ ] Tools work in chat with profile
- [ ] Code reviewed and approved

---

*Task file for Phase 2 of Browser Integration*
