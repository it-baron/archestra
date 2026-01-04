import * as chatMcpClient from "@/clients/chat-mcp-client";
import { beforeEach, describe, expect, test, vi } from "@/test";
import { BrowserStreamService } from "./browser-stream";

describe("BrowserStreamService URL handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("takeScreenshot calls getCurrentUrl to get reliable URL", async () => {
    const browserService = new BrowserStreamService();
    const agentId = "test-agent";
    const conversationId = "test-conversation";
    const userContext = { userId: "test-user", userIsProfileAdmin: false };

    // Mock selectOrCreateTab to succeed
    vi.spyOn(browserService, "selectOrCreateTab").mockResolvedValue({
      success: true,
      tabIndex: 0,
    });

    // Mock findScreenshotTool to return a tool name
    vi.spyOn(
      browserService as unknown as {
        findScreenshotTool: () => Promise<string>;
      },
      "findScreenshotTool",
    ).mockResolvedValue("browser_take_screenshot");

    // Mock getCurrentUrl to return a specific URL
    const getCurrentUrlSpy = vi
      .spyOn(browserService, "getCurrentUrl")
      .mockResolvedValue("https://correct-page.example.com/path");

    // Mock getChatMcpClient to return a mock client for screenshot
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        content: [
          {
            type: "image",
            data: "base64screenshotdata",
            mimeType: "image/png",
          },
          // Screenshot response has no URL or wrong URL - doesn't matter
          // because we use getCurrentUrl instead
          { type: "text", text: "Screenshot captured" },
        ],
      }),
    };
    vi.spyOn(chatMcpClient, "getChatMcpClient").mockResolvedValue(
      mockClient as never,
    );

    // Call takeScreenshot
    const result = await browserService.takeScreenshot(
      agentId,
      conversationId,
      userContext,
    );

    // Verify getCurrentUrl was called with correct args
    expect(getCurrentUrlSpy).toHaveBeenCalledWith(agentId, userContext);

    // Verify the URL in result is from getCurrentUrl, not from screenshot response
    expect(result.url).toBe("https://correct-page.example.com/path");

    // Verify screenshot data is present (extractScreenshot adds data URL prefix)
    expect(result.screenshot).toContain("base64screenshotdata");
  });

  test("takeScreenshot returns undefined URL when getCurrentUrl fails", async () => {
    const browserService = new BrowserStreamService();
    const agentId = "test-agent";
    const conversationId = "test-conversation";
    const userContext = { userId: "test-user", userIsProfileAdmin: false };

    // Mock selectOrCreateTab to succeed
    vi.spyOn(browserService, "selectOrCreateTab").mockResolvedValue({
      success: true,
      tabIndex: 0,
    });

    // Mock findScreenshotTool to return a tool name
    vi.spyOn(
      browserService as unknown as {
        findScreenshotTool: () => Promise<string>;
      },
      "findScreenshotTool",
    ).mockResolvedValue("browser_take_screenshot");

    // Mock getCurrentUrl to return undefined (failed to get URL)
    vi.spyOn(browserService, "getCurrentUrl").mockResolvedValue(undefined);

    // Mock getChatMcpClient
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        isError: false,
        content: [
          {
            type: "image",
            data: "base64screenshotdata",
            mimeType: "image/png",
          },
        ],
      }),
    };
    vi.spyOn(chatMcpClient, "getChatMcpClient").mockResolvedValue(
      mockClient as never,
    );

    // Call takeScreenshot
    const result = await browserService.takeScreenshot(
      agentId,
      conversationId,
      userContext,
    );

    // URL should be undefined when getCurrentUrl fails
    expect(result.url).toBeUndefined();

    // Screenshot should still be present (extractScreenshot adds data URL prefix)
    expect(result.screenshot).toContain("base64screenshotdata");
  });
});
