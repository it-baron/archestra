import type { archestraCatalogTypes } from "@shared";

/**
 * Extended manifest with tool calling policy configuration.
 * Uses Pick to only require the essential fields for built-in servers.
 */
export interface BuiltinMcpServer
  extends Pick<
    archestraCatalogTypes.ArchestraMcpServerManifest,
    | "name"
    | "display_name"
    | "description"
    | "author"
    | "server"
    | "category"
    | "readme"
    | "quality_score"
    | "github_info"
    | "user_config"
    | "oauth_config"
  > {
  icon?: string;
  homepage?: string;
  documentation?: string;
  /**
   * Tool calling policy configuration for this server.
   * Defines how security policies should be configured when the server is installed.
   */
  tool_calling_policy?: {
    /**
     * If true, show policy configuration dialog after adding to registry.
     * Used for servers that need special security policies (e.g., browser automation).
     */
    prompt_on_install?: boolean;
    /**
     * Policy preset to apply (e.g., "browser", "filesystem", etc.)
     * Used by the policy configuration endpoint to determine which policies to create.
     */
    preset?: string;
  };
}

/**
 * Registry of built-in MCP servers provided by Archestra.
 * These are injected into the external catalog results.
 */
export const builtinMcpServers: BuiltinMcpServer[] = [];

/**
 * Register a built-in MCP server
 */
export function registerBuiltinMcpServer(server: BuiltinMcpServer): void {
  builtinMcpServers.push(server);
}

/**
 * Get all built-in servers matching search/category filters
 */
export function getFilteredBuiltinServers(options: {
  query?: string;
  category?: string;
}): BuiltinMcpServer[] {
  const { query, category } = options;
  const q = query?.toLowerCase();

  return builtinMcpServers.filter((server) => {
    // Check search query
    if (q) {
      const matchesQuery =
        server.name.toLowerCase().includes(q) ||
        (server.display_name?.toLowerCase().includes(q) ?? false) ||
        (server.description?.toLowerCase().includes(q) ?? false);
      if (!matchesQuery) return false;
    }

    // Check category
    if (category && category !== "all") {
      if (server.category !== category) return false;
    }

    return true;
  });
}

/**
 * Find a built-in server by name
 */
export function findBuiltinServer(name: string): BuiltinMcpServer | undefined {
  return builtinMcpServers.find((s) => s.name === name);
}

/**
 * Get all unique categories from built-in servers
 */
export function getBuiltinCategories(): string[] {
  const categories = new Set<string>();
  for (const server of builtinMcpServers) {
    if (server.category) {
      categories.add(server.category);
    }
  }
  return Array.from(categories);
}
