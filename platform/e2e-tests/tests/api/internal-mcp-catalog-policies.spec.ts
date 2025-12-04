import { expect, test } from "./fixtures";

test.describe("Internal MCP Catalog - Tool Calling Policy", () => {
  test("can create catalog item with toolCallingPolicy", async ({
    request,
    makeApiRequest,
    deleteMcpCatalogItem,
  }) => {
    // Create a catalog item with policy preference
    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/internal_mcp_catalog",
      data: {
        name: "Test Browser MCP",
        description: "Test browser MCP server",
        serverType: "local",
        localConfig: {
          command: "npx",
          arguments: ["@archestra/browser-mcp-server"],
          transportType: "streamable-http",
          httpPort: 8080,
          httpPath: "/mcp",
        },
        toolCallingPolicy: {
          preset: "browser",
          applyOnAssignment: true,
        },
      },
    });

    const created = await createResponse.json();
    expect(created.toolCallingPolicy).toEqual({
      preset: "browser",
      applyOnAssignment: true,
    });

    // Clean up
    await deleteMcpCatalogItem(request, created.id);
  });

  test("can update catalog item toolCallingPolicy", async ({
    request,
    makeApiRequest,
    deleteMcpCatalogItem,
  }) => {
    // Create without policy
    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/internal_mcp_catalog",
      data: {
        name: "Test MCP No Policy",
        description: "Test MCP server without policy",
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
      },
    });
    const created = await createResponse.json();
    expect(created.toolCallingPolicy).toBeNull();

    // Update with policy
    const updateResponse = await makeApiRequest({
      request,
      method: "put",
      urlSuffix: `/api/internal_mcp_catalog/${created.id}`,
      data: {
        toolCallingPolicy: {
          preset: "browser",
          applyOnAssignment: true,
        },
      },
    });

    const updated = await updateResponse.json();
    expect(updated.toolCallingPolicy?.preset).toBe("browser");
    expect(updated.toolCallingPolicy?.applyOnAssignment).toBe(true);

    // Clean up
    await deleteMcpCatalogItem(request, created.id);
  });

  test("can create catalog item without toolCallingPolicy", async ({
    request,
    makeApiRequest,
    deleteMcpCatalogItem,
  }) => {
    // Create without policy
    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/internal_mcp_catalog",
      data: {
        name: "Test MCP Without Policy",
        description: "Test MCP server",
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
      },
    });

    const created = await createResponse.json();
    expect(created.toolCallingPolicy).toBeNull();

    // Clean up
    await deleteMcpCatalogItem(request, created.id);
  });

  test("can clear toolCallingPolicy by setting to null", async ({
    request,
    makeApiRequest,
    deleteMcpCatalogItem,
  }) => {
    // Create with policy
    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/internal_mcp_catalog",
      data: {
        name: "Test MCP Clear Policy",
        description: "Test MCP server",
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        toolCallingPolicy: {
          preset: "browser",
          applyOnAssignment: true,
        },
      },
    });
    const created = await createResponse.json();
    expect(created.toolCallingPolicy).not.toBeNull();

    // Clear policy
    const updateResponse = await makeApiRequest({
      request,
      method: "put",
      urlSuffix: `/api/internal_mcp_catalog/${created.id}`,
      data: {
        toolCallingPolicy: null,
      },
    });

    const updated = await updateResponse.json();
    expect(updated.toolCallingPolicy).toBeNull();

    // Clean up
    await deleteMcpCatalogItem(request, created.id);
  });
});
