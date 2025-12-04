# Phase 1 - Task 3: Browse to Page and See Screenshot in Chain Call

**Goal**: User should be able to navigate to a page and take a screenshot using chained browser tool calls.

**Priority**: Critical
**Dependencies**: Task 1 (Catalog Install), Task 2 (Uninstall verified)
**Status**: Not Started

---

## Objective

Verify the complete browser automation flow works end-to-end:
1. User has browser MCP installed with security policies configured
2. Call `browser_navigate` to go to a URL
3. Call `browser_screenshot` to capture the page
4. Both calls succeed (chained without being blocked by security)
5. Screenshot returned as base64 image

---

## Deliverables

- [ ] 1.3.1 - Verify navigate → screenshot chain works via MCP Gateway
- [ ] 1.3.2 - Verify security policies allow the chain
- [ ] 1.3.3 - Verify SSRF protection blocks internal URLs
- [ ] 1.3.4 - Write comprehensive E2E tests for browser tool chains

---

## Task 1.3.1: Navigate → Screenshot Chain

### Expected Flow

```
1. POST /v1/mcp (browser_navigate)
   → Returns: { url, title }
   → Context becomes "untrusted" (external web data)

2. POST /v1/mcp (browser_screenshot)
   → Policy check: sessionId matches "^browser-[a-f0-9-]+-[0-9]+$"
   → Policy action: allow_when_context_is_untrusted
   → Returns: { image: "base64..." }
```

### Key Point

Without the security policy, step 2 would be blocked with:
> "Tool invocation blocked: context contains untrusted data"

The `allow_when_context_is_untrusted` policy enables the chain.

---

## Task 1.3.2: Security Policy Verification

### Policies Created (from Task 1)

| Policy | Tool | Argument | Action |
|--------|------|----------|--------|
| Session allowlist | All browser tools | `sessionId` | `allow_when_context_is_untrusted` |
| SSRF block | `browser_navigate` | `url` | `block_always` |

### Test Cases

1. **Valid chain with correct sessionId** → Should succeed
2. **Invalid sessionId format** → Should be blocked (no matching allow policy)
3. **Internal URL** → Should be blocked by SSRF policy

---

## Task 1.3.3: SSRF Protection Test

### Blocked URLs (regex)

```
(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|[::1]|0\.0\.0\.0|169\.254\.|metadata\.google|metadata\.aws)
```

### Test Cases

| URL | Expected |
|-----|----------|
| `https://example.com` | Allowed |
| `http://localhost:8080` | Blocked |
| `http://127.0.0.1/admin` | Blocked |
| `http://192.168.1.1` | Blocked |
| `http://10.0.0.1` | Blocked |
| `http://169.254.169.254/metadata` | Blocked |
| `http://metadata.google.internal` | Blocked |

---

## Task 1.3.4: E2E Tests

Create/update `platform/e2e-tests/tests/api/browser-mcp.spec.ts`:

```typescript
import { expect, test } from "./fixtures";
import type { APIRequestContext } from "@playwright/test";
import { MCP_GATEWAY_URL_SUFFIX } from "../../consts";

test.describe("Browser MCP Tool Chain", () => {
  let agentId: string;
  let serverId: string;
  const sessionId = `browser-${crypto.randomUUID()}-${Date.now()}`;

  // Helper: Execute tool via MCP Gateway
  const executeTool = async (
    request: APIRequestContext,
    baseUrl: string,
    agentId: string,
    toolName: string,
    args: Record<string, unknown>
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
        params: { name: toolName, arguments: args },
      },
    });
    return response.json();
  };

  test.beforeAll(async ({
    request,
    createAgent,
    createMcpCatalogItem,
    installMcpServer,
    makeApiRequest,
  }) => {
    // Setup: Create agent, install browser MCP, configure policies
    const agentResponse = await createAgent(request, "chain-test-agent");
    agentId = (await agentResponse.json()).id;

    const catalogResponse = await createMcpCatalogItem(request, {
      name: "Browser Chain Test",
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
    const catalogId = (await catalogResponse.json()).id;

    const installResponse = await installMcpServer(request, {
      name: "browser-chain-test",
      catalogId,
      agentIds: [agentId]
    });
    serverId = (await installResponse.json()).id;

    // Wait for ready
    await waitForMcpServerReady(request, makeApiRequest, serverId);

    // Configure policies (accept dialog)
    await makeApiRequest({
      request,
      method: "post",
      urlSuffix: `/api/mcp_server/${serverId}/configure-policies`,
    });
  });

  test.afterAll(async ({ request, deleteAgent, uninstallMcpServer, deleteMcpCatalogItem }) => {
    // Cleanup
  });

  test.describe("Successful Chain Calls", () => {
    test("should navigate to external URL", async ({ request, baseUrl }) => {
      const result = await executeTool(request, baseUrl, agentId, "browser_navigate", {
        sessionId,
        url: "https://example.com"
      });

      expect(result.error).toBeUndefined();
      expect(result.result.isError).toBeFalsy();
      expect(result.result.content[0].text).toContain("example.com");
    });

    test("should take screenshot after navigate (chain call)", async ({ request, baseUrl }) => {
      // This is the key test - screenshot should work despite untrusted context
      const result = await executeTool(request, baseUrl, agentId, "browser_screenshot", {
        sessionId,
        fullPage: false
      });

      expect(result.error).toBeUndefined();
      expect(result.result.isError).toBeFalsy();

      const content = JSON.parse(result.result.content[0].text);
      expect(content.image).toBeDefined();
      expect(content.image.length).toBeGreaterThan(1000); // Base64 should be substantial
    });

    test("should get page content after navigate (chain call)", async ({ request, baseUrl }) => {
      const result = await executeTool(request, baseUrl, agentId, "browser_get_content", {
        sessionId,
        format: "text"
      });

      expect(result.error).toBeUndefined();
      expect(result.result.isError).toBeFalsy();
      expect(result.result.content[0].text).toContain("Example Domain");
    });

    test("should click and navigate (chain call)", async ({ request, baseUrl }) => {
      // Navigate to a page with links
      await executeTool(request, baseUrl, agentId, "browser_navigate", {
        sessionId,
        url: "https://example.com"
      });

      // Click the "More information" link
      const result = await executeTool(request, baseUrl, agentId, "browser_click", {
        sessionId,
        selector: "a"
      });

      expect(result.error).toBeUndefined();
      expect(result.result.isError).toBeFalsy();
    });
  });

  test.describe("SSRF Protection", () => {
    test("should block localhost", async ({ request, baseUrl }) => {
      const result = await executeTool(request, baseUrl, agentId, "browser_navigate", {
        sessionId,
        url: "http://localhost:8080"
      });

      // Should be blocked by policy
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain("blocked");
    });

    test("should block 127.0.0.1", async ({ request, baseUrl }) => {
      const result = await executeTool(request, baseUrl, agentId, "browser_navigate", {
        sessionId,
        url: "http://127.0.0.1/admin"
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain("blocked");
    });

    test("should block private IP ranges", async ({ request, baseUrl }) => {
      const privateUrls = [
        "http://192.168.1.1",
        "http://10.0.0.1",
        "http://172.16.0.1",
      ];

      for (const url of privateUrls) {
        const result = await executeTool(request, baseUrl, agentId, "browser_navigate", {
          sessionId,
          url
        });

        expect(result.error).toBeDefined();
        expect(result.error.message).toContain("blocked");
      }
    });

    test("should block cloud metadata endpoints", async ({ request, baseUrl }) => {
      const metadataUrls = [
        "http://169.254.169.254/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
      ];

      for (const url of metadataUrls) {
        const result = await executeTool(request, baseUrl, agentId, "browser_navigate", {
          sessionId,
          url
        });

        expect(result.error).toBeDefined();
        expect(result.error.message).toContain("blocked");
      }
    });
  });

  test.describe("Invalid Session ID", () => {
    test("should block tool with invalid session format", async ({ request, baseUrl }) => {
      const result = await executeTool(request, baseUrl, agentId, "browser_screenshot", {
        sessionId: "invalid-session-format",  // Doesn't match regex
      });

      // Should be blocked because no allow policy matches
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain("untrusted");
    });
  });
});
```

---

## Files Summary

| Action | File |
|--------|------|
| MODIFY | `platform/e2e-tests/tests/api/browser-mcp.spec.ts` (add chain tests) |

---

## Acceptance Criteria

- [ ] `browser_navigate` → `browser_screenshot` chain works
- [ ] `browser_navigate` → `browser_get_content` chain works
- [ ] `browser_navigate` → `browser_click` chain works
- [ ] SSRF protection blocks internal URLs (localhost, private IPs, metadata)
- [ ] Invalid session ID format is blocked
- [ ] All E2E tests pass

---

## Definition of Done

- [ ] Navigate → Screenshot chain verified working
- [ ] Security policies correctly allow/block as expected
- [ ] SSRF protection tests pass
- [ ] E2E tests added and passing
- [ ] Code reviewed and approved

---

## Technical Notes

### Session ID Format

Pattern: `browser-{profileId}-{timestamp}`
Regex: `^browser-[a-f0-9-]+-[0-9]+$`

Example: `browser-a1b2c3d4-e5f6-7890-abcd-ef1234567890-1701234567890`

### Why Chain Calls Work

1. First call (`browser_navigate`) returns external web data
2. Context is marked as "untrusted"
3. Second call (`browser_screenshot`) is evaluated:
   - Policy check: `sessionId` matches `^browser-[a-f0-9-]+-[0-9]+$`
   - Action: `allow_when_context_is_untrusted`
   - Result: Tool execution allowed

Without the policy, step 3 would fail with "context contains untrusted data".

### Screenshot Format

```json
{
  "content": [{
    "type": "text",
    "text": "{\"image\": \"iVBORw0KGgoAAAANSUhEUgAA...\"}"
  }]
}
```

The `image` field contains a base64-encoded PNG.
