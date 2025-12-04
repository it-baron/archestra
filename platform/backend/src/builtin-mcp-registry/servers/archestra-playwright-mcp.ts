import { registerBuiltinMcpServer } from "../index.js";

// Archestra's Playwright MCP - uses Microsoft's official @playwright/mcp
// with optimized configuration for containerized environments
registerBuiltinMcpServer({
  name: "archestra-playwright",
  display_name: "Archestra Playwright",
  description:
    "Browser automation with live preview. Uses Microsoft's official Playwright MCP server for navigation, screenshots, clicking, typing, form submission, and more.",
  category: "Browser Automation",
  author: {
    name: "Archestra",
    url: "https://archestra.ai",
  },
  server: {
    type: "local",
    command: "npx",
    args: [
      "-y",
      "@playwright/mcp@latest",
      "--",
      "--headless",
      "--no-sandbox",
      "--isolated",
      "--port",
      "8080",
      "--host",
      "0.0.0.0",
      "--viewport-size",
      "1280,720",
    ],
    docker_image: "mcr.microsoft.com/playwright/mcp",
    env: {
      MCP_HTTP_PORT: "8080",
      MCP_HTTP_PATH: "/mcp",
    },
  },
  homepage: "https://archestra.ai",
  readme: null,
  quality_score: null,
  github_info: {
    url: "https://github.com/microsoft/playwright-mcp",
  },
  // Tool calling policy configuration for SSRF protection
  tool_calling_policy: {
    prompt_on_install: true,
    preset: "browser",
  },
});
