import { MCP_CATALOG_API_BASE_URL, RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type BuiltinMcpServer,
  findBuiltinServer,
  getBuiltinCategories,
  getFilteredBuiltinServers,
} from "@/builtin-mcp-registry";
// Import to trigger registration of built-in servers
import "@/builtin-mcp-registry/servers";
import { constructResponseSchema } from "@/types";

// Response schemas for catalog proxy
const CatalogServerSchema = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
  })
  .passthrough(); // Allow additional fields from external catalog

type CatalogServer = z.infer<typeof CatalogServerSchema>;

const SearchCatalogResponseSchema = z.object({
  servers: z.array(CatalogServerSchema),
  totalCount: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  hasMore: z.boolean().optional(),
});

type SearchCatalogResponse = z.infer<typeof SearchCatalogResponseSchema>;

const CategoriesResponseSchema = z.object({
  categories: z.array(z.string()),
});

type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;

/**
 * Error response type for 404 not found errors
 */
type NotFoundErrorResponse = {
  error: {
    message: string;
    type: "api_not_found_error";
  };
};

/**
 * Creates a not found error response
 */
function createNotFoundError(message: string): NotFoundErrorResponse {
  return {
    error: {
      message,
      type: "api_not_found_error",
    },
  };
}

/**
 * Converts a BuiltinMcpServer to a CatalogServer for API responses.
 * Strips internal fields like tool_calling_policy that shouldn't be exposed.
 */
function toCatalogServer(server: BuiltinMcpServer): CatalogServer {
  return {
    name: server.name,
    display_name: server.display_name,
    description: server.description,
    category: server.category,
    author: server.author,
    server: server.server,
    readme: server.readme,
    quality_score: server.quality_score,
    github_info: server.github_info,
    user_config: server.user_config,
    oauth_config: server.oauth_config,
    icon: server.icon,
    homepage: server.homepage,
    documentation: server.documentation,
    // Note: tool_calling_policy is intentionally excluded from external API
  };
}

const archestraCatalogProxyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Proxy search endpoint with built-in injection
  // Path matches external API: /search (accessed via /api/archestra-catalog/search)
  fastify.get(
    "/api/archestra-catalog/search",
    {
      schema: {
        operationId: RouteId.SearchArchestraCatalog,
        description: "Search Archestra MCP catalog with built-in servers",
        tags: ["Archestra Catalog"],
        querystring: z.object({
          q: z.string().optional(),
          category: z.string().optional(),
          limit: z.coerce.number().optional().default(50),
          offset: z.coerce.number().optional().default(0),
          sortBy: z.string().optional(),
        }),
        response: constructResponseSchema(SearchCatalogResponseSchema),
      },
    },
    async (request, reply) => {
      const { q, category, limit, offset, sortBy } = request.query;

      // Fetch from external catalog
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      if (sortBy) params.set("sortBy", sortBy);

      let externalServers: CatalogServer[] = [];
      let totalCount: number | undefined;
      let responseLimit: number | undefined;
      let responseOffset: number | undefined;
      let hasMore: boolean | undefined;

      try {
        const externalResponse = await fetch(
          `${MCP_CATALOG_API_BASE_URL}/search?${params}`,
        );
        if (externalResponse.ok) {
          const externalData: SearchCatalogResponse =
            await externalResponse.json();
          externalServers = externalData.servers;
          totalCount = externalData.totalCount;
          responseLimit = externalData.limit;
          responseOffset = externalData.offset;
          hasMore = externalData.hasMore;
        } else {
          fastify.log.warn(
            `External catalog returned status ${externalResponse.status}`,
          );
        }
      } catch (error) {
        fastify.log.warn(
          `Failed to fetch from external catalog: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      // Get matching built-in servers
      const builtinServers = getFilteredBuiltinServers({
        query: q,
        category,
      });

      // Build final server list
      let servers: CatalogServer[];
      if (offset === 0 && builtinServers.length > 0) {
        // Inject built-in servers at the beginning (first page only)
        servers = [...builtinServers.map(toCatalogServer), ...externalServers];
        totalCount = (totalCount ?? 0) + builtinServers.length;
      } else {
        servers = externalServers;
      }

      const response: SearchCatalogResponse = {
        servers,
        totalCount,
        limit: responseLimit,
        offset: responseOffset,
        hasMore,
      };

      return reply.send(response);
    },
  );

  // Get server by name
  // Path matches external API: /server/{name} (accessed via /api/archestra-catalog/server/:name)
  fastify.get(
    "/api/archestra-catalog/server/:name",
    {
      schema: {
        operationId: RouteId.GetArchestraCatalogServer,
        description: "Get Archestra catalog server by name",
        tags: ["Archestra Catalog"],
        params: z.object({
          name: z.string(),
        }),
        response: constructResponseSchema(CatalogServerSchema),
      },
    },
    async (request, reply) => {
      const { name } = request.params;

      // Check built-in registry first
      const builtinServer = findBuiltinServer(name);
      if (builtinServer) {
        return reply.send(toCatalogServer(builtinServer));
      }

      // Otherwise proxy to external
      try {
        const externalResponse = await fetch(
          `${MCP_CATALOG_API_BASE_URL}/server/${encodeURIComponent(name)}`,
        );
        if (externalResponse.ok) {
          const externalData: CatalogServer = await externalResponse.json();
          return reply.send(externalData);
        }
        return reply
          .status(404)
          .send(createNotFoundError(`Server not found: ${name}`));
      } catch (error) {
        fastify.log.warn(
          `Failed to fetch server from external catalog: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        return reply
          .status(404)
          .send(createNotFoundError(`Server not found: ${name}`));
      }
    },
  );

  // Get categories (merge built-in + external)
  // Path matches external API: /category (accessed via /api/archestra-catalog/category)
  fastify.get(
    "/api/archestra-catalog/category",
    {
      schema: {
        operationId: RouteId.GetArchestraCatalogCategories,
        description: "Get all Archestra catalog categories",
        tags: ["Archestra Catalog"],
        response: constructResponseSchema(CategoriesResponseSchema),
      },
    },
    async (_request, reply) => {
      let externalCategories: string[] = [];

      try {
        const externalResponse = await fetch(
          `${MCP_CATALOG_API_BASE_URL}/category`,
        );
        if (externalResponse.ok) {
          const externalData = await externalResponse.json();
          externalCategories = externalData.categories || [];
        }
      } catch (error) {
        fastify.log.warn(
          `Failed to fetch categories from external catalog: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      // Merge with built-in categories
      const builtinCategories = getBuiltinCategories();
      const allCategories = new Set([
        ...externalCategories,
        ...builtinCategories,
      ]);

      const response: CategoriesResponse = {
        categories: Array.from(allCategories).sort(),
      };
      return reply.send(response);
    },
  );
};

export default archestraCatalogProxyRoutes;
