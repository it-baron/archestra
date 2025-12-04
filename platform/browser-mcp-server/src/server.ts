#!/usr/bin/env node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BrowserManager } from "./browser-manager.js";
import { registerTools } from "./tools/index.js";
import { DEFAULT_HTTP_PATH, DEFAULT_HTTP_PORT } from "./types.js";

const PORT = Number(process.env.MCP_HTTP_PORT) || DEFAULT_HTTP_PORT;
const PATH = process.env.MCP_HTTP_PATH || DEFAULT_HTTP_PATH;

const browserManager = new BrowserManager();

const mcpServer = new McpServer({
  name: "archestra-browser",
  version: "0.0.1",
});

// Register all browser tools
registerTools(mcpServer, browserManager);

// Create HTTP server
const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          sessions: browserManager.getSessionCount(),
        }),
      );
      return;
    }

    // Only handle requests to the MCP path
    if (!req.url?.startsWith(PATH)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
  },
);

// Create and connect transport
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

// Wire up the transport to handle HTTP requests
httpServer.on("request", async (req, res) => {
  if (req.url?.startsWith(PATH)) {
    await transport.handleRequest(req, res);
  }
});

// Connect MCP server to transport
await mcpServer.connect(transport);

// Handle graceful shutdown
const shutdown = async () => {
  console.info("Shutting down...");
  await browserManager.closeAll();
  await mcpServer.close();
  httpServer.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start listening
httpServer.listen(PORT, () => {
  console.info(`Archestra Browser MCP server listening on port ${PORT}${PATH}`);
  console.info(`Health check available at http://localhost:${PORT}/health`);
});
