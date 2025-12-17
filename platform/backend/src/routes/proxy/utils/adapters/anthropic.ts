/**
 * @deprecated LEGACY ADAPTER - Used only by LLM Proxy v1 routes
 *
 * This adapter is used by the legacy v1 Anthropic route handler:
 * - src/routes/proxy/anthropic.ts
 *
 * The new unified LLM proxy handler (src/routes/proxy/llm-proxy-handler.ts)
 * is now the default and uses the new adapter system:
 * - src/routes/proxy/adapterV2/anthropic.ts
 *
 * V2 routes are located at:
 * - src/routes/proxy/routesv2/anthropic.ts
 *
 * This file should be removed after full migration to v2 routes.
 */
import { encode as toonEncode } from "@toon-format/toon";
import logger from "@/logging";
import type {
  Anthropic,
  CommonMessage,
  CommonToolCall,
  CommonToolResult,
  ToolResultUpdates,
} from "@/types";

type AnthropicMessages = Anthropic.Types.MessagesRequest["messages"];

type AnthropicToolResultImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
};

type AnthropicToolResultTextBlock = {
  type: "text";
  text: string;
};

type AnthropicToolResultContentBlock =
  | AnthropicToolResultImageBlock
  | AnthropicToolResultTextBlock;

type AnthropicToolResultContent = string | AnthropicToolResultContentBlock[];

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Convert Anthropic messages to common format for trusted data evaluation
 */
export function toCommonFormat(messages: AnthropicMessages): CommonMessage[] {
  logger.debug(
    { messageCount: messages.length },
    "[adapters/anthropic] toCommonFormat: starting conversion",
  );
  const commonMessages: CommonMessage[] = [];

  for (const message of messages) {
    const commonMessage: CommonMessage = {
      role: message.role as CommonMessage["role"],
    };

    // Handle user messages that may contain tool results
    if (message.role === "user" && Array.isArray(message.content)) {
      const toolCalls: CommonToolResult[] = [];

      for (const contentBlock of message.content) {
        if (contentBlock.type === "tool_result") {
          // Find the tool name from previous assistant messages
          const toolName = extractToolNameFromMessages(
            messages,
            contentBlock.tool_use_id,
          );

          if (toolName) {
            logger.debug(
              { toolUseId: contentBlock.tool_use_id, toolName },
              "[adapters/anthropic] toCommonFormat: found tool result",
            );
            // Parse the tool result
            let toolResult: unknown;
            if (typeof contentBlock.content === "string") {
              try {
                toolResult = JSON.parse(contentBlock.content);
              } catch {
                toolResult = contentBlock.content;
              }
            } else {
              toolResult = contentBlock.content;
            }

            toolCalls.push({
              id: contentBlock.tool_use_id,
              name: toolName,
              content: toolResult,
              isError: false,
            });
          }
        }
      }

      if (toolCalls.length > 0) {
        commonMessage.toolCalls = toolCalls;
        logger.debug(
          { toolCallCount: toolCalls.length },
          "[adapters/anthropic] toCommonFormat: attached tool calls to message",
        );
      }
    }

    commonMessages.push(commonMessage);
  }

  logger.debug(
    { inputCount: messages.length, outputCount: commonMessages.length },
    "[adapters/anthropic] toCommonFormat: conversion complete",
  );
  return commonMessages;
}

/**
 * Apply tool result updates back to Anthropic messages
 */
export function applyUpdates(
  messages: AnthropicMessages,
  updates: ToolResultUpdates,
): AnthropicMessages {
  const updateCount = Object.keys(updates).length;
  logger.debug(
    { messageCount: messages.length, updateCount },
    "[adapters/anthropic] applyUpdates: starting",
  );

  if (updateCount === 0) {
    logger.debug("[adapters/anthropic] applyUpdates: no updates to apply");
    return messages;
  }

  let appliedCount = 0;
  const result = messages.map((message) => {
    // Only process user messages with content arrays
    if (message.role === "user" && Array.isArray(message.content)) {
      const updatedContent = message.content.map((contentBlock) => {
        if (
          contentBlock.type === "tool_result" &&
          updates[contentBlock.tool_use_id]
        ) {
          appliedCount++;
          logger.debug(
            { toolUseId: contentBlock.tool_use_id },
            "[adapters/anthropic] applyUpdates: applying update to tool result",
          );
          return {
            ...contentBlock,
            content: updates[contentBlock.tool_use_id],
          };
        }
        return contentBlock;
      });

      return {
        ...message,
        content: updatedContent,
      };
    }

    return message;
  });

  logger.debug(
    { updateCount, appliedCount },
    "[adapters/anthropic] applyUpdates: complete",
  );
  return result;
}

/**
 * Extract tool name from messages by finding the assistant message
 * that contains the tool_use_id
 */
