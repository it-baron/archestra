# Phase 1: Browser MCP Server Pod

**Priority**: Critical
**Dependencies**: None
**Complexity**: High
**Status**: In Progress

---

## Objective

Create a browser automation pod that runs as a standard MCP server using Playwright. This pod will be managed by the existing K8s orchestrator and communicate via streamable-http transport.

---

## Task Breakdown

Phase 1 is split into 3 focused tasks:

| Task | Goal | File |
|------|------|------|
| **Task 1** | Add from catalog with security policy dialog | [phase-1-task-1-catalog-install.md](./phase-1-task-1-catalog-install.md) |
| **Task 2** | Delete from private registry | [phase-1-task-2-uninstall.md](./phase-1-task-2-uninstall.md) |
| **Task 3** | Browse to page and see screenshot (chain call) | [phase-1-task-3-browse-screenshot.md](./phase-1-task-3-browse-screenshot.md) |

---

## Key Decisions

1. **Package location**: `platform/browser-mcp-server/` (at platform root level alongside backend/frontend)
2. **Docker strategy**: Use Microsoft's official Playwright image (`mcr.microsoft.com/playwright:v1.50.0-noble`) - no custom Dockerfile needed
3. **E2E testing**: Full K8s integration tests through orchestrator (following `orchestrator.spec.ts` patterns)
4. **Distribution**: Publish `@archestra/browser-mcp-server` to npm for easy installation in the Playwright container
5. **Security**: User-prompted policy configuration dialog on installation (not automatic)

---

## Deliverables Summary

### Task 1: Catalog Install
- [ ] Create `platform/browser-mcp-server/` package
- [ ] Implement MCP server with 7 Playwright tools
- [ ] Add browser MCP to internal catalog via seeding
- [ ] Create security policy configuration dialog
- [ ] Implement policy defaults service
- [ ] Publish to npm

### Task 2: Uninstall
- [ ] Verify uninstall flow works for browser MCP
- [ ] Verify policy cascade cleanup
- [ ] Verify pod termination
- [ ] E2E test for uninstall

### Task 3: Browse + Screenshot Chain
- [ ] Verify navigate → screenshot chain works
- [ ] Verify security policies allow chain calls
- [ ] Verify SSRF protection blocks internal URLs
- [ ] Comprehensive E2E tests

---

## Critical Files to Reference

Before implementation, read these files to understand existing patterns:

| File | Purpose |
|------|---------|
| `platform/backend/src/mcp-server-runtime/k8s-pod.ts` | Pod creation, localConfig usage, transport configuration |
| `platform/backend/src/database/schemas/internal-mcp-catalog.ts` | Catalog schema (transportType, httpPort, httpPath) |
| `platform/e2e-tests/tests/api/orchestrator.spec.ts` | E2E test patterns, waitForMcpServerReady helper |
| `platform/e2e-tests/tests/api/fixtures.ts` | E2E test fixtures (createAgent, createMcpCatalogItem, installMcpServer) |
| `platform/backend/src/clients/mcp-client.ts` | StreamableHTTP transport connection |
| `platform/backend/src/archestra-mcp-server.ts` | Tool definition patterns, CallToolResult structure |
| `platform/backend/src/routes/mcp-gateway.ts` | MCP server setup with StreamableHTTPServerTransport |
| `platform/backend/src/database/seed.ts` | Data seeding patterns (idempotent, uses models) |

---

## Task 1.1: Create Package Structure

Create the `platform/browser-mcp-server/` package with proper TypeScript configuration.

### Files to Create

```
platform/browser-mcp-server/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile              # Extends mcp-server-base with Playwright + Chromium
├── src/
│   ├── server.ts           # Main MCP server entry point (Express + StreamableHTTPServerTransport)
│   ├── browser-manager.ts  # Playwright browser lifecycle (session management, 30-min TTL)
│   ├── tools/
│   │   ├── index.ts        # Tool registration following MCP SDK patterns
│   │   ├── navigate.ts
│   │   ├── screenshot.ts
│   │   ├── click.ts
│   │   ├── type.ts
│   │   ├── get-content.ts
│   │   ├── scroll.ts
│   │   └── fill-and-submit.ts
│   └── types.ts
└── README.md
```

### package.json

```json
{
  "name": "@archestra/browser-mcp-server",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/server.js",
    "test": "vitest",
    "lint": "biome check",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.22.0",
    "playwright": "^1.40.0",
    "express": "^4.18.0",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "@types/express": "^4.17.21",
    "typescript": "^5.9.2",
    "vitest": "^4.0.10"
  }
}
```

### Modify pnpm-workspace.yaml

