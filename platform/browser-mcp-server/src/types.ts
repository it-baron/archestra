import type { Browser, Page } from "playwright";

/**
 * Browser session stored by BrowserManager
 */
export interface BrowserSession {
  browser: Browser;
  page: Page;
  lastAccess: Date;
}

/**
 * Session ID format: browser-{profileId}-{conversationId}
 * Both profileId and conversationId are UUIDs
 */
export const SESSION_ID_REGEX =
  /^browser-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/**
 * Session TTL in milliseconds (30 minutes)
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Cleanup interval in milliseconds (5 minutes)
 */
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Default HTTP port for streamable-http transport
 */
export const DEFAULT_HTTP_PORT = 8080;

/**
 * Default HTTP path for streamable-http transport
 */
export const DEFAULT_HTTP_PATH = "/mcp";

/**
 * Content format for get_content tool
 */
export type ContentFormat = "text" | "html" | "markdown";

/**
 * Scroll direction for scroll tool
 */
export type ScrollDirection = "up" | "down";
