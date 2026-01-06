import { describe, expect, test } from "@/test";
import { toolCallsToCommon, toolResultsToMessages } from "./openai";

describe("OpenAI MCP Adapters", () => {
  describe("toolCallsToCommon", () => {
    test("converts function tool calls to common format", () => {
      const toolCalls = [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "test_tool",
            arguments: '{"param1": "value1", "param2": 42}',
          },
        },
      ];

      const result = toolCallsToCommon(toolCalls);

      expect(result).toEqual([
        {
          id: "call_123",
          name: "test_tool",
          arguments: { param1: "value1", param2: 42 },
        },
      ]);
    });

    test("converts custom tool calls to common format", () => {
      const toolCalls = [
        {
          id: "call_456",
          type: "custom",
          custom: {
            name: "custom_tool",
            input: '{"data": "test"}',
          },
        },
      ];

      const result = toolCallsToCommon(toolCalls);

      expect(result).toEqual([
        {
          id: "call_456",
          name: "custom_tool",
          arguments: { data: "test" },
        },
      ]);
    });

    test("handles invalid JSON in arguments gracefully", () => {
      const toolCalls = [
        {
          id: "call_789",
          type: "function",
          function: {
            name: "broken_tool",
            arguments: "invalid json{",
          },
        },
      ];

      const result = toolCallsToCommon(toolCalls);

      expect(result).toEqual([
        {
          id: "call_789",
          name: "broken_tool",
          arguments: {},
        },
      ]);
    });

    test("handles unknown tool type", () => {
      const toolCalls = [
        {
          id: "call_unknown",
          type: "unknown",
        },
      ];

      const result = toolCallsToCommon(toolCalls);

      expect(result).toEqual([
        {
          id: "call_unknown",
          name: "unknown",
          arguments: {},
        },
      ]);
    });
  });

  describe("toolResultsToMessages", () => {
    test("converts successful tool results to messages", () => {
      const results = [
        {
          id: "call_123",
          name: "test_tool",
          content: { result: "success", data: [1, 2, 3] },
          isError: false,
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages).toEqual([
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"result":"success","data":[1,2,3]}',
        },
      ]);
    });

    test("converts error tool results to messages", () => {
      const results = [
        {
          id: "call_456",
          name: "test_tool",
          content: null,
          isError: true,
          error: "Tool execution failed",
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages).toEqual([
        {
          role: "tool",
          tool_call_id: "call_456",
          content: "Error: Tool execution failed",
        },
      ]);
    });

    test("handles multiple tool results", () => {
      const results = [
        {
          id: "call_1",
          name: "test_tool",
          content: "simple text",
          isError: false,
        },
        {
          id: "call_2",
          name: "test_tool",
          content: null,
          isError: true,
          error: "Network timeout",
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: '"simple text"',
      });
      expect(messages[1]).toEqual({
        role: "tool",
        tool_call_id: "call_2",
        content: "Error: Network timeout",
      });
    });

    test("converts MCP image blocks to OpenAI image_url format", () => {
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

      const messages = toolResultsToMessages(results);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("tool");
      expect(messages[0].tool_call_id).toBe("call_screenshot");

      // Content should be an array with text and image blocks
      const content = messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);

      // Check text block
      expect(content[0]).toEqual({
        type: "text",
        text: "Screenshot captured",
      });

      // Check image block - should be converted to OpenAI image_url format
      expect(content[1]).toEqual({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
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

      const messages = toolResultsToMessages(results);

      const content = messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: "image_url",
        image_url: {
          url: "data:image/jpeg;base64,base64data",
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

      const messages = toolResultsToMessages(results);

      const content = messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toEqual({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,base64data",
        },
      });
    });
  });
});
