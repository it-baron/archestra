# Browser Integration - Design Document

**Issue**: [#1303 - Browse web via MCP, native in Archestra](https://github.com/archestra-ai/archestra/issues/1303)
**Bounty**: $3,000
**Status**: Design Phase

---

## Executive Summary

This design document describes the architecture for adding browser automation capabilities to Archestra. The solution extends the existing MCP orchestrator to provide browser state management and UI rendering, rather than creating a separate browser management system.

## Design Philosophy

Following feedback from Matvey (CEO):
> "There is already a component that manages pod lifecycle, secret management, etc. What's missing is a state and a way to show UI to the user."

This design adds browser capabilities **on top of** the existing MCP orchestrator, not alongside it.

---

## Technology Selection

### Licensing Analysis

| Solution | License | Commercial Use | Decision |
|----------|---------|----------------|----------|
| [Browserless](https://github.com/browserless/browserless) | SSPL-1.0 | Requires paid license | **REJECTED** |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Free | **SELECTED** |
| [Neko](https://github.com/m1k1o/neko) | Apache-2.0 | Free | **SELECTED (Phase 7)** |
| [HeadlessX](https://github.com/SaifyXPRO/HeadlessX) | MIT | Free | Alternative |

**Important**: Browserless uses SSPL-1.0 license which is **not open source** and requires commercial license for commercial use. This violates the hard requirement "No closed-source dependencies."

### Selected Approach

**Stage 1 (Core)**: Pure Playwright in a custom MCP server pod
- Apache-2.0 licensed, fully open source
- Screenshot-based interaction
- Simple, fast to implement

**Stage 2 (Enhancement)**: Optional Neko integration for WebRTC streaming
- Apache-2.0 licensed
- Live video streaming of browser session
- Better UX for watching agent actions in real-time

---

## Architecture Overview

```
+-------------------------------------------------------------------+
|                      Frontend (Next.js)                           |
|  +-------------------------------------------------------------+  |
|  |  Chat UI                                                    |  |
|  |  +-------------------------------------------------------+  |  |
|  |  | BrowserPreview Component                              |  |  |
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
|  |  - SessionData.browserContext                               |  |
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
|  |  | archestra__browser_login(domain, selectors)           |  |  |
|  |  | archestra__browser_request_user_action(reason)        |  |  |
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

## Core Components

### 1. Browser MCP Server Pod

A Playwright-based MCP server that runs as a K8s pod.

**Docker Image**: `ghcr.io/archestra-ai/browser-mcp:latest`

**Base**: `mcr.microsoft.com/playwright:v1.40.0-jammy`

**Transport**: `streamable-http` on port 8080

**Tools Exposed**:
- `browser_navigate` - Navigate to URL
- `browser_screenshot` - Take screenshot
- `browser_click` - Click at coordinates/selector
- `browser_type` - Type text into element
- `browser_get_content` - Get page content (text/accessibility/links)
- `browser_scroll` - Scroll page
- `browser_fill_and_submit` - Fill form and submit (for credential injection)

### 2. Archestra Built-in Browser Tools

Extensions to `archestra-mcp-server.ts` that proxy to the browser pod.

**New Tools**:
- `archestra__browser_open` - Open browser session
- `archestra__browser_navigate` - Navigate to URL
- `archestra__browser_screenshot` - Take screenshot
- `archestra__browser_click` - Click element
- `archestra__browser_type` - Type into field
- `archestra__browser_get_content` - Get page content
- `archestra__browser_close` - Close session
- `archestra__browser_login` - Authenticate using stored credentials
- `archestra__browser_request_user_action` - Request user intervention

### 3. Session State Management

Extended `SessionData` in MCP Gateway:

```typescript
interface SessionData {
  // Existing fields...
  browserState?: {
    mcpServerId: string;      // ID of browser MCP server pod
    sessionId: string;        // Playwright session ID
    currentUrl?: string;      // Current page URL
    lastScreenshot?: string;  // Base64 screenshot for UI
  };
}
```

### 4. BrowserPreview Component

React component for displaying browser state in chat:

- Screenshot display with click overlay
- URL bar and navigation controls
- Expandable full-screen view
- Click mode for user interaction
- Session status indicator

### 5. Browser Credentials System

Secure credential storage for automated login:

**Database Schema**: `browser_credential` table
- `id` - UUID primary key
- `profileId` - FK to agents table
- `domain` - Target domain (e.g., "github.com")
- `secretId` - FK to secrets table
- One credential per domain per profile

**Secret Type**: `browser_credential`
- Stored via existing `secretManager` (DB or Vault)
- Contains username and password only
- No selectors stored (agent detects them dynamically)

**Flow**:
1. User configures credentials per domain (simple UI)
2. Agent navigates to login page
3. Agent analyzes page content to detect form selectors
4. Agent calls `archestra__browser_login` with detected selectors
5. Server retrieves credentials and injects them
6. Credentials never sent to LLM

---

## Security Model

### 1. Dual LLM Integration

Browser tool outputs are **untrusted by default**:
- Browser responses go through Dual LLM quarantine
- Page content sanitized before sending to main agent context

### 2. Tool Invocation Policies

Default browser security policy:
- Block internal IPs (localhost, 127.*, 10.*, 192.168.*, 172.16-31.*)
- Block file:// URLs
- Domain allowlist for login operations

### 3. Session Isolation

- Each profile gets its own browser context
- Cookies/storage isolated per session
- Sessions expire with MCP Gateway session (30 min TTL)
- One pod per profile (fully isolated)

### 4. Credential Security

- Credentials encrypted at rest via `secretManager`
- Never sent to LLM or logged
- Access control via tool invocation policies
- Audit trail in `mcp_tool_call` (domain only, no credentials)

---

## Data Flow

### Tool Execution Flow

```
1. Agent calls archestra__browser_navigate({url})
     |
     v
2. Archestra MCP Server receives request
     |
     v
3. Check/create browser session for profile
     |
     v
4. Proxy request to browser pod via K8s
     |
     v
5. Playwright executes navigation
     |
     v
6. Auto-screenshot after navigation
     |
     v
7. Return result with screenshot to client
     |
     v
8. Frontend renders BrowserPreview component
```

### Login Flow (Agent-Driven)

```
1. Agent navigates to login page
     |
     v
2. Agent calls archestra__browser_get_content
     |
     v
3. Agent analyzes page, detects form selectors
     |
     v
4. Agent calls archestra__browser_login({
     domain: "github.com",
     usernameSelector: "#login_field",
     passwordSelector: "#password",
     submitSelector: "input[type='submit']"
   })
     |
     v
5. Backend retrieves credentials from secretManager
     |
     v
6. Backend injects credentials via browser pod
     |
     v
7. Return status (authenticated/failed)
```

---

## File Structure

### New Files

| Path | Purpose |
|------|---------|
| `packages/browser-mcp-server/` | Playwright-based MCP server package |
| `packages/browser-mcp-server/Dockerfile` | Browser pod image |
| `frontend/src/components/chat/browser-preview.tsx` | Screenshot display component |
| `backend/src/browser/` | Browser session management utilities |
| `backend/src/database/schemas/browser-credential.ts` | Browser credentials table schema |
| `backend/src/models/browser-credential.ts` | Browser credentials model |
| `frontend/src/app/settings/browser-credentials/page.tsx` | Credentials settings page |
| `helm/templates/browser-mcp-catalog.yaml` | Pre-seed browser MCP in catalog |

### Modified Files

| Path | Changes |
|------|---------|
| `backend/src/archestra-mcp-server.ts` | Add `archestra__browser_*` tools |
| `backend/src/routes/mcp-gateway.ts` | Extend `SessionData` with browser state |
| `frontend/src/components/chat/chat-messages.tsx` | Render browser previews |
| `backend/src/types/secret.ts` | Add `browser_credential` secret type |

---

## Design Decisions

### 1. Screenshot Storage

**Decision**: Real-time display only for Stage 1

**Rationale**: Simplifies implementation, reduces storage costs

**Future Enhancement**: Optional MP4 recording for session replay

### 2. Browser Pod Sharing

**Decision**: One pod per profile (fully isolated)

**Rationale**: Security and simplicity over resource efficiency

### 3. User Interaction

**Decision**: Simple click overlay for essential interactions

**Rationale**: Keep implementation minimal while supporting CAPTCHAs and 2FA

### 4. Authentication Flow

**Decision**: Agent-driven credential injection with server-side secrets

**Rationale**:
- Adaptive to any site (agent detects form structure)
- Credentials never exposed to LLM
- Simple user configuration (no selectors needed)

### 5. WebRTC Streaming (Phase 7)

**Decision**: Optional Neko integration

**Rationale**:
- Provides real-time video for better UX
- User takeover capability for edge cases
- Apache-2.0 licensed (compliant)

---

## Non-Functional Requirements

### Performance

- Screenshot capture < 500ms
- Navigation response < 2s (excluding page load)
- WebRTC stream latency < 100ms (Phase 7)

### Scalability

- One browser pod per profile
- Pod auto-scaling based on usage
- 30-minute session TTL

### Reliability

- Pod health checks
- Automatic restart on failure
- Graceful session cleanup

### Observability

- All actions logged via `mcp_tool_call`
- Distributed tracing via OpenTelemetry
- Screenshots available in real-time

---

## Compliance Summary

| Requirement | Solution |
|-------------|----------|
| No closed-source dependencies | Playwright (Apache-2.0), Neko (Apache-2.0) |
| No cloud services | Everything runs in user's K8s cluster |
| Reuse existing orchestrator | Browser pod managed by MCP runtime |
| UI integration | BrowserPreview + BrowserStreamView (Phase 7) |
| Security model | Dual LLM + policies + isolation |
| Logging | Standard mcp_tool_call + optional screenshots |

---

## Open Questions

1. **Resource Limits**: What CPU/memory limits for browser pods?
2. **Concurrent Sessions**: Max sessions per profile?
3. **Screenshot Resolution**: Default viewport size (1280x720)?
4. **Session Persistence**: Persist browser state across deployments?

---

*Design by @it-baron - November 29, 2025*
