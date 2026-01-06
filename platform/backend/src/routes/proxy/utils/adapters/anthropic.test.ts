import { describe, expect, test } from "@/test";
import { toolCallsToCommon, toolResultsToMessages } from "./anthropic";

describe("Anthropic MCP Adapters", () => {
  describe("toolCallsToCommon", () => {
    test("converts tool use blocks to common format", () => {
      const toolUseBlocks = [
        {
          id: "tool_123",
          name: "github_mcp_server__list_issues",
          input: {
            repo: "archestra-ai/archestra",
            count: 5,
          },
        },
      ];

      const result = toolCallsToCommon(toolUseBlocks);

      expect(result).toEqual([
        {
          id: "tool_123",
          name: "github_mcp_server__list_issues",
          arguments: {
            repo: "archestra-ai/archestra",
            count: 5,
          },
        },
      ]);
    });

    test("handles multiple tool use blocks", () => {
      const toolUseBlocks = [
        {
          id: "tool_1",
          name: "tool_one",
          input: { param: "value1" },
        },
        {
          id: "tool_2",
          name: "tool_two",
          input: { param: "value2" },
        },
      ];

      const result = toolCallsToCommon(toolUseBlocks);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "tool_1",
        name: "tool_one",
        arguments: { param: "value1" },
      });
      expect(result[1]).toEqual({
        id: "tool_2",
        name: "tool_two",
        arguments: { param: "value2" },
      });
    });

    test("handles empty input", () => {
      const toolUseBlocks = [
        {
          id: "tool_empty",
          name: "empty_tool",
          input: {},
        },
      ];

      const result = toolCallsToCommon(toolUseBlocks);

      expect(result).toEqual([
        {
          id: "tool_empty",
          name: "empty_tool",
          arguments: {},
        },
      ]);
    });
  });

  describe("toolResultsToMessages", () => {
    test("returns empty array for no results", () => {
      const messages = toolResultsToMessages([]);
      expect(messages).toEqual([]);
    });

    test("converts successful tool results to user message with tool_result blocks", () => {
      const results = [
        {
          id: "tool_123",
          name: "github_mcp_server__list_issues",
          content: {
            issues: [
              { number: 1, title: "First issue" },
              { number: 2, title: "Second issue" },
            ],
          },
          isError: false,
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content:
                '{"issues":[{"number":1,"title":"First issue"},{"number":2,"title":"Second issue"}]}',
              is_error: false,
            },
          ],
        },
      ]);
    });

    test("converts error tool results to user message", () => {
      const results = [
        {
          id: "tool_456",
          name: "github_mcp_server__list_issues",
          content: null,
          isError: true,
          error: "GitHub API rate limit exceeded",
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_456",
              content: "Error: GitHub API rate limit exceeded",
              is_error: true,
            },
          ],
        },
      ]);
    });

    test("handles multiple tool results in single message", () => {
      const results = [
        {
          id: "tool_1",
          name: "test_tool",
          content: "success",
          isError: false,
        },
        {
          id: "tool_2",
          name: "test_tool",
          content: null,
          isError: true,
          error: "Failed",
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: '"success"',
              is_error: false,
            },
            {
              type: "tool_result",
              tool_use_id: "tool_2",
              content: "Error: Failed",
              is_error: true,
            },
          ],
        },
      ]);
    });

    test("handles tool result without error message", () => {
      const results = [
        {
          id: "tool_no_msg",
          name: "test_tool",
          content: null,
          isError: true,
        },
      ];

      const messages = toolResultsToMessages(results);

      expect(messages[0].content[0].content).toBe(
        "Error: Tool execution failed",
      );
    });

    test("converts MCP image blocks to Anthropic image format", () => {
      const results = [
        {
          id: "tool_screenshot",
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
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toHaveLength(1);
      expect(messages[0].content[0].type).toBe("tool_result");
      expect(messages[0].content[0].tool_use_id).toBe("tool_screenshot");
      expect(messages[0].content[0].is_error).toBe(false);

      // Content should be an array with text and image blocks
      const content = messages[0].content[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);

      // Check text block
      expect(content[0]).toEqual({
        type: "text",
        text: "Screenshot captured",
      });

      // Check image block - should be converted to Anthropic format
      expect(content[1]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      });
    });

    test("handles image-only tool result", () => {
      const results = [
        {
          id: "tool_img_only",
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

      const content = messages[0].content[0].content;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: "base64data",
        },
      });
    });
  });
});