Add to `platform/pnpm-workspace.yaml`:
```yaml
packages:
  - "backend"
  - "frontend"
  - "shared"
  - "e2e-tests"
  - "browser-mcp-server"  # NEW
```

### Acceptance Criteria

- [ ] Package builds successfully with `pnpm build`
- [ ] TypeScript configuration matches platform standards (ES2022, NodeNext modules)
- [ ] All dependencies use Apache-2.0 compatible licenses
- [ ] Added to pnpm workspaces

---

## Task 1.2: Implement MCP Server

Implement the MCP server with Playwright browser management following existing patterns from `mcp-gateway.ts`.

### src/server.ts

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { BrowserManager } from "./browser-manager.js";
import { TOOLS, executeToolCall } from "./tools/index.js";

const PORT = parseInt(process.env.MCP_HTTP_PORT || "8080");
const PATH = process.env.MCP_HTTP_PATH || "/mcp";

const browserManager = new BrowserManager();

// MCP Server setup following mcp-gateway.ts patterns
const server = new Server(
  { name: "browser-mcp-server", version: "0.0.1" },
  { capabilities: { tools: { listChanged: false } } }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
  return executeToolCall(browserManager, name, args ?? {});
});

const app = express();

// Health check endpoint for K8s probes
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// MCP endpoint
app.post(PATH, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await transport.handleRequest(req, res, server);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.info("Received SIGTERM, closing all browser sessions...");
  await browserManager.closeAllSessions();
  process.exit(0);
});

app.listen(PORT, () => {
  console.info(`Browser MCP server listening on port ${PORT}${PATH}`);
});
```

### src/browser-manager.ts

```typescript
import { chromium, Browser, BrowserContext, Page } from "playwright";

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
  createdAt: Date;
  cleanupTimer: NodeJS.Timeout;
}

export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

  async getOrCreateSession(sessionId: string): Promise<BrowserSession> {
    let session = this.sessions.get(sessionId);

    if (session) {
      // Reset cleanup timer on access
      this.resetCleanupTimer(session);
      return session;
    }

    // Chromium args for containerized environment (from task spec)
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: "Mozilla/5.0 (compatible; Archestra Browser)"
    });

    const page = await context.newPage();

    const cleanupTimer = this.scheduleCleanup(sessionId);

    session = {
      browser,
      context,
      page,
      sessionId,
      createdAt: new Date(),
      cleanupTimer
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      clearTimeout(session.cleanupTimer);
      await session.browser.close();
      this.sessions.delete(sessionId);
    }
  }

  async closeAllSessions(): Promise<void> {
    const promises = Array.from(this.sessions.keys()).map(id => this.closeSession(id));
    await Promise.all(promises);
  }

  private scheduleCleanup(sessionId: string): NodeJS.Timeout {
    return setTimeout(async () => {
      console.info(`Session ${sessionId} expired, closing...`);
      await this.closeSession(sessionId);
    }, this.SESSION_TTL_MS);
  }

  private resetCleanupTimer(session: BrowserSession): void {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = this.scheduleCleanup(session.sessionId);
  }
}
```

### Tools to Implement

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `browser_navigate` | Navigate to URL | `{ url, sessionId }` | `{ url, title }` |
| `browser_screenshot` | Take screenshot | `{ sessionId, fullPage? }` | `{ image: base64 }` |
| `browser_click` | Click element | `{ sessionId, x?, y?, selector? }` | `{ success, url }` |
| `browser_type` | Type text | `{ sessionId, selector, text }` | `{ success }` |
| `browser_get_content` | Get page content | `{ sessionId, format }` | Format-specific content |
| `browser_scroll` | Scroll page | `{ sessionId, direction, amount }` | `{ scrollY }` |
| `browser_fill_and_submit` | Fill form and submit | `{ sessionId, fields, submitSelector }` | `{ success, url }` |

### Tool Implementation Pattern (following archestra-mcp-server.ts)

```typescript
// src/tools/index.ts
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BrowserManager } from "../browser-manager.js";

export const TOOLS: Tool[] = [
  {
    name: "browser_navigate",
    description: "Navigate to a URL in the browser",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Browser session ID" },
        url: { type: "string", description: "URL to navigate to" }
      },
      required: ["sessionId", "url"]
    }
  },
  // ... other tools
];

