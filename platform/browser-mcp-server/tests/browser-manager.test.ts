import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../src/browser-manager.js";

// Mock playwright to avoid actual browser launches in tests
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn(),
          screenshot: vi.fn(),
          click: vi.fn(),
          type: vi.fn(),
          fill: vi.fn(),
          $: vi.fn(),
          evaluate: vi.fn(),
          waitForNavigation: vi.fn(),
          waitForTimeout: vi.fn(),
          title: vi.fn().mockResolvedValue("Test Page"),
          url: vi.fn().mockReturnValue("https://example.com"),
          innerText: vi.fn(),
          innerHTML: vi.fn(),
        }),
      }),
      close: vi.fn(),
    }),
  },
}));

describe("BrowserManager", () => {
  let manager: BrowserManager;

  beforeEach(() => {
    manager = new BrowserManager();
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  describe("session ID validation", () => {
    it("accepts valid session ID format", () => {
      const validId =
        "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";
      expect(manager.isValidSessionId(validId)).toBe(true);
    });

    it("rejects session ID with uppercase letters", () => {
      const invalidId =
        "browser-550E8400-E29B-41D4-A716-446655440000-7C9E6679-7425-40DE-944B-E07FC1F90AE7";
      expect(manager.isValidSessionId(invalidId)).toBe(false);
    });

    it("rejects invalid session ID format - too short", () => {
      expect(manager.isValidSessionId("invalid")).toBe(false);
    });

    it("rejects invalid session ID format - wrong prefix", () => {
      expect(
        manager.isValidSessionId(
          "session-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7",
        ),
      ).toBe(false);
    });

    it("rejects invalid session ID format - single UUID", () => {
      expect(
        manager.isValidSessionId(
          "browser-550e8400-e29b-41d4-a716-446655440000",
        ),
      ).toBe(false);
    });

    it("rejects empty session ID", () => {
      expect(manager.isValidSessionId("")).toBe(false);
    });
  });

  describe("session lifecycle", () => {
    const validSessionId =
      "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";

    it("creates a new session", async () => {
      const session = await manager.getOrCreateSession(validSessionId);

      expect(session).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(session.page).toBeDefined();
      expect(session.lastAccess).toBeInstanceOf(Date);
    });

    it("returns existing session on subsequent calls", async () => {
      const session1 = await manager.getOrCreateSession(validSessionId);
      const session2 = await manager.getOrCreateSession(validSessionId);

      expect(session1).toBe(session2);
    });

    it("hasSession returns true for existing session", async () => {
      await manager.getOrCreateSession(validSessionId);
      expect(manager.hasSession(validSessionId)).toBe(true);
    });

    it("hasSession returns false for non-existing session", () => {
      expect(manager.hasSession(validSessionId)).toBe(false);
    });

    it("closes session correctly", async () => {
      await manager.getOrCreateSession(validSessionId);
      await manager.closeSession(validSessionId);

      expect(manager.hasSession(validSessionId)).toBe(false);
    });

    it("throws error for invalid session ID", async () => {
      await expect(manager.getOrCreateSession("invalid")).rejects.toThrow(
        "Invalid session ID format",
      );
    });
  });

  describe("session timeout", () => {
    const validSessionId =
      "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";

    it("updates lastAccess on activity", async () => {
      const session = await manager.getOrCreateSession(validSessionId);
      const initialAccess = session.lastAccess;

      // Simulate activity after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      manager.touchSession(validSessionId);

      // Re-fetch session since touchSession creates a new immutable session object
      const updatedSession = await manager.getOrCreateSession(validSessionId);
      expect(updatedSession.lastAccess.getTime()).toBeGreaterThan(
        initialAccess.getTime(),
      );
    });

    it("touchSession does nothing for non-existing session", () => {
      // Should not throw
      manager.touchSession(validSessionId);
    });
  });

  describe("session count", () => {
    it("returns correct session count", async () => {
      expect(manager.getSessionCount()).toBe(0);

      await manager.getOrCreateSession(
        "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7",
      );
      expect(manager.getSessionCount()).toBe(1);

      await manager.getOrCreateSession(
        "browser-660e8400-e29b-41d4-a716-446655440000-8c9e6679-7425-40de-944b-e07fc1f90ae7",
      );
      expect(manager.getSessionCount()).toBe(2);
    });
  });

  describe("getPage", () => {
    const validSessionId =
      "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";

    it("returns page from session", async () => {
      const page = await manager.getPage(validSessionId);
      expect(page).toBeDefined();
    });

    it("creates session if not exists", async () => {
      expect(manager.hasSession(validSessionId)).toBe(false);
      await manager.getPage(validSessionId);
      expect(manager.hasSession(validSessionId)).toBe(true);
    });
  });
});
