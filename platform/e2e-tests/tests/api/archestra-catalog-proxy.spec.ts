import { API_BASE_URL } from "../../consts";
import { expect, test } from "./fixtures";

test.describe("Archestra Catalog Proxy", () => {
  test("includes archestra-playwright in online catalog results", async ({
    request,
  }) => {
    // Catalog proxy is public, can use direct request
    // Path matches external API: /search
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/search`,
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const playwrightServer = data.servers.find(
      (s: { name: string }) => s.name === "archestra-playwright",
    );

    expect(playwrightServer).toBeDefined();
    expect(playwrightServer.display_name).toBe("Archestra Playwright");
    // Note: tool_calling_policy is intentionally excluded from external API
  });

  test("can fetch archestra-playwright by name", async ({ request }) => {
    // Path matches external API: /server/{name}
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/server/archestra-playwright`,
    );
    expect(response.ok()).toBeTruthy();

    const server = await response.json();
    expect(server.name).toBe("archestra-playwright");
    expect(server.category).toBe("Browser Automation");
  });

  test("includes Browser Automation category from builtin servers", async ({
    request,
  }) => {
    // Path matches external API: /category
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/category`,
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.categories).toContain("Browser Automation");
  });

  test("filters builtin servers by search query", async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/search?q=playwright`,
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const playwrightServer = data.servers.find(
      (s: { name: string }) => s.name === "archestra-playwright",
    );
    expect(playwrightServer).toBeDefined();
  });

  test("filters builtin servers by category", async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/search?category=Browser%20Automation`,
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const playwrightServer = data.servers.find(
      (s: { name: string }) => s.name === "archestra-playwright",
    );
    expect(playwrightServer).toBeDefined();
  });

  test("builtin server has correct transport configuration", async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/server/archestra-playwright`,
    );
    expect(response.ok()).toBeTruthy();

    const server = await response.json();
    expect(server.server.type).toBe("local");
    expect(server.server.env?.MCP_HTTP_PORT).toBe("8080");
    expect(server.server.env?.MCP_HTTP_PATH).toBe("/mcp");
  });
});