export async function executeToolCall(
  browserManager: BrowserManager,
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    // Tool dispatch logic
    switch (toolName) {
      case "browser_navigate":
        return await executeNavigate(browserManager, args);
      // ... other tools
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}
```

### Acceptance Criteria

- [ ] MCP server starts and responds to `/health` endpoint
- [ ] All 7 tools registered and return valid MCP `CallToolResult` responses
- [ ] Sessions auto-expire after 30 minutes of inactivity
- [ ] Screenshots returned as base64 PNG in `content[0].text`
- [ ] Graceful shutdown closes all browser sessions

---

## ~~Task 1.3: Create Dockerfile~~ - REMOVED

**Status:** REMOVED - Using Microsoft's official Playwright image instead.

See [Decision #1](#1-docker-image---decided) for details.

**K8s Resource Limits** (still applicable):

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

---

## Task 1.4: Add Internal MCP Catalog Entry

Add the browser MCP server to the internal catalog via seeding (not SQL migration).

**Important**: This project uses Drizzle-kit for schema migrations (`pnpm db:generate`) and TypeScript seeding in `backend/src/database/seed.ts` for data. Data should be added via seeding functions, not SQL INSERT migrations.

### Catalog Entry Structure

Based on `internal-mcp-catalog.ts` schema, the entry uses Microsoft's official Playwright image:

```typescript
{
  name: "Archestra Browser",
  version: "0.0.1",
  description: "Browse the web with AI assistance. Provides screenshot-based browser automation using Playwright.",
  serverType: "local",
  localConfig: {
    dockerImage: "mcr.microsoft.com/playwright:v1.50.0-noble",
    command: "npx",
    arguments: ["@archestra/browser-mcp-server"],
    environment: [
      { key: "MCP_HTTP_PORT", type: "plain_text", value: "8080", promptOnInstallation: false },
      { key: "MCP_HTTP_PATH", type: "plain_text", value: "/mcp", promptOnInstallation: false }
    ],
    transportType: "streamable-http",
    httpPort: 8080,
    httpPath: "/mcp"
  }
}
```

### Files to Modify

**Modify `backend/src/database/seed.ts`** - Add seeding function:

```typescript
import { InternalMcpCatalogModel } from "@/models";

/**
 * Seeds Archestra Browser MCP server to internal catalog
 */
async function seedBrowserMcpCatalog(): Promise<void> {
  const existingEntry = await InternalMcpCatalogModel.findByName("Archestra Browser");

  if (!existingEntry) {
    await InternalMcpCatalogModel.create({
      name: "Archestra Browser",
      version: "0.0.1",
      description: "Browse the web with AI assistance. Provides screenshot-based browser automation using Playwright.",
      serverType: "local",
      localConfig: {
        dockerImage: "mcr.microsoft.com/playwright:v1.50.0-noble",
        command: "npx",
        arguments: ["@archestra/browser-mcp-server"],
        environment: [
          { key: "MCP_HTTP_PORT", type: "plain_text", value: "8080", promptOnInstallation: false },
          { key: "MCP_HTTP_PATH", type: "plain_text", value: "/mcp", promptOnInstallation: false }
        ],
        transportType: "streamable-http",
        httpPort: 8080,
        httpPath: "/mcp"
      }
    });
    logger.info("✓ Seeded Archestra Browser MCP catalog entry");
  } else {
    logger.info("✓ Archestra Browser MCP catalog entry already exists, skipping");
  }
}

// Add to seedRequiredStartingData():
export async function seedRequiredStartingData(): Promise<void> {
  // ... existing seeds ...
  await seedBrowserMcpCatalog();  // ADD THIS
}
```

### Acceptance Criteria

- [ ] Browser MCP appears in internal catalog after seeding
- [ ] Can be installed via catalog UI
- [ ] Pod starts using `ghcr.io/archestra-ai/browser-mcp-server` image
- [ ] Pod starts in < 10 seconds (pre-built image)
- [ ] Tools are discoverable after installation

---

## Task 1.5: Write E2E Tests

Write E2E tests following the existing `orchestrator.spec.ts` patterns. Tests run through the full K8s orchestrator.

**Important**: Tool execution MUST go through the MCP Gateway (`POST /v1/mcp`) using JSON-RPC protocol with `Bearer ${agentId}` authentication. This is the standard pattern for all MCP tool execution in Archestra.

### E2E Test File

Create `platform/e2e-tests/tests/api/browser-mcp.spec.ts`:

```typescript
import { expect, test } from "./fixtures";
import type { APIRequestContext } from "@playwright/test";
import type { TestFixtures } from "./fixtures";
import { MCP_GATEWAY_URL_SUFFIX } from "../../consts";

// Standard timeout - pre-built image means fast startup
const BROWSER_SERVER_READY_RETRIES = 30; // ~1 minute for pod startup

test.describe("Browser MCP Server", () => {
  let agentId: string;
  let catalogId: string;
  let serverId: string;

  // Helper: Wait for MCP server to be ready
  const waitForMcpServerReady = async (
    request: APIRequestContext,
    makeApiRequest: TestFixtures["makeApiRequest"],
    serverId: string,
    maxRetries = BROWSER_SERVER_READY_RETRIES
  ) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const statusResponse = await makeApiRequest({
        request,
        method: "get",
        urlSuffix: `/api/mcp_server/${serverId}/installation-status`,
      });

      expect(statusResponse.status()).toBe(200);
      const status = await statusResponse.json();

      if (status.localInstallationStatus === "success") {
        return;
      }

      if (status.localInstallationStatus === "error") {
        throw new Error(
          `MCP server installation failed: ${status.localInstallationError}`
        );
      }

      // Still pending/discovering-tools, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(
      `MCP server installation did not complete after ${maxRetries} attempts`
    );
  };

  // Helper: Get server tools
  const getMcpServerTools = async (
    request: APIRequestContext,
    makeApiRequest: TestFixtures["makeApiRequest"],
    serverId: string
  ) => {
    const toolsResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/mcp_server/${serverId}/tools`,
    });

    expect(toolsResponse.status()).toBe(200);
    const tools = await toolsResponse.json();
    expect(Array.isArray(tools)).toBe(true);

    return tools;
  };

  // Helper: Execute tool via MCP Gateway (JSON-RPC protocol)
  const executeToolViaMcpGateway = async (
    request: APIRequestContext,
    baseUrl: string,
    agentId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ) => {
    const response = await request.post(`${baseUrl}${MCP_GATEWAY_URL_SUFFIX}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentId}`,
      },
      data: {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs,
        },
      },
    });

    expect(response.status()).toBe(200);
    const result = await response.json();

    // JSON-RPC response structure
    if (result.error) {
      throw new Error(`MCP Gateway error: ${result.error.message}`);
    }

    return result.result;
  };

  test.beforeAll(async ({
    request,
    createAgent,
    createMcpCatalogItem,
    installMcpServer,
    makeApiRequest,
    baseUrl
  }) => {
    // 1. Create test agent (createAgent takes just a name string)
    const agentResponse = await createAgent(request, "browser-test-agent");
    const agent = await agentResponse.json();
    agentId = agent.id;

    // 2. Create catalog entry using Microsoft Playwright image
    const catalogResponse = await createMcpCatalogItem(request, {
      name: "Archestra Browser Test",
      description: "Test browser MCP server",
      serverType: "local",
      localConfig: {
        dockerImage: "mcr.microsoft.com/playwright:v1.50.0-noble",
        command: "npx",
        arguments: ["@archestra/browser-mcp-server"],
        transportType: "streamable-http",
        httpPort: 8080,
        httpPath: "/mcp"
      }
    });
    const catalog = await catalogResponse.json();
    catalogId = catalog.id;

    // 3. Install MCP server with agent assignment
    const installResponse = await installMcpServer(request, {
      name: "browser-test-server",
      catalogId: catalogId,
      agentIds: [agentId]  // Assign to agent during installation
    });
    const server = await installResponse.json();
    serverId = server.id;

    // 4. Wait for ready
    await waitForMcpServerReady(request, makeApiRequest, serverId);

    // 5. Tools are now assigned to agent via agentIds in step 3
  });

  test.afterAll(async ({ request, deleteAgent, deleteMcpCatalogItem, uninstallMcpServer }) => {
    // Clean up in reverse order
    if (serverId) await uninstallMcpServer(request, serverId);
    if (catalogId) await deleteMcpCatalogItem(request, catalogId);
    if (agentId) await deleteAgent(request, agentId);
  });

  test("should discover browser tools after installation", async ({ request, makeApiRequest }) => {
    const tools = await getMcpServerTools(request, makeApiRequest, serverId);

    // Should have discovered tools from the browser server
    expect(tools.length).toBeGreaterThanOrEqual(7);

    const toolNames = tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("browser_navigate");
    expect(toolNames).toContain("browser_screenshot");
    expect(toolNames).toContain("browser_click");
    expect(toolNames).toContain("browser_type");
    expect(toolNames).toContain("browser_get_content");
    expect(toolNames).toContain("browser_scroll");
    expect(toolNames).toContain("browser_fill_and_submit");
  });

  test("should navigate to URL via MCP Gateway", async ({ request, baseUrl }) => {
    const result = await executeToolViaMcpGateway(
      request,
      baseUrl,
      agentId,
      "browser_navigate",
      {
        sessionId: "test-session-1",
        url: "https://example.com"
      }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toContain("example.com");
  });

  test("should take screenshot via MCP Gateway", async ({ request, baseUrl }) => {
    const result = await executeToolViaMcpGateway(
      request,
      baseUrl,
      agentId,
      "browser_screenshot",
      {
        sessionId: "test-session-1"
      }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();

    // Verify base64 image is returned
    const content = JSON.parse(result.content[0].text);
    expect(content.image).toBeDefined();
    expect(content.image.length).toBeGreaterThan(1000); // Base64 screenshot should be substantial
  });

  test("should get page content via MCP Gateway", async ({ request, baseUrl }) => {
    const result = await executeToolViaMcpGateway(
      request,
      baseUrl,
      agentId,
      "browser_get_content",
      {
        sessionId: "test-session-1",
        format: "accessibility"
      }
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toContain("Example Domain");
  });
});
```

### Test Fixtures Required

The test uses **existing** fixtures from `e2e-tests/tests/api/fixtures.ts` (no new fixtures needed):
- `createAgent(request, name: string)` / `deleteAgent(request, agentId)`
- `createMcpCatalogItem(request, catalogItem)` / `deleteMcpCatalogItem(request, catalogId)`
- `installMcpServer(request, serverData)` / `uninstallMcpServer(request, serverId)`
- `makeApiRequest({ request, method, urlSuffix, data?, ignoreStatusCheck? })`
- `baseUrl` - The base URL for API requests

**Note**: These fixtures already exist and are used by `orchestrator.spec.ts`. Import them with:
```typescript
import { expect, test } from "./fixtures";
```

### MCP Gateway Tool Execution Pattern

Tool execution flows through the MCP Gateway, NOT direct API endpoints:

```
POST /v1/mcp
Authorization: Bearer ${agentId}
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "browser_navigate",
    "arguments": { "sessionId": "...", "url": "..." }
  }
}
```

This ensures:
- Tool invocation policies are enforced
- Trusted data policies are applied
- Response modifiers work correctly
- All tool calls are logged and traced

### Acceptance Criteria

- [ ] E2E tests pass in CI with Kind cluster
- [ ] All 7 browser tools are discoverable
- [ ] Tool execution uses MCP Gateway (`POST /v1/mcp`) with JSON-RPC protocol
- [ ] Navigate, screenshot, and get_content tools execute successfully
- [ ] Test handles pod startup with pre-built Docker image

---

## Task 1.6: Security Policy Configuration Dialog

When the Browser MCP server is installed, prompt the user to optionally configure recommended security policies.

**Note:** This pattern can be reused for other MCP servers that require chained tool calls.

### User Flow

```
1. User clicks "Install" on Browser MCP in catalog
2. Installation completes (tools assigned to profile)
3. Dialog appears: "Configure Security Policies?"
4. User chooses [Skip] or [Accept & Configure]
5. If Accept: policies created for browser tools
6. If Skip: no policies, user configures manually later
```

### Frontend: Policy Configuration Dialog

Create `frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx`:

```typescript
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PolicyConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcpServerName: string;
  mcpServerId: string;
  onAccept: () => void;
  onSkip: () => void;
}

export function PolicyConfigDialog({
  open,
  onOpenChange,
  mcpServerName,
  onAccept,
  onSkip,
}: PolicyConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Security Policies</DialogTitle>
          <DialogDescription>
            {mcpServerName} works by chaining multiple tool calls
            (navigate → screenshot → click → type, etc.)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            By default, Archestra blocks tool chains when external data
            is present in context. We can pre-configure policies for you
            to enable chaining while maintaining security:
          </p>
          <ul className="list-disc list-inside text-sm space-y-1">
            <li>Allow browser tools to chain within a session</li>
            <li>Block access to internal networks (SSRF protection)</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            You can always modify these policies later in the Tools page.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={onAccept}>
            Accept & Configure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Backend: Policy Defaults API

Create `backend/src/services/policy-defaults.ts`:

```typescript
import { ToolInvocationPolicyModel } from "@/models";
import type { Tool, AgentTool } from "@/types";
import { logger } from "@/logging";

interface PolicyDefault {
  argumentName: string;
  operator: "regex" | "contains" | "startsWith" | "equal";
  value: string;
  action: "allow_when_context_is_untrusted" | "block_always";
  reason: string;
}

// Default policies for browser tools
const BROWSER_TOOL_POLICIES: Record<string, PolicyDefault[]> = {
  // Apply to ALL browser tools - session allowlist
  "*": [
    {
      argumentName: "sessionId",
      operator: "regex",
      value: "^browser-[a-f0-9-]+-[0-9]+$",
      action: "allow_when_context_is_untrusted",
      reason: "Allow browser tools with valid session format",
    },
  ],
  // Apply only to browser_navigate - SSRF protection
  "browser_navigate": [
    {
      argumentName: "url",
      operator: "regex",
      value: "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0|169\\.254\\.|metadata\\.google|metadata\\.aws)",
      action: "block_always",
      reason: "Block internal network and cloud metadata access (SSRF protection)",
    },
  ],
};

/**
 * Create default security policies for browser MCP tools
 * Called when user accepts the policy configuration dialog
 */
export async function createBrowserDefaultPolicies(
  agentTools: AgentTool[],
  tools: Tool[]
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const agentTool of agentTools) {
    const tool = tools.find((t) => t.id === agentTool.toolId);
    if (!tool) continue;

    const toolName = tool.name.replace("archestra_browser__", "");
    const policies = [
      ...(BROWSER_TOOL_POLICIES["*"] || []),
      ...(BROWSER_TOOL_POLICIES[toolName] || []),
    ];

    for (const policy of policies) {
      try {
        await ToolInvocationPolicyModel.create({
          agentToolId: agentTool.id,
          ...policy,
        });
        created++;
        logger.info({ toolName: tool.name }, "Created browser security policy");
      } catch {
        skipped++;
      }
    }
  }

  return { created, skipped };
}

