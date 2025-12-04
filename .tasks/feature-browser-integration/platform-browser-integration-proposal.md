# Browser Integration Proposal for Archestra

## Issue Reference
- GitHub Issue: [#1303 - Browse web via MCP, native in Archestra](https://github.com/archestra-ai/archestra/issues/1303)
- Bounty: $3,000

## Executive Summary

This proposal extends Archestra's existing MCP orchestrator to provide browser automation capabilities. Rather than creating a separate browser management system, we leverage the existing K8s pod lifecycle, secret management, and MCP Gateway infrastructure - adding only what's missing: **browser state management** and **UI rendering**.

## Design Philosophy

Following feedback from Matvey (CEO):
> "There is already a component that manages pod lifecycle, secret management, etc. What's missing is a state and a way to show UI to the user."

This proposal adds browser capabilities **on top of** the existing MCP orchestrator, not alongside it.

---

## Technology Evaluation

### Licensing Analysis

| Solution | License | Commercial Use | Fits Requirements? |
|----------|---------|----------------|-------------------|
| [Browserless](https://github.com/browserless/browserless) | SSPL-1.0 | Requires paid license | **NO** |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Free | **YES** |
| [Neko](https://github.com/m1k1o/neko) | Apache-2.0 | Free | **YES** |
| [HeadlessX](https://github.com/SaifyXPRO/HeadlessX) | MIT | Free | **YES** |

**Important**: Browserless uses SSPL-1.0 license which is **not open source** and requires commercial license for commercial use. This violates the hard requirement "No closed-source dependencies."

### Recommended Approach

**Phase 1 (Core)**: Pure Playwright in a custom MCP server pod
- Apache-2.0 licensed, fully open source
- Screenshot-based interaction (like Cursor's browser)
- Simple, fast to implement

**Phase 2 (Enhancement)**: Optional Neko integration for WebRTC streaming
- Apache-2.0 licensed
- Live video streaming of browser session
- Better UX for watching agent actions in real-time
- More complex but provides richer experience

---

## Architecture Overview

```
+-------------------------------------------------------------------+
|                      Frontend (Next.js)                           |
|  +-------------------------------------------------------------+  |
|  |  Chat UI                                                    |  |
|  |  +-------------------------------------------------------+  |  |
|  |  | BrowserPreview Component (NEW)                        |  |  |
|  |  | - Screenshot display with action overlay              |  |  |
|  |  | - Click coordinates picker                            |  |  |
|  |  | - Navigation controls                                 |  |  |
|  |  | - Session indicator                                   |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
                              |
                              | POST /v1/mcp (tools/call)
                              v
+-------------------------------------------------------------------+
|                      Backend (Fastify)                            |
|  +-------------------------------------------------------------+  |
|  |  MCP Gateway (EXTENDED)                                     |  |
|  |  - SessionData.browserContext (NEW)                         |  |
|  |  - Browser state per agent session                          |  |
|  +-------------------------------------------------------------+  |
|  +-------------------------------------------------------------+  |
|  |  Archestra MCP Tools (EXTENDED)                             |  |
|  |  +-------------------------------------------------------+  |  |
|  |  | archestra__browser_navigate(url)                      |  |  |
|  |  | archestra__browser_screenshot()                       |  |  |
|  |  | archestra__browser_click(x, y)                        |  |  |
|  |  | archestra__browser_type(selector, text)               |  |  |
|  |  | archestra__browser_get_content()                      |  |  |
|  |  | archestra__browser_scroll(direction, amount)          |  |  |
|  |  | archestra__browser_wait(ms)                           |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
|                              |
|                              | K8s API (existing)
|                              v
|  +-------------------------------------------------------------+  |
|  |  MCP Server Runtime (REUSED)                                |  |
|  |  - K8sPod class manages browser pod                         |  |
|  |  - Secret management for browser credentials                |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|                   Kubernetes Cluster                              |
|  +-------------------------------------------------------------+  |
|  |  Browser Pod (streamable-http transport)                    |  |
|  |  +-------------------------------------------------------+  |  |
|  |  | Container: playwright-mcp-server                      |  |  |
|  |  | - Playwright headless browser                         |  |  |
|  |  | - MCP server exposing browser tools                   |  |  |
|  |  | - Screenshot streaming via HTTP                       |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

---

## Implementation Plan

### Phase 1: Browser MCP Server Pod

**Objective**: Create a browser automation pod that runs as a standard MCP server.

#### 1.1 Docker Image: `archestra/browser-mcp`

```dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Install Node.js MCP server dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install

COPY . .

# Expose MCP HTTP endpoint
EXPOSE 8080
ENV MCP_TRANSPORT=streamable-http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_PATH=/mcp

CMD ["node", "dist/server.js"]
```

#### 1.2 MCP Server Implementation

Create a new package: `packages/browser-mcp-server/`

```typescript
// packages/browser-mcp-server/src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { chromium, Browser, Page, BrowserContext } from "playwright";

interface BrowserState {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
}

const browserStates = new Map<string, BrowserState>();

async function getOrCreateBrowser(sessionId: string): Promise<BrowserState> {
  if (browserStates.has(sessionId)) {
    return browserStates.get(sessionId)!;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (compatible; Archestra Browser)"
  });

  const page = await context.newPage();
  const state = { browser, context, page, sessionId };
  browserStates.set(sessionId, state);

  return state;
}

// Tool handlers
const tools = [
  {
    name: "browser_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        sessionId: { type: "string", description: "Browser session ID" }
      },
      required: ["url", "sessionId"]
    }
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        fullPage: { type: "boolean", default: false }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "browser_click",
    description: "Click at coordinates or selector",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        selector: { type: "string" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "browser_type",
    description: "Type text into an element",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" }
      },
      required: ["sessionId", "selector", "text"]
    }
  },
  {
    name: "browser_get_content",
    description: "Get page content (text, links, forms)",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        format: {
          type: "string",
          enum: ["text", "html", "accessibility"],
          default: "accessibility"
        }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "browser_scroll",
    description: "Scroll the page",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", default: 500 }
      },
      required: ["sessionId", "direction"]
    }
  }
];
```

#### 1.3 Internal MCP Catalog Entry

Add to internal catalog for easy installation:

```typescript
// Add to seeding or via API
const browserMcpCatalog = {
  name: "Archestra Browser",
  description: "Browse the web with AI assistance",
  command: "node",
  args: ["/app/dist/server.js"],
  dockerImage: "ghcr.io/archestra-ai/browser-mcp:latest",
  transportType: "streamable-http",
  httpPort: 8080,
  httpPath: "/mcp",
  category: "system",
  isSystemServer: true
};
```

---

### Phase 2: Archestra Built-in Browser Tools

**Objective**: Add browser tools to `archestra-mcp-server.ts` that proxy to the browser pod.

#### 2.1 Extend SessionData

```typescript
// backend/src/routes/mcp-gateway.ts
interface SessionData {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastAccess: number;
  agentId: string;
  agent?: { id: string; name: string };
  // NEW: Browser state
  browserState?: {
    mcpServerId: string;      // ID of browser MCP server pod
    sessionId: string;        // Playwright session ID
    currentUrl?: string;      // Current page URL
    lastScreenshot?: string;  // Base64 screenshot for UI
  };
}
```

#### 2.2 Browser Tool Implementations

```typescript
// backend/src/archestra-mcp-server.ts

