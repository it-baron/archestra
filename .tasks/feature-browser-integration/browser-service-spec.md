# Browser Service Specification

## Overview

This specification defines the Browser Service - a component that integrates Microsoft's `@playwright/mcp` with Archestra platform to provide browser automation with live preview capabilities in the chat interface.

## Architecture

```
+------------------------------------------------------------------+
|                        Archestra Platform                         |
+------------------------------------------------------------------+
|                                                                    |
|  +------------------+     +----------------------------------+    |
|  |   Chat UI        |     |        MCP Gateway               |    |
|  |                  |     |                                  |    |
|  |  +------------+  |     |  Proxies MCP tool calls to       |    |
|  |  | Browser    |  |     |  running playwright instances    |    |
|  |  | Preview    |<-+-----+---------------------------------+|    |
|  |  | (Overlay)  |  | SSE |                                  |    |
|  |  +------------+  |     +----------------------------------+    |
|  +------------------+           |                                  |
|                                 v                                  |
|  +--------------------------------------------------------------+ |
|  |                    Browser Service                            | |
|  |  +----------------------------------------------------------+ | |
|  |  |                  Browser Manager                          | | |
|  |  |  - Session lifecycle (create/destroy per conversation)   | | |
|  |  |  - State tracking (URL, title, viewport)                 | | |
|  |  |  - Screenshot streaming via SSE                          | | |
|  |  |  - Instance health monitoring                            | | |
|  |  +----------------------------------------------------------+ | |
|  +--------------------------------------------------------------+ |
|                                 |                                  |
|                                 v                                  |
|  +--------------------------------------------------------------+ |
|  |              MCP Orchestrator (K8s Runtime)                   | |
|  |  +----------------------------------------------------------+ | |
|  |  |  Playwright MCP Pod (per session)                        | | |
|  |  |  - @playwright/mcp with HTTP transport                   | | |
|  |  |  - Docker: mcr.microsoft.com/playwright/mcp              | | |
|  |  |  - Flags: --headless --no-sandbox --port 8080            | | |
|  |  +----------------------------------------------------------+ | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

## Components

### 1. Playwright MCP Server (External)

**Source**: Microsoft's `@playwright/mcp` package

**Docker Image**: `mcr.microsoft.com/playwright/mcp`

**Transport**: HTTP/SSE (streamable-http)

**Required Flags**:
- `--headless` - Run without display
- `--no-sandbox` - Required for containerized environments (fixes session management bug)
- `--port 8080` - HTTP transport port
- `--host 0.0.0.0` - Bind to all interfaces
- `--isolated` - Keep browser profile in memory

**Available Tools**:
| Tool | Description | Read-only |
|------|-------------|-----------|
| `browser_navigate` | Load specified URL | No |
| `browser_click` | Click on element | No |
| `browser_type` | Type text into field | No |
| `browser_fill_form` | Fill multiple form fields | No |
| `browser_select_option` | Select dropdown option | No |
| `browser_hover` | Hover over element | Yes |
| `browser_drag` | Drag and drop | No |
| `browser_press_key` | Press keyboard key | No |
| `browser_navigate_back` | Go back | Yes |
| `browser_snapshot` | Capture accessibility tree | Yes |
| `browser_take_screenshot` | Take visual screenshot | Yes |
| `browser_console_messages` | Get console logs | Yes |
| `browser_network_requests` | Get network history | Yes |
| `browser_wait_for` | Wait for condition | Yes |
| `browser_evaluate` | Execute JavaScript | No |
| `browser_file_upload` | Upload files | No |
| `browser_handle_dialog` | Handle browser dialogs | No |
| `browser_tabs` | Manage tabs | No |
| `browser_resize` | Resize viewport | Yes |
| `browser_close` | Close page | Yes |

**Optional Capabilities** (enabled via `--caps`):
- `vision` - Coordinate-based interactions (mouse_click_xy, mouse_drag_xy, mouse_move_xy)
- `pdf` - PDF generation (browser_pdf_save)
- `tracing` - Playwright trace recording

### 2. Browser Manager (New Component)

**Location**: `platform/backend/src/browser-service/browser-manager.ts`

**Responsibilities**:

1. **Session Lifecycle Management**
   - Create playwright-mcp pod when user initiates browser session in chat
   - Associate session with `{profileId}-{conversationId}` pair
   - Clean up pod when conversation ends or times out
   - Handle pod restarts on failure

2. **State Tracking**
   - Current URL
   - Page title
   - Viewport dimensions
   - Session status (starting, running, error, stopped)
   - Last activity timestamp

3. **Screenshot Streaming**
   - Periodically capture screenshots (configurable interval, default: 500ms when active)
   - Stream via SSE endpoint to chat UI
   - Optimize bandwidth with JPEG compression and quality settings
   - Pause streaming when no active viewers

4. **Authentication Support**
   - Support `--storage-state` for pre-authenticated sessions
   - Allow users to save/restore auth state
   - Integrate with platform's secrets management for credentials

**API Endpoints**:

```typescript
// Start browser session for conversation
POST /api/browser-sessions
Body: {
  conversationId: string;
  profileId: string;
  options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    storageState?: string; // Path or inline JSON
  };
}
Response: {
  sessionId: string;
  mcpEndpoint: string; // URL to playwright-mcp instance
  status: "starting" | "running" | "error";
}