function extractToolNameFromMessages(
  messages: AnthropicMessages,
  toolUseId: string,
): string | null {
  // Find the most recent assistant message with tool_use blocks
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.length > 0
    ) {
      for (const content of message.content) {
        if (content.type === "tool_use") {
          if (content.id === toolUseId) {
            return content.name;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Convert Anthropic tool use blocks to common format for MCP execution
 */
export function toolCallsToCommon(
  toolUseBlocks: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>,
): CommonToolCall[] {
  return toolUseBlocks.map((toolUse) => ({
    id: toolUse.id,
    name: toolUse.name,
    arguments: toolUse.input,
  }));
}

/**
 * Check if content array contains image blocks from MCP
 */
function hasImageContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (item) => isMcpImageBlock(item) || isAnthropicImageBlock(item),
  );
}

function isMcpImageBlock(
  item: unknown,
): item is { type: "image"; data: string; mimeType?: string } {
  if (typeof item !== "object" || item === null) return false;
  if (!("type" in item) || item.type !== "image") return false;
  return "data" in item && typeof item.data === "string";
}

function isAnthropicImageBlock(
  item: unknown,
): item is AnthropicToolResultImageBlock {
  if (typeof item !== "object" || item === null) return false;
  if (!("type" in item) || item.type !== "image") return false;
  if (
    !("source" in item) ||
    typeof item.source !== "object" ||
    item.source === null
  ) {
    return false;
  }

  const source = item.source as Record<string, unknown>;
  return (
    source.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  );
}

function isAnthropicTextBlock(
  item: unknown,
): item is AnthropicToolResultTextBlock {
  if (typeof item !== "object" || item === null) return false;
  if (!("type" in item) || item.type !== "text") return false;
  return "text" in item && typeof item.text === "string";
}

/**
 * Convert MCP content array to Anthropic tool_result content format
 * Handles both text and image content blocks
 */
function convertMcpContentToAnthropic(
  content: unknown,
): AnthropicToolResultContent {
  if (!Array.isArray(content)) {
    return JSON.stringify(content);
  }

  // Check if there are any image blocks
  if (!hasImageContent(content)) {
    // No images, just stringify
    return JSON.stringify(content);
  }

  // Convert to Anthropic content blocks format
  const anthropicContent: AnthropicToolResultContentBlock[] = [];

  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;

    if (isMcpImageBlock(item)) {
      const mimeType =
        "mimeType" in item && typeof item.mimeType === "string"
          ? item.mimeType
          : "image/png";
      anthropicContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: item.data,
        },
      });
    } else if (isAnthropicImageBlock(item)) {
      anthropicContent.push(item);
    } else if (isAnthropicTextBlock(item)) {
      anthropicContent.push(item);
    } else if ("type" in item && item.type === "text" && "text" in item) {
      anthropicContent.push({
        type: "text",
        text: typeof item.text === "string" ? item.text : JSON.stringify(item),
      });
    }
  }

  return anthropicContent.length > 0
    ? anthropicContent
    : JSON.stringify(content);
}

/**
 * Convert common tool results to Anthropic user message with tool_result blocks
 */
export function toolResultsToMessages(
  results: CommonToolResult[],
  convertToToon = false,
): Array<{
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: AnthropicToolResultContent;
    is_error?: boolean;
  }>;
}> {
  if (results.length === 0) {
    return [];
  }

  return [
    {
      role: "user" as const,
      content: results.map((result) => {
        let content: AnthropicToolResultContent;
        if (result.isError) {
          content = `Error: ${result.error || "Tool execution failed"}`;
        } else if (hasImageContent(result.content)) {
          // Handle image content - convert to Anthropic format
          content = convertMcpContentToAnthropic(result.content);
          logger.info(
            {
              toolName: result.name,
              toolCallId: result.id,
              hasImages: true,
            },
            "Tool result contains images, converting to Anthropic image blocks",
          );
        } else if (convertToToon) {
          const beforeJson = JSON.stringify(result.content);
          const afterToon = toonEncode(result.content);
          logger.info(
            {
              toolName: result.name,
              toolCallId: result.id,
              beforeLength: beforeJson.length,
              afterLength: afterToon.length,
              compressionRatio: (
                (1 - afterToon.length / beforeJson.length) *
                100
              ).toFixed(2),
            },
            "TOON conversion completed",
          );
          logger.debug(
            {
              toolName: result.name,
              toolCallId: result.id,
              before: beforeJson,
              after: afterToon,
            },
            "TOON conversion before/after",
          );
          content = afterToon;
        } else {
          content = JSON.stringify(result.content);
        }

        return {
          type: "tool_result" as const,
          tool_use_id: result.id,
          content,
          is_error: result.isError,
        };
      }),
    },
  ];
}

/** Returns input and output usage tokens */
export function getUsageTokens(usage: Anthropic.Types.Usage) {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
  };
}