/**
 * Check if MCP server needs chained-action policy configuration
 */
export function needsPolicyConfigPrompt(mcpServerName: string): boolean {
  const name = mcpServerName.toLowerCase();
  // Add other MCP servers here that need chained actions
  return name.includes("browser");
}
```

### Backend: API Endpoint

Add to `backend/src/routes/mcp-server.ts`:

```typescript
// POST /api/mcp_server/:id/configure-policies
fastify.post(
  "/api/mcp_server/:id/configure-policies",
  {
    schema: {
      params: z.object({ id: UuidIdSchema }),
      response: constructResponseSchema(
        z.object({ created: z.number(), skipped: z.number() })
      ),
    },
  },
  async ({ params: { id } }, reply) => {
    const mcpServer = await McpServerModel.findById(id);
    if (!mcpServer) throw new ApiError(404, "MCP server not found");

    // Get tools and agent-tools for this server
    const tools = await ToolModel.findByMcpServerId(id);
    const agentTools = await AgentToolModel.findByToolIds(tools.map(t => t.id));

    const result = await createBrowserDefaultPolicies(agentTools, tools);
    return reply.send(result);
  }
);
```

### Frontend: Integration

In the MCP installation flow (after successful install):

```typescript
// After MCP server installation succeeds
const [showPolicyDialog, setShowPolicyDialog] = useState(false);