// Add new tools to ARCHESTRA_TOOLS array
{
  name: "archestra__browser_open",
  description: "Open a browser session for web browsing",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Initial URL to navigate to (optional)"
      }
    }
  }
},
{
  name: "archestra__browser_navigate",
  description: "Navigate the browser to a URL",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to navigate to" }
    },
    required: ["url"]
  }
},
{
  name: "archestra__browser_screenshot",
  description: "Take a screenshot of the current page",
  inputSchema: {
    type: "object",
    properties: {
      fullPage: { type: "boolean", default: false }
    }
  }
},
{
  name: "archestra__browser_click",
  description: "Click on an element by coordinates or selector",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "number", description: "X coordinate" },
      y: { type: "number", description: "Y coordinate" },
      selector: { type: "string", description: "CSS selector (alternative to coordinates)" }
    }
  }
},
{
  name: "archestra__browser_type",
  description: "Type text into a form field",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector for input field" },
      text: { type: "string", description: "Text to type" }
    },
    required: ["selector", "text"]
  }
},
{
  name: "archestra__browser_get_content",
  description: "Get the page content for analysis",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["text", "accessibility", "links"],
        default: "accessibility",
        description: "Output format"
      }
    }
  }
},
{
  name: "archestra__browser_close",
  description: "Close the browser session",
  inputSchema: { type: "object", properties: {} }
}

