import type { IncomingMessage, Server } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import { WebSocket as WS, WebSocketServer as WSS } from "ws";
import { betterAuth, hasPermission } from "@/auth";
import config from "@/config";
import { BrowserStreamSocketClientContext } from "@/features/browser-stream/websocket/browser-stream.websocket";
import logger from "@/logging";
import { UserModel } from "@/models";
import {
  type ServerWebSocketMessage,
  type WebSocketMessage,
  WebSocketMessageSchema,
} from "@/types";

interface WebSocketClientContext {
  userId: string;
  organizationId: string;
  userIsProfileAdmin: boolean;
}

function getConversationIdFromMessage(message: WebSocketMessage): string {
  if (
    "payload" in message &&
    message.payload &&
    typeof message.payload === "object" &&
    "conversationId" in message.payload
  ) {
    return String(message.payload.conversationId);
  }
  return "";
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clientContexts: Map<WebSocket, WebSocketClientContext> = new Map();
  private browserStreamContext: BrowserStreamSocketClientContext | null = null;

  /**
   * Start the WebSocket server
   */
  start(httpServer: Server) {
    const { path } = config.websocket;

    this.wss = new WSS({
      server: httpServer,
      path,
    });
    if (BrowserStreamSocketClientContext.isBrowserStreamEnabled()) {
      this.browserStreamContext = new BrowserStreamSocketClientContext({
        wss: this.wss,
        sendToClient: (ws, message) => this.sendToClient(ws, message),
      });
    } else {
      this.browserStreamContext?.stop();
      this.browserStreamContext = null;
    }

    logger.info(`WebSocket server started on path ${path}`);

    this.wss.on(
      "connection",
      async (ws: WebSocket, request: IncomingMessage) => {
        const clientContext = await this.authenticateConnection(request);

        if (!clientContext) {
          logger.warn(
            {
              clientAddress:
                request.socket.remoteAddress ?? "unknown_websocket_client",
            },
            "Unauthorized WebSocket connection attempt",
          );
          this.sendUnauthorized(ws);
          return;
        }

        this.clientContexts.set(ws, clientContext);

        logger.info(
          {
            connections: this.wss?.clients.size,
            userId: clientContext.userId,
            organizationId: clientContext.organizationId,
          },
          "WebSocket client connected",
        );

        ws.on("message", async (data) => {
          try {
            const message = JSON.parse(data.toString());

            // Validate the message against our schema
            const validatedMessage = WebSocketMessageSchema.parse(message);

            // Handle different message types
            await this.handleMessage(validatedMessage, ws);
          } catch (error) {
            logger.error({ error }, "Failed to parse WebSocket message");

            // Send error back to client
            this.sendToClient(ws, {
              type: "error",
              payload: {
                message:
                  error instanceof Error ? error.message : "Invalid message",
              },
            });
          }
        });

        ws.on("close", () => {
          // Clean up browser stream subscription
          this.browserStreamContext?.unsubscribeBrowserStream(ws);

          logger.info(
            `WebSocket client disconnected. Remaining connections: ${this.wss?.clients.size}`,
          );
          this.clientContexts.delete(ws);
        });

        ws.on("error", (error) => {
          logger.error({ error }, "WebSocket error");
          // Clean up browser stream subscription on error
          this.browserStreamContext?.unsubscribeBrowserStream(ws);
          this.clientContexts.delete(ws);
        });
      },
    );

    this.wss.on("error", (error) => {
      logger.error({ error }, "WebSocket server error");
    });
  }

  /**
   * Handle incoming websocket messages
   */
  private async handleMessage(
    message: WebSocketMessage,
    ws: WebSocket,
  ): Promise<void> {
    const clientContext = this.getClientContext(ws);
    if (!clientContext) {
      return;
    }

    // Delegate browser messages to browserStreamContext
    if (
      BrowserStreamSocketClientContext.isBrowserWebSocketMessage(message.type)
    ) {
      if (this.browserStreamContext) {
        await this.browserStreamContext.handleMessage(
          message,
          ws,
          clientContext,
        );
      } else {
        this.sendToClient(ws, {
          type: "browser_stream_error",
          payload: {
            conversationId: getConversationIdFromMessage(message),
            error: "Browser streaming unavailable",
          },
        });
      }
      return;
    }

    // Handle other message types
    switch (message.type) {
      case "hello-world":
        logger.info("Received hello-world message");
        break;

      default:
        logger.warn({ message }, "Unknown WebSocket message type");
    }
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(ws: WebSocket, message: ServerWebSocketMessage): void {
    if (ws.readyState === WS.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: ServerWebSocketMessage) {
    if (!this.wss) {
      logger.warn("WebSocket server not initialized");
      return;
    }

    const messageStr = JSON.stringify(message);
    const clientCount = this.wss.clients.size;

    let sentCount = 0;
    this.wss.clients.forEach((client) => {
      if (client.readyState === WS.OPEN) {
        client.send(messageStr);
        sentCount++;
      }
    });

    if (sentCount < clientCount) {
      logger.info(
        `Only sent to ${sentCount}/${clientCount} clients (some were not ready)`,
      );
    }

    logger.info(
      { message, sentCount },
      `Broadcasted message to ${sentCount} client(s)`,
    );
  }

  /**
   * Send a message to specific clients (filtered by a predicate)
   */
  sendToClients(
    message: ServerWebSocketMessage,
    filter?: (client: WebSocket) => boolean,
  ) {
    if (!this.wss) {
      logger.warn("WebSocket server not initialized");
      return;
    }

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    this.wss.clients.forEach((client) => {
      if (client.readyState === WS.OPEN && (!filter || filter(client))) {
        client.send(messageStr);
        sentCount++;
      }
    });

    logger.info(
      { message, sentCount },
      `Sent message to ${sentCount} client(s)`,
    );
  }

  /**
   * Stop the WebSocket server
   */
  stop() {
    // Clear all browser stream subscriptions
    this.browserStreamContext?.stop();
    this.browserStreamContext = null;
    this.clientContexts.clear();

    if (this.wss) {
      this.wss.clients.forEach((client) => {
        client.close();
      });

      this.wss.close(() => {
        logger.info("WebSocket server closed");
      });
      this.wss = null;
    }
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  /**
   * Authenticate websocket connections using the same auth mechanisms as HTTP routes.
   */
  private async authenticateConnection(
    request: IncomingMessage,
  ): Promise<WebSocketClientContext | null> {
    const { success: userIsProfileAdmin } = await hasPermission(
      { profile: ["admin"] },
      request.headers,
    );
    const headers = new Headers(request.headers as HeadersInit);

    try {
      const session = await betterAuth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      });

      if (session?.user?.id) {
        const { organizationId, ...user } = await UserModel.getById(
          session.user.id,
        );
        return { userId: user.id, organizationId, userIsProfileAdmin };
      }
    } catch (_sessionError) {
      // Fall through to API key verification
    }

    const authHeader = headers.get("authorization");
    if (authHeader) {
      try {
        const apiKeyResult = await betterAuth.api.verifyApiKey({
          body: { key: authHeader },
        });

        if (apiKeyResult?.valid && apiKeyResult.key?.userId) {
          const { organizationId, ...user } = await UserModel.getById(
            apiKeyResult.key.userId,
          );
          return { userId: user.id, organizationId, userIsProfileAdmin };
        }
      } catch (_apiKeyError) {
        return null;
      }
    }

    return null;
  }

  private getClientContext(ws: WebSocket): WebSocketClientContext | null {
    const context = this.clientContexts.get(ws);
    if (!context) {
      this.sendUnauthorized(ws);
      return null;
    }

    return context;
  }

  private sendUnauthorized(ws: WebSocket): void {
    this.sendToClient(ws, {
      type: "error",
      payload: { message: "Unauthorized" },
    });
    ws.close(4401, "Unauthorized");
  }
}

export default new WebSocketService();
