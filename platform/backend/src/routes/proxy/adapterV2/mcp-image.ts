export type McpImageBlock = {
  type: "image";
  data: string;
  mimeType?: string;
};

/**
 * Check if item is an MCP image block.
 */
export function isMcpImageBlock(item: unknown): item is McpImageBlock {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Record<string, unknown>;
  if (candidate.type !== "image") return false;
  return typeof candidate.data === "string";
}

/**
 * Check if content contains image blocks (defaults to MCP image blocks).
 */
export function hasImageContent(
  content: unknown,
  isImageBlock: (item: unknown) => boolean = isMcpImageBlock,
): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((item) => isImageBlock(item));
}