// Tool execution
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
        currentUrl: args.url as string | undefined
      };

      // 4. Navigate if URL provided
      if (args.url) {
        await executeBrowserCommand(browserServer.id, "browser_navigate", {
          url: args.url,
          sessionId
        });
      }

      // 5. Take initial screenshot
      const screenshot = await executeBrowserCommand(browserServer.id, "browser_screenshot", {
        sessionId
      });

      session.browserState.lastScreenshot = screenshot.image;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "opened",
            sessionId,
            url: args.url || "about:blank",
            screenshot: screenshot.image // Base64
          })
        }],
        isError: false
      };
    }

    case "archestra__browser_navigate": {
      if (!session.browserState) {
        return errorResult("No browser session. Call archestra__browser_open first.");
      }

      const result = await executeBrowserCommand(
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

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "navigated",
            url: args.url,
            title: result.title,
            screenshot: screenshot.image
          })
        }],
        isError: false
      };
    }

    // ... similar for other browser tools
  }
}
```

---

### Phase 3: Frontend UI Components

**Objective**: Display browser state inline in chat messages.

#### 3.1 BrowserPreview Component

```typescript
// frontend/src/components/chat/browser-preview.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Globe,
  MousePointer,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  X
} from "lucide-react";

interface BrowserPreviewProps {
  screenshot: string;  // Base64
  url: string;
  title?: string;
  onNavigate?: (url: string) => void;
  onClick?: (x: number, y: number) => void;
  onClose?: () => void;
}

