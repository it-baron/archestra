import { registerBuiltinMcpServer } from "../index.js";

// TODO: Change to archestra-ai/archestra once merged
const GITHUB_REPO = "it-baron/archestra";

registerBuiltinMcpServer({
  name: "archestra-browser",
  display_name: "Archestra Browser",
  description:
    "Browse the web with AI assistance. Provides browser automation using Playwright for navigation, screenshots, clicking, typing, and form submission.",
  category: "Browser Automation",
  author: {
    name: "Archestra",
    url: "https://archestra.ai",
  },
  server: {
    type: "local",
    // Clone repo, build, and run server
    command: "sh",
    args: [
      "-c",
      `git clone --depth 1 https://github.com/${GITHUB_REPO}.git /tmp/archestra && cd /tmp/archestra/platform/browser-mcp-server && npm install && npm run build && node dist/server.js`,
    ],
    docker_image: "mcr.microsoft.com/playwright:v1.50.0-noble",
    env: {
      MCP_HTTP_PORT: "8080",
      MCP_HTTP_PATH: "/mcp",
    },
  },
  homepage: "https://archestra.ai",
  readme: null,
  quality_score: null,
  github_info: {
    url: `https://github.com/${GITHUB_REPO}`,
  },
  // Tool calling policy configuration (custom extension, not in external catalog types)
  tool_calling_policy: {
    prompt_on_install: true,
    preset: "browser",
  },
});
