import { chromium, type Page } from "playwright";
import {
  type BrowserSession,
  CLEANUP_INTERVAL_MS,
  SESSION_ID_REGEX,
  SESSION_TTL_MS,
} from "./types.js";

const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

/**
 * Manages browser sessions with automatic cleanup
 */
export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Validates session ID format
   * Format: browser-{profileId}-{conversationId} where both are UUIDs
   */
  isValidSessionId(sessionId: string): boolean {
    return SESSION_ID_REGEX.test(sessionId);
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get or create a browser session
   */
  async getOrCreateSession(sessionId: string): Promise<BrowserSession> {
    if (!this.isValidSessionId(sessionId)) {
      throw new Error(`Invalid session ID format: ${sessionId}`);
    } else {
      console.info(`Session ${sessionId} is valid`);
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.touchSession(sessionId);
      return existing;
    } else {
      console.info(`Session ${sessionId} not found. Creating new session...`);
    }

    // Create new browser session
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    const session: BrowserSession = {
      browser,
      page,
      lastAccess: new Date(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Update session last access time
   */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const updatedSession: BrowserSession = {
        ...session,
        lastAccess: new Date(),
      };
      this.sessions.set(sessionId, updatedSession);
    }
  }

  /**
   * Close a specific session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.browser.close();
      } catch {
        // Ignore errors on close
      }
      this.sessions.delete(sessionId);
    } else {
      console.info(`Session ${sessionId} not found`);
    }
  }

  /**
   * Close all sessions
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.sessions.keys()).map((id) =>
      this.closeSession(id),
    );
    await Promise.all(closePromises);
    this.stopCleanupTimer();
  }

  /**
   * Get session page for tool operations
   */
  async getPage(sessionId: string): Promise<Page> {
    const session = await this.getOrCreateSession(sessionId);
    this.touchSession(sessionId);
    return session.page;
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    } else {
      console.info("Cleanup timer is already stopped");
    }
  }

  /**
   * Clean up sessions that have exceeded TTL
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastAccess.getTime() > SESSION_TTL_MS) {
        expiredSessions.push(sessionId);
      } else {
        console.info(`Session ${sessionId} is still active`);
      }
    }

    for (const sessionId of expiredSessions) {
      await this.closeSession(sessionId);
    }
  }

  /**
   * Get count of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}