// Check if this server needs policy configuration
if (needsPolicyConfigPrompt(mcpServer.name)) {
  setShowPolicyDialog(true);
}

// Handle dialog actions
const handleAccept = async () => {
  await configurePolicies({ path: { id: mcpServer.id } });
  setShowPolicyDialog(false);
  toast.success("Security policies configured");
};

const handleSkip = () => {
  setShowPolicyDialog(false);
};
```

### Files to Create/Modify

| Action | File |
|--------|------|
| CREATE | `backend/src/services/policy-defaults.ts` |
| CREATE | `frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx` |
| MODIFY | `backend/src/routes/mcp-server.ts` (add configure-policies endpoint) |
| MODIFY | `frontend/src/app/mcp-catalog/` (integrate dialog after install) |

### Acceptance Criteria

- [ ] Dialog appears after browser MCP server installation
- [ ] "Accept" creates session allowlist + SSRF protection policies
- [ ] "Skip" does nothing (user configures manually)
- [ ] Policies visible in Tools UI after acceptance
- [ ] Pattern reusable for other MCP servers needing chained actions

---

## Technical Notes

### Browser Arguments

Required Chromium arguments for containerized environment:
- `--no-sandbox` - Required for Docker
- `--disable-setuid-sandbox` - Required for Docker
- `--disable-dev-shm-usage` - Prevent /dev/shm issues
- `--disable-gpu` - No GPU in container

### Session ID Format

Session IDs should follow format: `browser-{profileId}-{timestamp}`

Example: `browser-a1b2c3d4-e5f6-7890-abcd-ef1234567890-1701234567890`

**Regex pattern used in policies:** `^browser-[a-f0-9-]+-[0-9]+$`

### Content Formats

`browser_get_content` supports three formats:

1. **text** - Plain text content
2. **accessibility** - Accessibility tree with form structure
3. **links** - List of all links on page

The `accessibility` format is preferred for agent analysis as it includes:
- Form fields with selectors
- Button labels and selectors
- Interactive element locations

### Docker Image Benefits

Using a dedicated Docker image with Playwright pre-installed:
- Pod startup in < 10 seconds (no runtime installation)
- Consistent, reproducible builds
- Smaller attack surface (no npm install at runtime)
- Easier CI/CD integration

---

## Files Summary

| Action | File |
|--------|------|
| CREATE | `platform/browser-mcp-server/package.json` |
| CREATE | `platform/browser-mcp-server/tsconfig.json` |
| CREATE | `platform/browser-mcp-server/vitest.config.ts` |
| CREATE | `platform/browser-mcp-server/src/server.ts` |
| CREATE | `platform/browser-mcp-server/src/browser-manager.ts` |
| CREATE | `platform/browser-mcp-server/src/types.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/index.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/navigate.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/screenshot.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/click.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/type.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/get-content.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/scroll.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/fill-and-submit.ts` |
| CREATE | `platform/backend/src/services/policy-defaults.ts` |
| CREATE | `platform/frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx` |
| CREATE | `platform/e2e-tests/tests/api/browser-mcp.spec.ts` |
| MODIFY | `platform/pnpm-workspace.yaml` |
| MODIFY | `platform/backend/src/database/seed.ts` (add seedBrowserMcpCatalog function) |
| MODIFY | `platform/backend/src/routes/mcp-server.ts` (add configure-policies endpoint) |
| MODIFY | `platform/frontend/src/app/mcp-catalog/` (integrate policy config dialog) |

---

## Definition of Done

- [ ] All 5 tasks completed (package, server, catalog, tests, security policies) - Task 1.3 removed
- [ ] E2E tests passing in CI with Kind cluster
- [ ] Package builds successfully with `pnpm build`
- [ ] Browser MCP server visible in MCP Catalog and installable via UI
- [ ] All 7 tools execute successfully
- [ ] Security policies automatically created on installation
- [ ] SSRF protection blocks internal network access
- [ ] Code reviewed and approved

---

## Open Questions for Team

Before proceeding with implementation, the following decisions need team input:

### 1. Docker Image - DECIDED

**Question:** Which Docker image should we use?

**Feedback #1:** "Why do we need a separate Docker image? Can we use our base image?"

**Feedback #2:** "Maybe use Microsoft's official Playwright image? https://hub.docker.com/r/microsoft/playwright - Hosting our own image is annoying, we'll need to update it etc."

**Decision:** Use Microsoft's official Playwright image from Docker Hub: `mcr.microsoft.com/playwright:v1.50.0-noble`

**Rationale:**
- Official Microsoft image, regularly updated
- Playwright + Chromium + Firefox + WebKit pre-installed
- No maintenance burden on our side
- No need for custom Dockerfile
- Fast startup (browsers already installed)

**Implementation:**
- Use `mcr.microsoft.com/playwright` as the Docker image
- Install browser-mcp-server via npm at startup
- No custom image to maintain

```typescript
// Catalog entry using Microsoft Playwright image
localConfig: {
  dockerImage: "mcr.microsoft.com/playwright:v1.50.0-noble",
  command: "npx",
  arguments: ["@archestra/browser-mcp-server"],
  environment: [
    { key: "MCP_HTTP_PORT", type: "plain_text", value: "8080", promptOnInstallation: false },
    { key: "MCP_HTTP_PATH", type: "plain_text", value: "/mcp", promptOnInstallation: false }
  ],
  transportType: "streamable-http",
  httpPort: 8080,
  httpPath: "/mcp"
}
```

**Distribution Strategy:** Publish `@archestra/browser-mcp-server` to npm.

This enables:
- Simple installation via `npx @archestra/browser-mcp-server`
- Version management via npm
- No need to bundle dist files or use ConfigMaps

**CI/CD for npm publish:**
```yaml
# .github/workflows/publish-browser-mcp.yml
- name: Publish browser-mcp-server
  run: |
    cd platform/browser-mcp-server
    pnpm build
    npm publish --access public