export function BrowserPreview({
  screenshot,
  url,
  title,
  onNavigate,
  onClick,
  onClose
}: BrowserPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [clickMode, setClickMode] = useState(false);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!clickMode || !onClick) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * 1280);
    const y = Math.round((e.clientY - rect.top) / rect.height * 720);

    onClick(x, y);
    setClickMode(false);
  };

  return (
    <Card className={`mt-2 ${isExpanded ? 'fixed inset-4 z-50' : 'max-w-2xl'}`}>
      <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate flex-1">{title || url}</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setClickMode(!clickMode)}
            title="Click mode"
          >
            <MousePointer className={`h-3 w-3 ${clickMode ? 'text-primary' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-2">
        <div className="relative">
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="Browser screenshot"
            className={`rounded border ${clickMode ? 'cursor-crosshair' : 'cursor-default'}`}
            onClick={handleImageClick}
          />
          {clickMode && (
            <div className="absolute inset-0 bg-primary/10 rounded pointer-events-none flex items-center justify-center">
              <span className="text-sm bg-background/80 px-2 py-1 rounded">
                Click anywhere on the page
              </span>
            </div>
          )}
        </div>
        <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
          <span>URL: {url}</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

#### 3.2 Integrate with Chat Messages

```typescript
// frontend/src/components/chat/chat-messages.tsx
// Add to tool result rendering

function renderToolResult(toolName: string, result: unknown) {
  // Check for browser tools
  if (toolName.startsWith("archestra__browser_")) {
    const browserResult = result as {
      screenshot?: string;
      url?: string;
      title?: string;
      status?: string;
    };

    if (browserResult.screenshot) {
      return (
        <BrowserPreview
          screenshot={browserResult.screenshot}
          url={browserResult.url || ""}
          title={browserResult.title}
        />
      );
    }
  }

  // Default rendering
  return <pre>{JSON.stringify(result, null, 2)}</pre>;
}
```

---

### Phase 4: Security Integration

#### 4.1 Dual LLM Pattern

Browser tool outputs are **untrusted by default**:

```typescript
// Browser screenshots and content go through Dual LLM quarantine
// This is automatic since browser tools are regular Archestra tools

// The response from browser_get_content is marked as untrusted
// Dual LLM will sanitize before sending to main agent context
```

#### 4.2 Tool Invocation Policies

Add default browser policy:

```typescript
// Seed default policy
const defaultBrowserPolicy = {
  name: "Browser Security Policy",
  description: "Default security restrictions for browser tools",
  toolPattern: "archestra__browser_*",
  rules: [
    {
      // Block internal IPs
      field: "url",
      operator: "not_matches",
      value: "^https?://(localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01]))"
    },
    {
      // Block file:// URLs
      field: "url",
      operator: "not_starts_with",
      value: "file://"
    }
  ],
  action: "block"
};
```

#### 4.3 Session Isolation

- Each profile gets its own browser context
- Cookies/storage isolated per session
- Sessions expire with MCP Gateway session (30 min TTL)
- Browser pod can be shared, but contexts are isolated

---

### Phase 5: Logging and Observability

#### 5.1 MCP Tool Call Logging

Browser actions are automatically logged via existing `McpToolCallModel`:

```typescript
// Existing logging captures:
{
  agentId: "profile-123",
  mcpServerName: "archestra",
  method: "tools/call",
  toolCall: {
    name: "archestra__browser_navigate",
    arguments: { url: "https://example.com" }
  },
  toolResult: {
    status: "navigated",
    url: "https://example.com",
    title: "Example Domain"
    // Note: screenshots truncated in logs for storage
  },
  createdAt: "2025-11-29T..."
}
```

#### 5.2 Screenshot Storage Strategy

For audit/replay purposes:

```typescript
// Option A: Store in separate table (recommended for large volumes)
const browserScreenshotTable = pgTable("browser_screenshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  mcpToolCallId: uuid("mcp_tool_call_id").references(() => mcpToolCallTable.id),
  screenshot: text("screenshot"), // Base64 or reference to blob storage
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow()
});

// Option B: Truncate in main log, full screenshot only in real-time
// (simpler, less storage, but no replay)
```

---

## File Changes Summary

### New Files

| Path | Purpose |
|------|---------|
| `packages/browser-mcp-server/` | Playwright-based MCP server (separate package) |
| `frontend/src/components/chat/browser-preview.tsx` | Screenshot display component with click overlay |
| `backend/src/browser/` | Browser session management utilities |
| `backend/src/database/schemas/browser-credential.ts` | Browser credentials table schema |
| `backend/src/models/browser-credential.ts` | Browser credentials model |
| `frontend/src/app/settings/browser-credentials/page.tsx` | Credentials settings page |

### Modified Files

| Path | Changes |
|------|---------|
| `backend/src/archestra-mcp-server.ts` | Add `archestra__browser_*` and `archestra__browser_login` tools |
| `backend/src/routes/mcp-gateway.ts` | Extend `SessionData` with browser state |
| `frontend/src/components/chat/chat-messages.tsx` | Render browser previews |
| `backend/src/types/secret.ts` | Add `browser_credential` secret type |

### Docker/K8s

| Path | Purpose |
|------|---------|
| `packages/browser-mcp-server/Dockerfile` | Browser pod image |
| `helm/templates/browser-mcp-catalog.yaml` | Pre-seed browser MCP in catalog |

---

## Addressing Design Questions

### 1. How to make it work via MCP?

**Answer**: Embedded Archestra MCP tools (`archestra__browser_*`) that proxy to a browser MCP server pod. This:
- Reuses existing orchestrator for pod lifecycle
- Tools are automatically available to all profiles
- Security policies apply uniformly

### 2. How to show what the agent is doing in the UI nicely?

**Answer**: `BrowserPreview` component renders screenshots inline in chat with:
- Live screenshot after each action
- URL and title display
- Click overlay for user interaction (CAPTCHAs, 2FA)
- Expandable full-screen view

### 3. How will it comply with our security model?

**Answer**:
- Browser outputs are untrusted (Dual LLM quarantine)
- Tool invocation policies block internal IPs and control domain access
- One pod per profile (fully isolated)
- Credentials via `secretManager`, never sent to LLM

### 4. How to represent it in logs nicely?

**Answer**:
- Standard `mcp_tool_call` logging captures all browser actions
- Real-time display only (no screenshot storage in Stage 1)
- Login attempts logged with domain only (no credentials)
- Future: optional MP4 recording for session replay

### 5. How to handle sessions and cookies?

**Answer**:
- Browser context per profile (isolated cookies/storage)
- Context stored in MCP Gateway session (30-min TTL)
- Credential injection via `archestra__browser_login` tool
- Fallback: click overlay via `archestra__browser_request_user_action` for edge cases

---

## Implementation Phases

| Phase | Scope | Deliverables |
|-------|-------|--------------|
| 1 | Browser MCP Server | Playwright Docker image, K8s deployment, basic browser tools |
| 2 | Archestra Tools | Built-in `archestra__browser_*` tools, session management |
| 3 | Frontend UI | `BrowserPreview` component with click overlay |
| 4 | Authentication | `archestra__browser_login` tool, credential injection via `secretManager`, `browser_credential` table |
| 5 | Security | Tool invocation policies (domain allowlist, internal IP blocking), Dual LLM integration |
| 6 | Observability | Logging via `mcp_tool_call`, real-time display (no storage) |
| 7 | WebRTC Streaming (Optional) | Neko integration for live video, user takeover |

---

## Phase 7: WebRTC Live Streaming (Optional Enhancement)

**Objective**: Provide real-time video streaming of browser session using [Neko](https://github.com/m1k1o/neko) (Apache-2.0).

### Why Neko?

Neko is a self-hosted virtual browser that streams desktop environments via WebRTC. Key benefits:
- **Apache-2.0 license** - fully open source, no commercial restrictions
- **WebRTC streaming** - real-time video feed, not just screenshots
- **Multi-user support** - multiple viewers can watch the same session
- **Built-in Playwright support** - can automate while streaming
- **Mature project** - 7k+ GitHub stars, active development

### Architecture with Neko

```
+-------------------------------------------------------------------+
|                      Frontend (Next.js)                           |
|  +-------------------------------------------------------------+  |
|  |  Chat UI                                                    |  |
|  |  +-------------------------------------------------------+  |  |
|  |  | BrowserStreamView Component (NEW)                     |  |  |
|  |  | - WebRTC video player                                 |  |  |
|  |  | - Real-time browser feed                              |  |  |
|  |  | - Optional: user can take control                     |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
                              |
                              | WebRTC (video) + WebSocket (control)
                              v
+-------------------------------------------------------------------+
|                   Kubernetes Cluster                              |
|  +-------------------------------------------------------------+  |
|  |  Neko Pod (managed by MCP Orchestrator)                     |  |
|  |  +-------------------------------------------------------+  |  |
|  |  | neko-chromium container                               |  |  |
|  |  | - Chromium browser with X11                           |  |  |
|  |  | - WebRTC server for video streaming                   |  |  |
|  |  | - WebSocket for control messages                      |  |  |
|  |  | - Playwright can connect via CDP                      |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

### Neko Integration Options

#### Option A: Neko as Browser Runtime (Replace Playwright pod)

Use Neko container instead of pure Playwright:

```dockerfile
# Use official Neko Chromium image
FROM ghcr.io/m1k1o/neko/chromium:latest

# Add MCP server layer
COPY mcp-server /app/mcp-server
ENV NEKO_BIND=:8080
ENV NEKO_EPR=52000-52100

# MCP server connects to Neko's browser via CDP
CMD ["neko", "serve"]
```

MCP server connects to Neko's browser via Chrome DevTools Protocol (CDP):

```typescript
// MCP server connects to Neko's browser
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];

// Now can automate while Neko streams video
await page.goto("https://example.com");
```

#### Option B: Neko as Streaming Layer (Keep Playwright, add streaming)

Run Playwright pod with Neko's streaming components:

```typescript
// Hybrid: Playwright for automation + Neko for streaming
const neko = await startNekoStreaming({
  display: process.env.DISPLAY,
  webrtcPort: 8080
});

const browser = await chromium.launch({
  headless: false, // Need visible browser for streaming
  args: [`--display=${process.env.DISPLAY}`]
});
```

### Frontend WebRTC Component

```typescript
// frontend/src/components/chat/browser-stream-view.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Video, VideoOff, Maximize2, MousePointer } from "lucide-react";

interface BrowserStreamViewProps {
  streamUrl: string;  // WebSocket URL to Neko
  sessionId: string;
  onControl?: (event: ControlEvent) => void;
}

export function BrowserStreamView({
  streamUrl,
  sessionId,
  onControl
}: BrowserStreamViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [controlMode, setControlMode] = useState(false);

  useEffect(() => {
    // Connect to Neko WebRTC stream
    const pc = new RTCPeerConnection();
    const ws = new WebSocket(streamUrl);

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "offer") {
        await pc.setRemoteDescription(msg.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", sdp: answer }));
      }
    };

    pc.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        setIsConnected(true);
      }
    };

    return () => {
      pc.close();
      ws.close();
    };
  }, [streamUrl]);

  return (
    <Card className="mt-2 max-w-3xl">
      <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
        {isConnected ? (
          <Video className="h-4 w-4 text-green-500" />
        ) : (
          <VideoOff className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium flex-1">
          {isConnected ? "Live Browser Stream" : "Connecting..."}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setControlMode(!controlMode)}
        >
          <MousePointer className={`h-3 w-3 ${controlMode ? 'text-primary' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="p-2">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full rounded border bg-black"
          style={{ aspectRatio: "16/9" }}
        />
      </CardContent>
    </Card>
  );
}
```

### When to Use WebRTC vs Screenshots

| Use Case | Recommended Approach |
|----------|---------------------|
| Quick page inspection | Screenshots (Phase 1-5) |
| Long-running automation | WebRTC streaming (Phase 6) |
| User wants to watch agent work | WebRTC streaming |
| User wants to take over control | WebRTC streaming |
| Low bandwidth / mobile | Screenshots |
| Audit/replay | Screenshots (stored) |

### Phase 6 Deliverables

1. **Neko-based Docker image** with MCP server integration
2. **WebRTC frontend component** for live streaming
3. **Hybrid mode** - switch between screenshots and streaming
4. **User takeover** - let user control browser mid-session

---

## Design Decisions

1. **Screenshot storage**: Real-time display only for Stage 1. Future enhancement: optional MP4 recording for session replay.

2. **Browser pod sharing**: One pod per profile (fully isolated). No shared pods - prioritize security and simplicity over resource efficiency.

3. **User interaction**: Simple click overlay for essential interactions (e.g., CAPTCHAs, 2FA prompts). User clicks on screenshot, coordinates sent to agent. Keep implementation minimal.

4. **Authentication flow**: Agent-driven credential injection. User stores credentials per domain (no selectors). Agent analyzes page, detects form fields, provides selectors when requesting login. Credentials injected server-side (never sent to LLM).

---

## Authentication Architecture (Agent-Driven Credential Injection)

### Overview

Leverage existing `secretManager` infrastructure (DB or HashiCorp Vault) to store browser credentials securely. The **agent analyzes the page** to detect login form selectors, then requests credentials for those specific fields. Credentials are injected server-side and never exposed to the LLM.

### Key Insight: Agent Detects Selectors

The agent (LLM) is responsible for:
1. Navigating to login page
2. Analyzing page content to find form fields
3. Providing selectors when requesting login

This approach is **adaptive** - the agent figures out the login form structure dynamically, so it works on any site without pre-configuration.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Agent-Driven Login Flow                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. USER CONFIGURES CREDENTIALS (UI - Simple)                      │
│     Browser Credentials Settings page                               │
│     - Domain: github.com                                           │
│     - Username: user@example.com                                   │
│     - Password: ********                                           │
│     (No selectors needed - agent will detect them)                 │
│                              │                                      │
│                              ▼                                      │
│  2. AGENT NAVIGATES TO LOGIN PAGE                                  │
│     archestra__browser_navigate({ url: "https://github.com/login" })│
│                              │                                      │
│                              ▼                                      │
│  3. AGENT ANALYZES PAGE CONTENT                                    │
│     archestra__browser_get_content({ format: "accessibility" })     │
│     Response includes form structure:                               │
│     {                                                               │
│       forms: [{                                                     │
│         fields: [                                                   │
│           { type: "text", name: "login", selector: "#login_field" },│
│           { type: "password", selector: "#password" }               │
│         ],                                                          │
│         submit: { selector: "input[type='submit']" }                │
│       }]                                                            │
│     }                                                               │
│                              │                                      │
│                              ▼                                      │
│  4. AGENT REQUESTS LOGIN WITH DETECTED SELECTORS                   │
│     archestra__browser_login({                                      │
│       domain: "github.com",                                         │
│       usernameSelector: "#login_field",    // Agent detected        │
│       passwordSelector: "#password",        // Agent detected        │
│       submitSelector: "input[type='submit']" // Agent detected      │
│     })                                                              │
│                              │                                      │
│                              ▼                                      │
│  5. TOOL INVOCATION POLICY CHECK                                   │
│     - Verify profile has permission for this domain                │
│     - Check domain allowlist                                       │
│     - Log credential access attempt (domain only, no credentials)  │
│                              │                                      │
│                              ▼                                      │
│  6. SERVER-SIDE CREDENTIAL INJECTION                               │
│     - Retrieve credentials from secretManager                       │
│     - Fill fields using agent-provided selectors                    │
│     - Click submit                                                  │
│     - Credentials NEVER sent to LLM or logged                      │
│                              │                                      │
│                              ▼                                      │
│  7. AGENT CONTINUES WITH AUTHENTICATED SESSION                     │
│     Tool result: { status: "authenticated", domain: "github.com" } │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Properties

| Property | Implementation |
|----------|---------------|
| Credentials never sent to LLM | Server-side injection only, stripped from all responses |
| Credentials encrypted at rest | Via `secretManager` (DbSecretsManager or VaultSecretManager) |
| Access control | Tool invocation policies per domain |
| Audit trail | All login attempts logged in `mcp_tool_call` (domain only, no credentials) |
| Dual LLM protection | Browser responses go through quarantine if configured |
| Domain allowlist | Policy-based, configurable per profile |

### New Secret Type: `browser_credential`

Simplified - only stores credentials, no selectors (agent detects them):

```typescript
// Extend SecretValue type - simple, no selectors needed
interface BrowserCredentialSecret {
  type: "browser_credential";
  username: string;
  password: string;
}

