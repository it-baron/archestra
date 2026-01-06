import { describe, expect, test } from "vitest";
import type { CommonToolCall } from "@/types";
import { toolResultsToMessages } from "./gemini";

describe("adapters/gemini", () => {
  describe("toolResultsToMessages", () => {
    test("returns empty array for no results", () => {
      const messages = toolResultsToMessages([], []);
      expect(messages).toEqual([]);
    });

    test("converts successful tool results to function responses", () => {
      const results = [
        {
          id: "call_123",
          name: "test_tool",
          content: { result: "success", data: [1, 2, 3] },
          isError: false,
        },
      ];
      const toolCalls: CommonToolCall[] = [
        { id: "call_123", name: "test_tool", arguments: {} },
      ];

      const messages = toolResultsToMessages(results, toolCalls);

      expect(messages[0].name).toBe("test_tool");
      expect(messages[0].response).toEqual({
        result: "success",
        data: [1, 2, 3],
      });
    });

    test("converts error tool results to function responses", () => {
      const results = [
        {
          id: "call_456",
          name: "test_tool",
          content: null,
          isError: true,
          error: "Tool execution failed",
        },
      ];
      const toolCalls: CommonToolCall[] = [
        { id: "call_456", name: "test_tool", arguments: {} },
      ];

      const messages = toolResultsToMessages(results, toolCalls);

      expect(messages[0].name).toBe("test_tool");
      expect(messages[0].response).toEqual({
        error: "Tool execution failed",
      });
    });

    test("handles string content", () => {
      const results = [
        {
          id: "call_str",
          name: "test_tool",
          content: "simple string response",
          isError: false,
        },
      ];
      const toolCalls: CommonToolCall[] = [
        { id: "call_str", name: "test_tool", arguments: {} },
      ];

      const messages = toolResultsToMessages(results, toolCalls);

      expect(messages[0].name).toBe("test_tool");
      expect(messages[0].response).toEqual({
        result: "simple string response",
      });
    });

    test("converts MCP image blocks to Gemini inlineData format", () => {
      const results = [
        {
          id: "call_screenshot",
          name: "browser_take_screenshot",
          content: [
            { type: "text", text: "Screenshot captured" },
            {
              type: "image",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              mimeType: "image/png",
            },
          ],
          isError: false,
        },
      ];
      const toolCalls: CommonToolCall[] = [
        {
          id: "call_screenshot",
          name: "browser_take_screenshot",
          arguments: {},
        },
      ];

      const messages = toolResultsToMessages(results, toolCalls);

      expect(messages).toHaveLength(1);
      expect(messages[0].name).toBe("browser_take_screenshot");

      const response = messages[0].response as {
        text: string;
        images: Array<{ inlineData: { mimeType: string; data: string } }>;
      };
      expect(response.text).toBe("Screenshot captured");
      expect(response.images).toHaveLength(1);
      expect(response.images[0]).toEqual({
        inlineData: {
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      });
    });

    test("handles image-only tool result", () => {
      const results = [
        {
          id: "call_img_only",
          name: "browser_take_screenshot",
          content: [
            {
              type: "image",
              data: "base64data",
              mimeType: "image/jpeg",
            },
          ],
          isError: false,
        },
      ];
      const toolCalls: CommonToolCall[] = [
        { id: "call_img_only", name: "browser_take_screenshot", arguments: {} },
      ];

      const messages = toolResultsToMessages(results, toolCalls);

      const response = messages[0].response as {
        text: string;
        images: Array<{ inlineData: { mimeType: string; data: string } }>;
      };
      expect(response.text).toBe("");
      expect(response.images).toHaveLength(1);
      expect(response.images[0]).toEqual({
        inlineData: {
          mimeType: "image/jpeg",
          data: "base64data",
        },
      });
    });

    test("uses default mime type when not provided", () => {
      const results = [
        {
          id: "call_no_mime",
          name: "browser_take_screenshot",
          content: [
            {
              type: "image",
              data: "base64data",
              // No mimeType provided
            },
          ],
          isError: false,
        },
      ];
      const toolCalls: CommonToolCall[] = [
        { id: "call_no_mime", name: "browser_take_screenshot", arguments: {} },
      ];

      const messages = toolResultsToMessages(results, toolCalls);

      const response = messages[0].response as {
        images: Array<{ inlineData: { mimeType: string; data: string } }>;
      };
      expect(response.images[0]).toEqual({
        inlineData: {
          mimeType: "image/png",
          data: "base64data",
        },
      });
    });

    test("uses 'unknown' name when tool call not found", () => {
      const results = [
        {
          id: "call_unknown",
          name: "test_tool",
          content: { data: "test" },
          isError: false,
        },
      ];
      const toolCalls: CommonToolCall[] = [];

      const messages = toolResultsToMessages(results, toolCalls);

      expect(messages[0].name).toBe("unknown");
    });
  });
});