// Get session status
GET /api/browser-sessions/:sessionId
Response: {
  sessionId: string;
  status: "starting" | "running" | "error" | "stopped";
  currentUrl?: string;
  pageTitle?: string;
  viewport?: { width: number; height: number };
  lastActivity: string; // ISO timestamp
}

// Screenshot stream (SSE)
GET /api/browser-sessions/:sessionId/screenshots
Headers: Accept: text/event-stream
Response: SSE stream of base64-encoded images
  event: screenshot
  data: { timestamp: string; image: string; format: "jpeg" | "png" }

// Stop session
DELETE /api/browser-sessions/:sessionId

// Save authentication state
POST /api/browser-sessions/:sessionId/save-auth
Response: { storageStatePath: string }
```

### 3. Browser Preview UI (Frontend)

**Location**: `platform/frontend/src/components/browser-preview/`

**Features**:

1. **Overlay Window**
   - Draggable/resizable overlay in chat interface
   - Shows live browser view via screenshot stream
   - Minimize/maximize/close controls
   - Status indicator (connecting, live, error)

2. **Controls**
   - URL bar (read-only, shows current URL)
   - Refresh button (calls browser_navigate with current URL)
   - Screenshot button (saves current view)
   - Full-screen mode
   - Settings (screenshot quality, refresh rate)

3. **Session Management**
   - "Start Browser" button in chat
   - Session status indicator
   - Auto-reconnect on disconnect

### 4. Catalog Entry Updates

**Remove**: `archestra-browser` builtin server (our custom implementation)

**Keep**: Use `microsoft__playwright-mcp` from external catalog

**Add**: Builtin entry with optimized configuration:

```typescript
// platform/backend/src/builtin-mcp-registry/servers/playwright-browser.ts
registerBuiltinMcpServer({
  name: "playwright-browser",
  display_name: "Playwright Browser",
  description: "Browser automation with live preview. Uses Microsoft's official Playwright MCP server.",
  category: "Browser Automation",
  server: {
    type: "local",
    command: "npx",
    args: [
      "@playwright/mcp@latest",
      "--headless",
      "--no-sandbox",
      "--isolated",
      "--port", "8080",
      "--host", "0.0.0.0",
      "--viewport-size", "1280,720"
    ],
    docker_image: "mcr.microsoft.com/playwright/mcp",
    env: {
      MCP_HTTP_PORT: "8080",
      MCP_HTTP_PATH: "/mcp",
    },
  },
  tool_calling_policy: {
    prompt_on_install: true,
    preset: "browser", // SSRF protection preset
  },
});
```

## Security Considerations

### 1. SSRF Protection (Existing)

The existing `browser` policy preset blocks:
- `localhost`, `127.0.0.1`
- Private networks (`192.168.x.x`, `10.x.x.x`, `172.16.x.x`)
- Cloud metadata endpoints (`metadata.google`, `metadata.aws.amazon.com`)

Apply to `browser_navigate` tool.

### 2. Session Isolation

- Each conversation gets its own playwright-mcp pod
- `--isolated` flag ensures no persistent state between sessions
- Pod network namespace isolation via K8s

### 3. Resource Limits

- Pod memory limit: 2Gi (Playwright with browser can use significant memory)
- Pod CPU limit: 1 core
- Session timeout: 30 minutes of inactivity
- Max concurrent sessions per user: 3

### 4. Content Security

- Screenshot streaming only to authenticated users
- Session ownership validated on all API calls
- No direct browser access from frontend (all through MCP Gateway)

## Implementation Phases

### Phase 1: Basic Integration
- [ ] Update `archestra-browser` to use `microsoft__playwright-mcp` with Docker image
- [ ] Configure HTTP transport with proper flags
- [ ] Verify MCP tools work through gateway
- [ ] Add SSRF protection policies

### Phase 2: Browser Manager
- [ ] Create Browser Manager component
- [ ] Implement session lifecycle (create/destroy)
- [ ] Add state tracking
- [ ] Create API endpoints

### Phase 3: Screenshot Streaming
- [ ] Implement periodic screenshot capture
- [ ] Create SSE streaming endpoint
- [ ] Add bandwidth optimization (JPEG, quality settings)
- [ ] Handle viewer presence detection

### Phase 4: Frontend Preview
- [ ] Create overlay component
- [ ] Implement screenshot display with reconnection
- [ ] Add controls (URL bar, refresh, screenshot save)
- [ ] Integrate with chat UI

### Phase 5: Advanced Features
- [ ] Authentication state save/restore
- [ ] Multiple tabs support
- [ ] Session recording/playback
- [ ] PDF export

## Open Questions

1. **Screenshot interval**: What's the optimal balance between responsiveness and bandwidth? Start with 500ms, make configurable.

2. **Storage state management**: Should auth states be stored in database or filesystem? Consider secrets management integration.

3. **Multi-tab UX**: How to represent multiple tabs in the overlay? Tab bar or tab switcher?

4. **Mobile viewports**: Support device emulation? Add viewport presets (desktop, tablet, mobile).

5. **WebSocket vs SSE**: SSE is simpler but one-way. Consider WebSocket for bidirectional (e.g., click-to-interact on preview)?

## References

- [Playwright MCP GitHub](https://github.com/microsoft/playwright-mcp)
- [MCP HTTP Transport Session Issue](https://github.com/microsoft/playwright-mcp/issues/1140)
- [Browser Context Management](https://deepwiki.com/microsoft/playwright-mcp/4.4-browser-context-management)