// Store via existing secretManager
const secret = await secretManager.createSecret({
  type: "browser_credential",
  username: "user@example.com",
  password: "secret123"
});
```

### New Tool: `archestra__browser_login`

Agent provides selectors it detected from the page:

```typescript
{
  name: "archestra__browser_login",
  description: "Authenticate to a website using stored credentials. Agent must provide selectors detected from page content via archestra__browser_get_content. Credentials are injected server-side and never exposed to the agent.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Domain to authenticate to (e.g., 'github.com')"
      },
      usernameSelector: {
        type: "string",
        description: "CSS selector for username/email field (detected from page)"
      },
      passwordSelector: {
        type: "string",
        description: "CSS selector for password field (detected from page)"
      },
      submitSelector: {
        type: "string",
        description: "CSS selector for submit button (detected from page)"
      }
    },
    required: ["domain", "usernameSelector", "passwordSelector", "submitSelector"]
  }
}

// Execution (server-side)
async function executeBrowserLogin(
  args: {
    domain: string;
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
  },
  context: ArchestraToolContext
): Promise<CallToolResult> {
  const { profile, session } = context;

  // 1. Find credential for this domain + profile
  const credential = await BrowserCredentialModel.findByDomainAndProfile(
    args.domain,
    profile.id
  );

  if (!credential) {
    return errorResult(`No credentials configured for domain: ${args.domain}`);
  }

  // 2. Retrieve secret (server-side only)
  const secret = await secretManager.getSecret(credential.secretId);

  // 3. Execute login via browser pod using AGENT-PROVIDED selectors
  const result = await executeBrowserCommand(
    session.browserState.mcpServerId,
    "browser_fill_and_submit",
    {
      sessionId: session.browserState.sessionId,
      fields: [
        { selector: args.usernameSelector, value: secret.username },
        { selector: args.passwordSelector, value: secret.password }
      ],
      submitSelector: args.submitSelector
    }
  );

  // 4. Return status only (NO credentials)
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: result.success ? "authenticated" : "failed",
        domain: args.domain,
        message: result.success ? "Login successful" : result.error
      })
    }],
    isError: !result.success
  };
}
```

### Tool Invocation Policy for Browser Login

```typescript
// Default policy to control which domains agents can login to
const browserLoginPolicy = {
  name: "Browser Login Domain Policy",
  description: "Control which domains agents can authenticate to",
  toolPattern: "archestra__browser_login",
  rules: [
    {
      field: "domain",
      operator: "in_list",
      value: ["github.com", "gitlab.com", "jira.atlassian.com"] // Configurable allowlist
    }
  ],
  action: "allow" // or "block" for domains not in list
};
```

### Database Schema: Browser Credentials

Simplified - no selectors stored (agent detects them dynamically):

```typescript
// New table to link credentials to profiles
const browserCredentialTable = pgTable("browser_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").references(() => agentsTable.id).notNull(),
  domain: text("domain").notNull(),  // e.g., "github.com"
  secretId: uuid("secret_id").references(() => secretTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// Unique constraint: one credential per domain per profile
// Index on (profileId, domain) for fast lookup
```

### Benefits of Agent-Driven Selector Detection

| Aspect | User-Configured Selectors | Agent-Driven Detection |
|--------|--------------------------|------------------------|
| User setup | Complex (inspect page, copy selectors) | Simple (just domain + credentials) |
| Site changes | Breaks, needs manual update | Agent adapts dynamically |
| Works on any site | Only pre-configured sites | Yes, agent figures it out |
| Storage | Domain + selectors + credentials | Domain + credentials only |
| Maintenance | High (selectors change) | Low (agent handles changes) |

### Frontend: Browser Credentials Settings

Simplified form - no selectors needed:

```typescript
// New settings page: /settings/browser-credentials
// Allows users to:
// 1. Add credentials for domains (just domain + username + password)
// 2. Edit/delete existing credentials
// 3. Assign credentials to profiles
// 4. Test credentials (agent navigates to site, detects form, attempts login)

interface BrowserCredentialFormValues {
  domain: string;       // e.g., "github.com"
  username: string;
  password: string;
  profileIds: string[]; // Which profiles can use this credential
}
```

### Fallback: Click Overlay for Edge Cases

For sites that don't work with credential injection (CAPTCHAs, 2FA, unusual login flows):

1. Agent detects login failure or CAPTCHA
2. Agent calls `archestra__browser_request_user_action`
3. UI shows screenshot with click overlay
4. User completes action manually
5. Agent continues with session

```typescript
{
  name: "archestra__browser_request_user_action",
  description: "Request user to complete an action in the browser (e.g., CAPTCHA, 2FA)",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why user action is needed (e.g., 'CAPTCHA detected', '2FA required')"
      },
      timeout: {
        type: "number",
        description: "Seconds to wait for user action (default: 120)"
      }
    },
    required: ["reason"]
  }
}
```

---

## Compliance with Requirements

| Requirement | Solution |
|-------------|----------|
| No closed-source dependencies | Playwright (Apache-2.0), Neko (Apache-2.0) - **Browserless rejected (SSPL)** |
| No cloud services | Everything runs in user's K8s cluster |
| Reuse existing orchestrator | Browser pod managed by MCP runtime |
| UI integration | BrowserPreview (screenshots) + BrowserStreamView (WebRTC) |
| Security model | Dual LLM + policies + isolation |
| Logging | Standard mcp_tool_call + optional screenshots |

---

## Summary

This proposal provides browser integration for Archestra in two stages:

**Stage 1 (MVP)**: Screenshot-based browsing using Playwright
- Reuses existing MCP orchestrator infrastructure
- `archestra__browser_*` built-in tools
- `BrowserPreview` component with click overlay
- Credential injection via `secretManager` (`archestra__browser_login`)
- Full security integration (Dual LLM, policies, domain allowlist)
- One isolated pod per profile
- Compliant with all hard requirements

**Stage 2 (Enhancement)**: WebRTC live streaming using Neko
- Real-time video feed of browser session
- User can watch agent work live
- Optional user takeover for CAPTCHAs/2FA
- Apache-2.0 licensed (compliant)

Both stages leverage the existing K8s orchestrator, secret management (`secretManager`), and MCP Gateway - adding only browser state, credential injection, and UI rendering as Matvey suggested.

---

*Proposal by @it-baron - November 29, 2025*