```

**External Registry Note:** This approach requires pulling from:
- `mcr.microsoft.com` (Microsoft Container Registry) for Playwright image
- `registry.npmjs.org` for @archestra/browser-mcp-server package

For air-gapped environments, these would need to be mirrored to internal registries.

**Task 1.3 status:** REMOVED (no custom Dockerfile needed)

### 2. Installation UX: Catalog Entry vs Pre-installed - DECIDED

**Question:** How should users access the browser server?

**Feedback:** "I think it should be in the catalog."

**Decision:** Option A - Visible in MCP Catalog, users install manually via UI.

**Implementation:**
- Seed browser server to internal MCP catalog via `seed.ts`
- Users discover it in the MCP Catalog page
- Users explicitly install it to their profiles
- Standard installation flow with tool assignment

### 3. Visibility: Built-in vs Catalog Server - DECIDED

**Question:** Should Archestra Browser be treated as a "built-in" capability?

**Feedback:** "I vote for the second" (visible catalog entry)

**Decision:** Option A - **Visible catalog entry** that users explicitly install.

**Rationale:**
- Consistent with other MCP servers in the catalog
- Users have explicit control over which profiles have browser access
- Clear audit trail of who installed browser capabilities
- Not every profile needs browser automation

**Implementation:**
- Browser server appears in MCP Catalog (`/mcp-catalog`)
- Users click "Install" to add to their profiles
- Tools assigned to profiles on installation
- Security policies auto-created on installation (Task 1.6)

### 4. Resource Allocation

The spec suggests K8s resource limits:
- Memory: 512Mi request / 2Gi limit
- CPU: 250m request / 1000m limit

**Question:** Are these appropriate for your K8s cluster constraints? Chromium can be memory-hungry during complex page renders.

### 5. Session Management Scope

The spec uses `sessionId` passed by the caller with 30-min TTL.

**Context**: In Archestra, "profile" and "agent" refer to the same entity (`agents` table, identified by `agentId`). The MCP Gateway authenticates via `Bearer ${agentId}`.

**Question:** How should browser sessions be managed?
- Option A: **Client-provided sessionId** - Any string accepted, client manages session lifecycle
- Option B: **Profile-scoped sessions** - Server extracts `agentId` from MCP Gateway context, one session per profile (no sessionId param needed)
- Option C: **Server-generated sessions** - Server creates sessionId, returns it to client for subsequent calls
- Option D: **Hybrid** - Optional sessionId param; if omitted, use profile-scoped default session

**Follow-up**: Should multiple concurrent sessions per profile be allowed? (e.g., one profile browsing multiple sites simultaneously)

### 6. Security: URL Policies - DECIDED

**Decision:** Use existing Tool Invocation Policies with **user-prompted** policy configuration on installation.

**Key Insight:** This is an **application policy** decision, not an LLM security measure. Browser tools (and other MCP servers with chained actions) need explicit allowlist policies to work, but this should be **user's choice**.

**Broader Context:** Other MCP servers also trigger chains of tool calls and are blocked by default. Browser MCP is a perfect example to establish a pattern for handling this.

**Session Model:**
- One session per chat
- Session closed by timeout (30 min) or when user ends chat
- Flow: `Chat starts → Browser session created → Tools chain freely → Chat ends/timeout → Session closed`

**Security Schema (offered to user on installation):**

| Policy | Purpose | Action |
|--------|---------|--------|
| Session allowlist | Allow browser tools to chain | `allow_when_context_is_untrusted` |
| SSRF protection | Block internal network | `block_always` |
| HTTPS only (optional) | Enforce secure connections | `block_always` |

**Implementation: User Prompt Dialog on Installation**

When user installs browser MCP server, show a dialog:

```
┌─────────────────────────────────────────────────────────────────┐
│  Configure Security Policies                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  This MCP server works by chaining multiple tool calls           │
│  (navigate → screenshot → click → type, etc.)                    │
│                                                                  │
│  By default, Archestra blocks tool chains when external data     │
│  is present in context. We can pre-configure policies for you    │
│  to enable chaining while maintaining security:                  │
│                                                                  │
│  • Allow browser tools to chain within a session                 │
│  • Block access to internal networks (SSRF protection)           │
│                                                                  │
│  You can always modify these policies later in the Tools page.   │
│                                                                  │
│                              [Skip]    [Accept & Configure]      │
└─────────────────────────────────────────────────────────────────┘
```

- **Accept**: Create policies automatically for browser tools
- **Skip**: User configures policies manually via Tools UI (same as any other MCP server)

**Implementation Files:**
- `backend/src/services/policy-defaults.ts` - Policy creation logic
- `frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx` - New dialog component
- `backend/src/routes/mcp-server.ts` - Optional: endpoint to apply default policies

See detailed design in: `.tasks/feature-security-design/security-system-report.md`

**Future Evolution:** The policy may evolve to a hybrid approach combining:
1. Domain allowlist (trusted domains)
2. Session trust (trust escalation after login)
3. Dual LLM sanitization (for untrusted content)

Example future flow:
```
example.com in domain allowlist?
├─ yes: allow
└─ no: trust example.com for this session?
    ├─ yes: allow
    └─ no: dual LLM sanitization success?
        ├─ yes: allow
        └─ no: forbid

If browser leaves the domain, re-run the policy.
```

**Benefits of this approach:**
- User has explicit control and awareness
- Same pattern can apply to other MCP servers with chained actions
- No "magic" behavior - user understands what's being configured
- Skip option preserves default security behavior

### 7. Tool Assignment

**Question:** When a profile installs the browser MCP server, should all 7 tools be auto-assigned, or should users select which tools to enable?
- Option A: All tools auto-assigned on installation
- Option B: User selects tools during/after installation
- Option C: Configurable default (admin setting)

---

*Task file for Phase 1 of Browser Integration*
*Updated: December 2, 2025 - Added open questions, fixed E2E tests to use MCP Gateway*
