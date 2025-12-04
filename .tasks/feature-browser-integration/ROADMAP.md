# Browser Integration - Implementation Roadmap

**Issue**: [#1303 - Browse web via MCP, native in Archestra](https://github.com/archestra-ai/archestra/issues/1303)
**Bounty**: $3,000
**Status**: Planning

---

## Overview

This roadmap outlines the implementation phases for adding browser automation capabilities to Archestra. The implementation is divided into 7 phases, with Phases 1-6 comprising the core MVP and Phase 7 as an optional enhancement.

---

## Phase Summary

| Phase | Name | Priority | Dependencies | Complexity |
|-------|------|----------|--------------|------------|
| 1 | Browser MCP Server Pod | **Critical** | None | High |
| 2 | Archestra Browser Tools | **Critical** | Phase 1 | Medium |
| 3 | Frontend UI Components | **Critical** | Phase 2 | Medium |
| 4 | Authentication | **High** | Phase 2 | Medium |
| 5 | Security Integration | **High** | Phase 2, 4 | Medium |
| 6 | Observability | **Medium** | Phase 2 | Low |
| 7 | WebRTC Streaming | **Optional** | Phase 1-6 | High |

---

## Stage 1: Core MVP (Phases 1-6)

### Phase 1: Browser MCP Server Pod

**Objective**: Create a Playwright-based MCP server that runs as a K8s pod.

**Deliverables**:
- [ ] `packages/browser-mcp-server/` package with Playwright MCP server
- [ ] Dockerfile for browser pod image
- [ ] MCP server with browser tools (navigate, screenshot, click, type, etc.)
- [ ] Session management for browser contexts
- [ ] K8s pod specification with resource limits
- [ ] Internal MCP catalog entry

**Task File**: [phase-1-browser-mcp-server.md](./phase-1-browser-mcp-server.md)

---

### Phase 2: Archestra Browser Tools

**Objective**: Add built-in browser tools to `archestra-mcp-server.ts`.

**Deliverables**:
- [ ] `archestra__browser_open` tool
- [ ] `archestra__browser_navigate` tool
- [ ] `archestra__browser_screenshot` tool
- [ ] `archestra__browser_click` tool
- [ ] `archestra__browser_type` tool
- [ ] `archestra__browser_get_content` tool
- [ ] `archestra__browser_scroll` tool
- [ ] `archestra__browser_close` tool
- [ ] Extended `SessionData` with browser state
- [ ] Browser pod lifecycle management

**Task File**: [phase-2-archestra-browser-tools.md](./phase-2-archestra-browser-tools.md)

---

### Phase 3: Frontend UI Components

**Objective**: Display browser state inline in chat messages.

**Deliverables**:
- [ ] `BrowserPreview` component with screenshot display
- [ ] Click overlay for user interaction
- [ ] URL bar and navigation controls
- [ ] Expandable full-screen view
- [ ] Integration with chat message rendering
- [ ] Session status indicator

**Task File**: [phase-3-frontend-ui.md](./phase-3-frontend-ui.md)

---

### Phase 4: Authentication

**Objective**: Enable secure credential injection for browser login.

**Deliverables**:
- [ ] `browser_credential` secret type
- [ ] `browser_credential` database table and model
- [ ] `archestra__browser_login` tool
- [ ] `archestra__browser_request_user_action` tool (CAPTCHA/2FA fallback)
- [ ] Browser credentials settings page
- [ ] Agent-driven selector detection

**Task File**: [phase-4-authentication.md](./phase-4-authentication.md)

---

### Phase 5: Security Integration

**Objective**: Integrate browser tools with Archestra security model.

**Deliverables**:
- [ ] Default browser security policy (block internal IPs, file:// URLs)
- [ ] Domain allowlist for login operations
- [ ] Dual LLM integration for browser responses
- [ ] Session isolation per profile
- [ ] Browser login domain policy

**Task File**: [phase-5-security.md](./phase-5-security.md)

---

### Phase 6: Observability

**Objective**: Ensure browser actions are properly logged and observable.

**Deliverables**:
- [ ] Browser actions logged via `mcp_tool_call`
- [ ] Screenshot handling in logs (truncated for storage)
- [ ] Login attempt logging (domain only, no credentials)
- [ ] Distributed tracing integration
- [ ] Real-time screenshot display

**Task File**: [phase-6-observability.md](./phase-6-observability.md)

---

## Stage 2: Enhancement (Phase 7)

### Phase 7: WebRTC Live Streaming (Optional)

**Objective**: Provide real-time video streaming using Neko.

**Deliverables**:
- [ ] Neko-based Docker image with MCP server integration
- [ ] `BrowserStreamView` component for WebRTC playback
- [ ] Hybrid mode (switch between screenshots and streaming)
- [ ] User takeover capability
- [ ] WebRTC signaling integration

**Task File**: [phase-7-webrtc-streaming.md](./phase-7-webrtc-streaming.md)

---

## Implementation Order

```
                    Phase 1
                       |
                       v
                    Phase 2
                       |
          +------------+------------+
          |            |            |
          v            v            v
       Phase 3     Phase 4     Phase 6
          |            |
          |            v
          |        Phase 5
          |            |
          +------------+
                 |
                 v
            MVP Complete
                 |
                 v
             Phase 7
           (Optional)
```

### Parallel Execution Opportunities

- **Phase 3** and **Phase 4** can run in parallel after Phase 2
- **Phase 6** can run in parallel with Phases 3-5
- **Phase 5** requires Phase 4 to be complete

---

## Success Criteria

### MVP (Phases 1-6)

- [ ] Agent can browse websites via chat
- [ ] Screenshots displayed inline in chat
- [ ] User can click on screenshots to interact
- [ ] Secure credential injection working
- [ ] All browser actions logged
- [ ] Security policies enforced

### Enhancement (Phase 7)

- [ ] Live video streaming of browser session
- [ ] User can take control mid-session
- [ ] Smooth hybrid mode switching

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Playwright resource usage | High | Set strict CPU/memory limits |
| Session state management | Medium | Clear TTL and cleanup logic |
| Credential security | Critical | Server-side injection only |
| WebRTC complexity | Medium | Optional phase, can be deferred |
| K8s pod scaling | Medium | Start with one pod per profile |

---

## Testing Strategy

### Unit Tests

- Browser MCP server tools
- Session state management
- Credential model

### Integration Tests

- Pod lifecycle management
- Tool execution flow
- Credential injection

### E2E Tests

- Navigate and screenshot
- Login with credentials
- User click interaction

---

## Documentation Requirements

- [ ] Update `docs/pages/` with browser integration guide
- [ ] Add browser tools to Archestra tools documentation
- [ ] Document credential configuration
- [ ] Document security policies
- [ ] Add WebRTC setup guide (Phase 7)

---

*Roadmap by @it-baron - November 29, 2025*
