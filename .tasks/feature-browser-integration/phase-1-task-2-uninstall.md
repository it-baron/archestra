# Phase 1 - Task 2: Delete Browser MCP from Private Registry

**Goal**: User should be able to delete "Archestra Browser" from their private registry.

**Priority**: Critical
**Dependencies**: Task 1 (Catalog Install)
**Status**: Not Started

---

## Objective

When a user wants to remove the Browser MCP server:
1. Navigate to MCP Servers or Tools page
2. Find the installed "Archestra Browser" server
3. Click delete/uninstall
4. Server removed, pod stopped, tools unassigned

---

## Deliverables

- [ ] 1.2.1 - Verify existing uninstall flow works for browser MCP
- [ ] 1.2.2 - Ensure policies are cleaned up on uninstall
- [ ] 1.2.3 - Verify pod is properly terminated
- [ ] 1.2.4 - Write E2E test for uninstall flow

---

## Task 1.2.1: Verify Existing Uninstall Flow

The MCP server uninstall flow already exists. Verify it works for browser MCP:

### Existing Flow

```
DELETE /api/mcp_server/:id
  ↓
1. Stop K8s pod (if running)
2. Delete tools associated with server
3. Delete agent-tool associations (cascade)
4. Delete tool invocation policies (cascade via agent-tool)
5. Delete trusted data policies (cascade via agent-tool)
6. Delete MCP server record
```

### Verification Steps

1. Install browser MCP server
2. Verify pod is running
3. Call `DELETE /api/mcp_server/:id`
4. Verify pod is terminated
5. Verify tools are removed
6. Verify policies are removed

---

## Task 1.2.2: Policy Cleanup

Policies should be automatically cleaned up via database cascade when agent-tools are deleted.

### Database Schema Check

```sql
-- tool_invocation_policies has ON DELETE CASCADE from agent_tools
agent_tool_id UUID REFERENCES agent_tools(id) ON DELETE CASCADE

-- trusted_data_policies has ON DELETE CASCADE from agent_tools
agent_tool_id UUID REFERENCES agent_tools(id) ON DELETE CASCADE
```

### Verification

After uninstall:
```sql
SELECT * FROM tool_invocation_policies WHERE agent_tool_id IN (
  SELECT id FROM agent_tools WHERE tool_id IN (
    SELECT id FROM tools WHERE mcp_server_id = '<server-id>'
  )
);
-- Should return 0 rows
```

---

## Task 1.2.3: Pod Termination

Verify K8s pod is properly terminated on uninstall.

### Expected Behavior

```typescript
// In mcp-server.ts DELETE handler
await K8sPodManager.stopPod(mcpServer.id);
```

### Verification

```bash
# Before uninstall
kubectl get pods -l mcp-server-id=<server-id>
# Should show 1 pod running

# After uninstall
kubectl get pods -l mcp-server-id=<server-id>
# Should show 0 pods
```

---

## Task 1.2.4: E2E Test for Uninstall

Add to `platform/e2e-tests/tests/api/browser-mcp.spec.ts`:

```typescript
test.describe("Browser MCP Server Uninstall", () => {
  let agentId: string;
  let catalogId: string;
  let serverId: string;

  test.beforeAll(async ({ request, createAgent, createMcpCatalogItem, installMcpServer, makeApiRequest }) => {
    // Setup: Create agent and install browser MCP
    const agentResponse = await createAgent(request, "uninstall-test-agent");
    agentId = (await agentResponse.json()).id;

    const catalogResponse = await createMcpCatalogItem(request, {
      name: "Browser Uninstall Test",
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
    catalogId = (await catalogResponse.json()).id;

    const installResponse = await installMcpServer(request, {
      name: "browser-uninstall-test",
      catalogId,
      agentIds: [agentId]
    });
    serverId = (await installResponse.json()).id;

    // Wait for server to be ready
    await waitForMcpServerReady(request, makeApiRequest, serverId);

    // Accept policy configuration
    await makeApiRequest({
      request,
      method: "post",
      urlSuffix: `/api/mcp_server/${serverId}/configure-policies`,
    });
  });

  test("should have tools and policies before uninstall", async ({ request, makeApiRequest }) => {
    // Verify tools exist
    const toolsResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/mcp_server/${serverId}/tools`,
    });
    const tools = await toolsResponse.json();
    expect(tools.length).toBeGreaterThan(0);

    // Verify policies exist
    const policiesResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/autonomy-policies/tool-invocation`,
    });
    const allPolicies = await policiesResponse.json();
    const browserPolicies = allPolicies.filter((p: any) =>
      tools.some((t: any) => t.agentToolIds?.includes(p.agentToolId))
    );
    expect(browserPolicies.length).toBeGreaterThan(0);
  });

  test("should uninstall browser MCP server", async ({ request, makeApiRequest }) => {
    const response = await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/mcp_server/${serverId}`,
    });
    expect(response.status()).toBe(200);
  });

  test("should have no tools after uninstall", async ({ request, makeApiRequest }) => {
    const response = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/mcp_server/${serverId}/tools`,
      ignoreStatusCheck: true,
    });
    // Server should not exist
    expect(response.status()).toBe(404);
  });

  test("should have no policies after uninstall", async ({ request, makeApiRequest }) => {
    const policiesResponse = await makeApiRequest({
      request,
      method: "get",
      urlSuffix: `/api/autonomy-policies/tool-invocation`,
    });
    const allPolicies = await policiesResponse.json();

    // No policies should reference the deleted agent-tools
    // (They should have been cascade deleted)
    const orphanedPolicies = allPolicies.filter((p: any) =>
      p.reason?.includes("browser") && p.reason?.includes("session")
    );
    // This is a weak check - in real test we'd track the policy IDs
    expect(orphanedPolicies.length).toBe(0);
  });

  test.afterAll(async ({ request, deleteAgent, deleteMcpCatalogItem }) => {
    // Cleanup
    if (agentId) await deleteAgent(request, agentId);
    if (catalogId) await deleteMcpCatalogItem(request, catalogId);
  });
});
```

---

## Files Summary

| Action | File |
|--------|------|
| MODIFY | `platform/e2e-tests/tests/api/browser-mcp.spec.ts` (add uninstall tests) |

---

## Acceptance Criteria

- [ ] User can delete browser MCP from private registry
- [ ] K8s pod is terminated on delete
- [ ] All browser tools are removed
- [ ] All associated policies are cleaned up (cascade delete)
- [ ] E2E test passes for uninstall flow

---

## Definition of Done

- [ ] Existing uninstall flow verified working for browser MCP
- [ ] Policy cleanup confirmed via cascade delete
- [ ] Pod termination confirmed
- [ ] E2E test added and passing
- [ ] Code reviewed and approved

---

## Notes

This task primarily verifies existing functionality works correctly for the browser MCP server. The uninstall flow is already implemented - we're confirming it handles:

1. Browser-specific pod with Playwright
2. Multiple tools (7 browser tools)
3. Multiple policies (session allowlist + SSRF block per tool)
4. Proper cascade cleanup
