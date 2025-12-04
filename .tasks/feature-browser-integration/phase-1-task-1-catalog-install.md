# Phase 1 - Task 1: Add Browser MCP to Catalog with Security Policy Dialog

**Goal**: User should be able to add "Archestra Browser" from the **Online Catalog** to their private registry (Internal MCP Catalog), with security policy configuration dialog.

**Priority**: Critical
**Dependencies**: None
**Status**: Not Started

---

## Objective

When a user installs "Archestra Browser" from the MCP Catalog, they should:
1. See the browser MCP server in the **Online Catalog** (injected via backend proxy from built-in registry)
2. Click **"Add to Your Registry"** to add it to their **Internal MCP Catalog** (private registry)
3. Be prompted with a security policy configuration dialog
4. Choose to accept recommended policies or skip
5. Then install the MCP server from their registry

> **IMPORTANT**: The browser MCP server is **NOT seeded** to the database. It is:
> - Stored in the **built-in registry** (`backend/src/builtin-mcp-registry/`)
> - Surfaced in the **Online Catalog** via the backend proxy
> - Added to the **Internal MCP Catalog** (database) only after user clicks "Add to Your Registry"

---

## Deliverables

- [ ] 1.1.1 - Create `platform/browser-mcp-server/` package structure
- [ ] 1.1.2 - Implement MCP server with Playwright integration (7 tools)
- [ ] 1.1.3 - Create catalog proxy adapter to inject "Archestra Browser" entry
- [ ] 1.1.4 - Create security policy configuration dialog
- [ ] 1.1.5 - Add `tool_calling_policy` to Internal Catalog Schema and Model
- [ ] 1.1.6 - Add tests (unit tests for MCP server, integration tests for policies)

---

## Task 1.1.1: Create Package Structure

Create `platform/browser-mcp-server/` with TypeScript configuration.

### Files to Create

```
platform/browser-mcp-server/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── server.ts           # MCP server entry point (streamable-http)
│   ├── browser-manager.ts  # Playwright session management
│   ├── tools/
│   │   ├── index.ts
│   │   ├── navigate.ts
│   │   ├── screenshot.ts
│   │   ├── click.ts
│   │   ├── type.ts
│   │   ├── get-content.ts
│   │   ├── scroll.ts
│   │   ├── fill-and-submit.ts
│   └── types.ts
└── tests/
    └── browser-manager.test.ts
```

### package.json

> **ALIGNMENT NOTE**: Match versions from `backend/package.json` for consistency. Use `tsdown` instead of `tsc` for build (matches backend pattern). Remove `express` - use Node.js built-in `http` module with MCP SDK's `StreamableHTTPServerTransport`.

```json
{
  "name": "@archestra/browser-mcp-server",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/server.mjs",
  "bin": {
    "browser-mcp-server": "./dist/server.mjs"
  },
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "start": "node dist/server.mjs",
    "test": "vitest",
    "lint": "biome check",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.22.0",
    "playwright": "^1.50.0",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "tsdown": "^0.16.6",
    "typescript": "^5.9.2",
    "vitest": "^4.0.10"
  }
}
```

### Modify pnpm-workspace.yaml

```yaml
packages:
  - "backend"
  - "frontend"
  - "shared"
  - "e2e-tests"
  - "browser-mcp-server"
```

---

## Task 1.1.2: Implement MCP Server

Implement the 7 browser tools with session management using `streamable-http` transport.

### Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_screenshot` | Take screenshot (returns base64) |
| `browser_click` | Click element by selector |
| `browser_type` | Type text into element |
| `browser_get_content` | Get page content (text or HTML) |
| `browser_scroll` | Scroll page up/down |
| `browser_fill_and_submit` | Fill form fields and submit |

### Session Management

- 30-minute TTL with auto-cleanup
- Session timeout resets on tool call
- Session ID injected by dispatcher (agent is unaware of sessions - dispatcher adds sessionId to tool arguments transparently)
- Session ID format: `browser-{profileId}-{conversationId}` where both are UUIDs (generated and injected by dispatcher)
- Example: `browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7`
- One browser instance per session. Session is a conversation lifetime with timeout. Each conversation has its own session.
- On timeout, the session should be automatically recreated per conversation.
- Sessions stored in `Map<string, { browser: Browser; page: Page; lastAccess: Date }>`

### Server Implementation Pattern

> **ALIGNMENT NOTE**: Use `StreamableHTTPServerTransport` from MCP SDK (not express). Server listens on `MCP_HTTP_PORT` (default 8080) at `MCP_HTTP_PATH` (default /mcp).

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { registerTools } from "./tools/index.js";
import { BrowserManager } from "./browser-manager.js";

const PORT = Number(process.env.MCP_HTTP_PORT) || 8080;
const PATH = process.env.MCP_HTTP_PATH || "/mcp";

const browserManager = new BrowserManager();
const server = new McpServer({
  name: "archestra-browser",
  version: "0.0.1",
});

registerTools(server, browserManager);

const httpServer = createServer();
const transport = new StreamableHTTPServerTransport({
  path: PATH,
  httpServer,
});

await server.connect(transport);
httpServer.listen(PORT, () => {
  console.log(`Browser MCP server listening on port ${PORT}${PATH}`);
});
```

---

## Task 1.1.3: Create Built-in MCP Registry with Backend Proxy

> **APPROACH**: Create a built-in registry in the backend and a proxy route that fetches from the external catalog and merges built-in servers. The frontend Next.js rewrite is updated to point to this backend route instead of directly to the external catalog.

### Architecture

```
Frontend  →  Next.js Rewrite  →  Backend Route  →  External Catalog (archestra.ai)
                                      ↓
                               Merge with Built-in Registry
                                      ↓
                               Return combined results
```

### Why Backend Proxy?
- **Server-side registry**: Built-in server definitions stay in backend
- **Extensible**: Easy to add auth, org-specific filtering, or other server-side logic later
- **Single source of truth**: Backend controls what built-in servers are available

### Create Built-in MCP Registry (ADDITIVE)

Create `platform/backend/src/builtin-mcp-registry/index.ts`:

```typescript
import type { archestraCatalogTypes } from "@shared";

/**
 * Extended manifest with tool calling policy configuration
 */
export interface BuiltinMcpServer extends archestraCatalogTypes.ArchestraMcpServerManifest {
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
```

### Register Archestra Browser (ADDITIVE)

Create `platform/backend/src/builtin-mcp-registry/servers/archestra-browser.ts`:

```typescript
import { registerBuiltinMcpServer } from "../index";

// IMPORTANT: Use command: "docker" to trigger the docker_image parsing path
// in archestra-catalog-tab.tsx's handleAddToCatalog function.
// If command is not "docker", the docker_image field is ignored.
registerBuiltinMcpServer({
  name: "archestra-browser",
  display_name: "Archestra Browser",
  description:
    "Browse the web with AI assistance. Provides browser automation using Playwright for navigation, screenshots, clicking, typing, and form submission.",
  category: "Browser Automation",
  icon: undefined,
  author: {
    name: "Archestra",
    url: "https://archestra.ai",
  },
  server: {
    type: "local",
    // Use "docker" command format so handleAddToCatalog preserves docker_image
    command: "docker",
    args: [
      "run", "-i", "--rm",
      "mcr.microsoft.com/playwright:v1.50.0-noble",
      "npx", "-y", "@archestra/browser-mcp-server"
    ],
    docker_image: "mcr.microsoft.com/playwright:v1.50.0-noble",
    env: {
      MCP_HTTP_PORT: "8080",
      MCP_HTTP_PATH: "/mcp",
    },
  },
  homepage: "https://archestra.ai",
  documentation: undefined,
  readme: null,
  quality_score: null,
  github_info: null, // Built-in server, no GitHub repo
  user_config: undefined,
  oauth_config: undefined,
  // Tool calling policy configuration (custom extension, not in external catalog types)
  tool_calling_policy: {
    prompt_on_install: true,
    preset: "browser",
  },
});
```

### Auto-register All Built-in Servers (ADDITIVE)

Create `platform/backend/src/builtin-mcp-registry/servers/index.ts`:

```typescript
// Import all built-in server registrations
// Each file registers itself when imported
import "./archestra-browser";

// Add more built-in servers here:
// import "./another-builtin-server";
```

### Create Catalog Proxy Route (ADDITIVE)

Create `platform/backend/src/routes/archestra-catalog-proxy.ts`:

> **ALIGNMENT NOTE**: Use `RouteId`, `constructResponseSchema`, and `ApiError` patterns consistent with existing routes.

```typescript
import { RouteId, MCP_CATALOG_API_BASE_URL } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  findBuiltinServer,
  getBuiltinCategories,
  getFilteredBuiltinServers,
} from "@/builtin-mcp-registry";
// Import to trigger registration
import "@/builtin-mcp-registry/servers";
import { constructResponseSchema } from "@/types";

// Response schemas for catalog proxy
const CatalogServerSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  category: z.string(),
  // ... other fields from ArchestraMcpServerManifest
}).passthrough(); // Allow additional fields from external catalog

const SearchCatalogResponseSchema = z.object({
  servers: z.array(CatalogServerSchema),
  totalCount: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

const CategoriesResponseSchema = z.object({
  categories: z.array(z.string()),
});

const archestraCatalogProxyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Proxy search endpoint with built-in injection
  fastify.get(
    "/api/archestra-catalog/servers",
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

      const externalResponse = await fetch(
        `${MCP_CATALOG_API_BASE_URL}/search?${params}`,
      );
      const externalData = await externalResponse.json();

      // Get matching built-in servers
      const builtinServers = getFilteredBuiltinServers({
        query: q,
        category,
      });

      // Inject built-in servers at the beginning (first page only)
      if (offset === 0 && builtinServers.length > 0) {
        externalData.servers = [...builtinServers, ...externalData.servers];
        externalData.totalCount = (externalData.totalCount || 0) + builtinServers.length;
      }

      return reply.send(externalData);
    },
  );

  // Get server by name
  fastify.get(
    "/api/archestra-catalog/servers/:name",
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
        return reply.send(builtinServer);
      }

      // Otherwise proxy to external
      const externalResponse = await fetch(
        `${MCP_CATALOG_API_BASE_URL}/server/${encodeURIComponent(name)}`,
      );
      const externalData = await externalResponse.json();
      return reply.send(externalData);
    },
  );

  // Get categories (merge built-in + external)
  fastify.get(
    "/api/archestra-catalog/categories",
    {
      schema: {
        operationId: RouteId.GetArchestraCatalogCategories,
        description: "Get all Archestra catalog categories",
        tags: ["Archestra Catalog"],
        response: constructResponseSchema(CategoriesResponseSchema),
      },
    },
    async (_request, reply) => {
      const externalResponse = await fetch(`${MCP_CATALOG_API_BASE_URL}/category`);
      const externalData = await externalResponse.json();

      // Merge with built-in categories
      const builtinCategories = getBuiltinCategories();
      const allCategories = new Set([
        ...externalData.categories,
        ...builtinCategories,
      ]);

      return reply.send({
        categories: Array.from(allCategories).sort(),
      });
    },
  );
};

export default archestraCatalogProxyRoutes;
```

### Add RouteIds for Catalog Proxy (APPEND)

Add to `platform/shared/access-control.ts` in the `RouteId` object:

```typescript
// Archestra Catalog Proxy Routes
SearchArchestraCatalog: "searchArchestraCatalog",
GetArchestraCatalogServer: "getArchestraCatalogServer",
GetArchestraCatalogCategories: "getArchestraCatalogCategories",
```

### Add Auth Skip for Catalog Proxy Routes (APPEND)

The catalog proxy routes should be public (no auth required). The Fastify auth middleware has two checks:
1. `shouldSkipAuthCheck` - if true, route is fully public (no auth at all)
2. `requiredEndpointPermissionsMap` - if route has RouteId, it must be in this map (even with `{}` for "any authenticated user")

**For public routes**: Add to `shouldSkipAuthCheck` in `platform/backend/src/auth/fastify-plugin/middleware.ts`:

```typescript
// In shouldSkipAuthCheck method, add to the if statement:
url.startsWith("/api/archestra-catalog") ||
```

This makes the catalog proxy routes fully public, matching the behavior of the external catalog they proxy.

> **NOTE**: Since we're adding to `shouldSkipAuthCheck`, the routes do NOT need to be added to `requiredEndpointPermissionsMap`. The auth check is skipped entirely before it reaches the permissions check.

### Update Frontend Rewrite Target

Change `frontend/next.config.ts` to route catalog requests through backend instead of directly to external catalog:

```typescript
// Before (direct to external catalog):
{
  source: "/api/archestra-catalog/:path*",
  destination: `${MCP_CATALOG_API_BASE_URL}/:path*`,
},

// After (through backend which merges built-in servers):
{
  source: "/api/archestra-catalog/:path*",
  destination: `${backendUrl}/api/archestra-catalog/:path*`,
},
```

> **NOTE**: The backend route (`/api/archestra-catalog/*`) fetches from the external catalog and merges built-in servers before returning results. This keeps the frontend code unchanged - it still calls `/api/archestra-catalog/*` but now gets merged results.

### Register New Route (APPEND)

Add export to `platform/backend/src/routes/index.ts`:

```typescript
export { default as archestraCatalogProxyRoutes } from "./archestra-catalog-proxy";
```

### Benefits of This Approach

1. **Extensible** - Add new built-in servers by creating a file in `servers/`
2. **Additive** - New directory/files, minimal changes to existing code
3. **No external service changes** - Works immediately
4. **Separation of concerns** - Registry logic separate from proxy logic
5. **Testable** - Can unit test registry and proxy independently
6. **Type-safe** - Uses `archestraCatalogTypes.ArchestraMcpServerManifest`

---

## Task 1.1.4: Security Policy Configuration Dialog

> **ALIGNMENT NOTE**: Follow shadcn/ui patterns from existing dialogs. Use TanStack Query mutation for API call.

Create `frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx`:

```typescript
"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PolicyConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcpServerName: string;
  onAccept: () => void;
  onSkip: () => void;
  isLoading?: boolean;
}

export function PolicyConfigDialog({
  open,
  onOpenChange,
  mcpServerName,
  onAccept,
  onSkip,
  isLoading,
}: PolicyConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure Security Policies</DialogTitle>
          <DialogDescription>
            {mcpServerName} works by chaining multiple tool calls
            (navigate, screenshot, click, type, etc.)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            By default, Archestra blocks tool chains when external data
            is present in context. We can pre-configure policies for you
            to enable chaining while maintaining security:
          </p>
          <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
            <li>Allow browser tools to chain within a session</li>
            <li>Block access to internal networks (SSRF protection)</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            These policies will be applied automatically when you assign these tools to an agent.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={isLoading}>
            Skip
          </Button>
          <Button onClick={onAccept} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving Preference...
              </>
            ) : (
              "Save & Continue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Frontend Query Hook

Create `frontend/src/lib/mcp-server-policies.query.ts`:

> **NOTE**: This hook depends on the schema/type updates from Task 1.1.5. Run `pnpm codegen:api-client` after updating backend types to get proper typing.

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { archestraApiSdk } from "@shared";

const { updateInternalMcpCatalogItem } = archestraApiSdk;

interface SavePolicyPreferenceParams {
  catalogId: string;
  preset: string;
}

export function useSaveMcpServerPolicyPreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ catalogId, preset }: SavePolicyPreferenceParams) => {
      // Store the policy preference in the catalog item
      // Types are generated from backend schema via codegen:api-client
      const response = await updateInternalMcpCatalogItem({
        path: { id: catalogId },
        body: {
          toolCallingPolicy: { preset, applyOnAssignment: true },
        },
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success("Security policy preference saved");
      queryClient.invalidateQueries({ queryKey: ["internal-mcp-catalog"] });
    },
    onError: () => {
      toast.error("Failed to save security policy preference");
    },
  });
}
```

### Integration Point

> **ALIGNMENT NOTE**: Show dialog after successful MCP server creation from catalog. Integrate in `archestra-catalog-tab.tsx` after `createMutation.mutateAsync()` succeeds.

In `archestra-catalog-tab.tsx`, after successful catalog item creation:
1. Check if `tool_calling_policy?.prompt_on_install === true`
2. If yes, open `PolicyConfigDialog` with the new MCP server ID and `preset`
3. On "Accept", call `useSaveMcpServerPolicyPreference` mutation
4. On "Skip", just close the dialog

### Transport Type Transformation (MODIFY archestra-catalog-tab.tsx)

> **IMPORTANT**: The existing `handleAddToCatalog` function must be updated to properly set `transportType`, `httpPort`, and `httpPath` for servers that use streamable-http transport.

When adding a server from the Online Catalog to Internal MCP Catalog, the current code doesn't extract transport settings from the external manifest format. For built-in servers like archestra-browser that use streamable-http, we need to:

1. Check `server.env.MCP_HTTP_PORT` and `server.env.MCP_HTTP_PATH` from the manifest
2. Set `localConfig.transportType = "streamable-http"` when HTTP port is specified
3. Set `localConfig.httpPort` and `localConfig.httpPath` accordingly

Add to the `handleAddToCatalog` function in `archestra-catalog-tab.tsx`:

```typescript
// In handleAddToCatalog, after parsing environment variables:

// Detect streamable-http transport from env vars
const httpPort = server.server.env?.MCP_HTTP_PORT;
const httpPath = server.server.env?.MCP_HTTP_PATH;

// Build localConfig with transport settings
const localConfig = {
  command: parsedConfig?.command,
  arguments: parsedConfig?.arguments,
  dockerImage: parsedConfig?.dockerImage || server.server.docker_image,
  environment,
  // Add transport type if HTTP port is specified
  ...(httpPort && {
    transportType: "streamable-http" as const,
    httpPort: Number(httpPort),
    httpPath: httpPath || "/mcp",
  }),
};
```

Without this change, the browser MCP would be started with stdio transport (the default) instead of streamable-http, and the HTTP service wouldn't be created.

---

## Task 1.1.5: Add Policy Schema to Internal Catalog

> **CHANGE**: Instead of applying policies immediately (which fails because tools/agents don't exist yet), we modify the `internal_mcp_catalog` schema to store the policy preference. This preference will be read later when tools are assigned to agents.

### Update Database Schema

> **IMPORTANT**: Never write raw SQL. Use Drizzle schema files and generate migrations.

**Step 1**: Update `platform/backend/src/database/schemas/internal-mcp-catalog.ts` to add the new column:

```typescript
// platform/backend/src/database/schemas/internal-mcp-catalog.ts
// Add this column to the existing internalMcpCatalogTable definition:

toolCallingPolicy: jsonb("tool_calling_policy").$type<{
  preset?: string;
  applyOnAssignment?: boolean;
}>(),
```

**Step 2**: Generate the migration:

```bash
cd platform
pnpm db:generate
```

This will create a new migration file in `backend/src/database/migrations/` with the ALTER TABLE statement.

**Step 3**: Run the migration:

```bash
pnpm db:migrate
```

### Update Types

Update `platform/backend/src/types/mcp-catalog.ts` to include the new field in Zod schemas.

```typescript
// Add this schema definition near the top
const ToolCallingPolicySchema = z.object({
  preset: z.string().optional(),
  applyOnAssignment: z.boolean().optional(),
});

// Extend SelectInternalMcpCatalogSchema
export const SelectInternalMcpCatalogSchema = createSelectSchema(
  schema.internalMcpCatalogTable,
).extend({
  // ... existing fields ...
  toolCallingPolicy: ToolCallingPolicySchema.nullable(),
});

// Extend InsertInternalMcpCatalogSchema
export const InsertInternalMcpCatalogSchema = createInsertSchema(
  schema.internalMcpCatalogTable,
)
  .extend({
    // ... existing fields ...
    toolCallingPolicy: ToolCallingPolicySchema.nullable().optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

// Extend UpdateInternalMcpCatalogSchema
export const UpdateInternalMcpCatalogSchema = createUpdateSchema(
  schema.internalMcpCatalogTable,
)
  .extend({
    // ... existing fields ...
    toolCallingPolicy: ToolCallingPolicySchema.nullable().optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });
```

After updating types, regenerate API client:
```bash
pnpm codegen:api-client
```

### Create Policy Presets Definition

Create `platform/backend/src/models/policy-presets.ts` to define the actual policies (same as before, but `createPoliciesFromPreset` will be used by the Agent-Tool assignment logic, not the Catalog API).

```typescript
import type { AutonomyPolicyOperator, ToolInvocation } from "@/types";

type PolicyDefinition = {
  argumentName: string;
  operator: AutonomyPolicyOperator.SupportedOperator;
  value: string;
  action: ToolInvocation.ToolInvocationPolicyAction;
  reason: string;
};

type PolicyPreset = Record<string, PolicyDefinition[]>;

// UUID regex pattern (matches standard UUID format)
const UUID_PATTERN = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

export const POLICY_PRESETS: Record<string, PolicyPreset> = {
  browser: {
    "*": [
      {
        argumentName: "sessionId",
        operator: "regex",
        // Format: browser-{profileId}-{conversationId} where both are UUIDs
        // The dispatcher injects sessionId into tool arguments - agent never sees or handles this
        value: `^browser-${UUID_PATTERN}-${UUID_PATTERN}$`,
        action: "allow_when_context_is_untrusted",
        reason: "Allow browser tools with valid session format (generated by dispatcher)",
      },
    ],
    browser_navigate: [
      {
        argumentName: "url",
        operator: "regex",
        value: "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0|169\\.254\\.|metadata\\.google|metadata\\.aws)",
        action: "block_always",
        reason: "Block internal network and cloud metadata access (SSRF protection)",
      },
    ],
  },
};

export function getAvailablePolicyPresets(): string[] {
  return Object.keys(POLICY_PRESETS);
}
```

**Note**: The logic to *apply* these policies will be implemented in a future task (Phase 1 - Task 1.2 or similar) when we handle "Agent Tool Assignment".

---

## Task 1.1.6: Add Tests

> **ALIGNMENT NOTE**: Follow existing test patterns. Backend tests use PGlite (real DB). Colocate tests with source.

### Browser MCP Server Unit Tests (NEW FILE)

Create `platform/browser-mcp-server/tests/browser-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BrowserManager } from "../src/browser-manager";

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
      const validId = "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";
      expect(manager.isValidSessionId(validId)).toBe(true);
    });

    it("rejects invalid session ID format", () => {
      expect(manager.isValidSessionId("invalid")).toBe(false);
      expect(manager.isValidSessionId("browser-123-456")).toBe(false);
      expect(manager.isValidSessionId("")).toBe(false);
    });
  });

  describe("session lifecycle", () => {
    it("creates a new session", async () => {
      const sessionId = "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";
      const session = await manager.getOrCreateSession(sessionId);

      expect(session).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(session.page).toBeDefined();
    });

    it("returns existing session on subsequent calls", async () => {
      const sessionId = "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";
      const session1 = await manager.getOrCreateSession(sessionId);
      const session2 = await manager.getOrCreateSession(sessionId);

      expect(session1).toBe(session2);
    });

    it("closes session correctly", async () => {
      const sessionId = "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";
      await manager.getOrCreateSession(sessionId);
      await manager.closeSession(sessionId);

      expect(manager.hasSession(sessionId)).toBe(false);
    });
  });

  describe("session timeout", () => {
    it("updates lastAccess on activity", async () => {
      const sessionId = "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7";
      const session = await manager.getOrCreateSession(sessionId);
      const initialAccess = session.lastAccess;

      // Simulate activity after a short delay
      await new Promise(resolve => setTimeout(resolve, 10));
      manager.touchSession(sessionId);

      expect(session.lastAccess.getTime()).toBeGreaterThan(initialAccess.getTime());
    });
  });
});
```

### Backend Unit Tests - Policy Presets (NEW FILE)

Create `platform/backend/src/models/policy-presets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getAvailablePolicyPresets, POLICY_PRESETS } from "./policy-presets";

describe("getAvailablePolicyPresets", () => {
  it("returns available presets", () => {
    const presets = getAvailablePolicyPresets();
    expect(presets).toContain("browser");
  });

  it("returns all defined presets", () => {
    const presets = getAvailablePolicyPresets();
    expect(presets).toEqual(Object.keys(POLICY_PRESETS));
  });
});

describe("POLICY_PRESETS", () => {
  it("browser preset has global sessionId policy", () => {
    const browserPreset = POLICY_PRESETS.browser;
    expect(browserPreset["*"]).toBeDefined();
    expect(browserPreset["*"].length).toBeGreaterThan(0);

    const sessionIdPolicy = browserPreset["*"].find(
      (p) => p.argumentName === "sessionId"
    );
    expect(sessionIdPolicy).toBeDefined();
    expect(sessionIdPolicy?.operator).toBe("regex");
    expect(sessionIdPolicy?.action).toBe("allow_when_context_is_untrusted");
  });

  it("browser preset has navigate URL block policy", () => {
    const browserPreset = POLICY_PRESETS.browser;
    expect(browserPreset.browser_navigate).toBeDefined();

    const urlBlockPolicy = browserPreset.browser_navigate.find(
      (p) => p.argumentName === "url"
    );
    expect(urlBlockPolicy).toBeDefined();
    expect(urlBlockPolicy?.action).toBe("block_always");
    // Verify SSRF protection patterns
    expect(urlBlockPolicy?.value).toContain("localhost");
    expect(urlBlockPolicy?.value).toContain("127.0.0.1");
    expect(urlBlockPolicy?.value).toContain("metadata.google");
  });

  it("browser sessionId regex matches valid UUID format", () => {
    const sessionIdPolicy = POLICY_PRESETS.browser["*"].find(
      (p) => p.argumentName === "sessionId"
    );
    const regex = new RegExp(sessionIdPolicy!.value);

    // Valid session ID with two UUIDs
    expect(
      regex.test(
        "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7"
      )
    ).toBe(true);

    // Invalid formats
    expect(regex.test("browser-123-456")).toBe(false);
    expect(regex.test("invalid-session-id")).toBe(false);
    expect(regex.test("browser-only-one-uuid-550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });
});
```

> **Note**: Tests for `createPoliciesFromPreset` (policy application logic) will be added in a future task when Agent-Tool assignment is implemented.

### E2E Tests

> **IMPORTANT**: Use the `makeApiRequest` fixture from `../fixtures` to ensure proper API_BASE_URL handling. Do NOT use `request.get/post` directly with relative URLs.

Add to `e2e-tests/tests/api/internal-mcp-catalog-policies.spec.ts`:

```typescript
import { test, expect } from "./fixtures";

test.describe("Internal MCP Catalog - Tool Calling Policy", () => {
  test("can create catalog item with toolCallingPolicy", async ({
    request,
    makeApiRequest,
  }) => {
    // Create a catalog item with policy preference
    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/internal_mcp_catalog",
      data: {
        name: "Test Browser MCP",
        version: "0.0.1",
        description: "Test browser MCP server",
        serverType: "local",
        localConfig: {
          command: "npx",
          arguments: ["@archestra/browser-mcp-server"],
          transportType: "streamable-http",
          httpPort: 8080,
          httpPath: "/mcp",
        },
        toolCallingPolicy: {
          preset: "browser",
          applyOnAssignment: true,
        },
      },
    });

    const created = await createResponse.json();
    expect(created.toolCallingPolicy).toEqual({
      preset: "browser",
      applyOnAssignment: true,
    });

    // Clean up
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/internal_mcp_catalog/${created.id}`,
    });
  });

  test("can update catalog item toolCallingPolicy", async ({
    request,
    makeApiRequest,
  }) => {
    // Create without policy
    const createResponse = await makeApiRequest({
      request,
      method: "post",
      urlSuffix: "/api/internal_mcp_catalog",
      data: {
        name: "Test MCP No Policy",
        version: "0.0.1",
        description: "Test MCP server",
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
      },
    });
    const created = await createResponse.json();

    // Update with policy
    const updateResponse = await makeApiRequest({
      request,
      method: "put",
      urlSuffix: `/api/internal_mcp_catalog/${created.id}`,
      data: {
        toolCallingPolicy: {
          preset: "browser",
          applyOnAssignment: true,
        },
      },
    });

    const updated = await updateResponse.json();
    expect(updated.toolCallingPolicy?.preset).toBe("browser");

    // Clean up
    await makeApiRequest({
      request,
      method: "delete",
      urlSuffix: `/api/internal_mcp_catalog/${created.id}`,
    });
  });
});
```

### Builtin Registry Tests

Add to `e2e-tests/tests/api/archestra-catalog-proxy.spec.ts`:

> **NOTE**: The catalog proxy routes are public (no auth), so we use `makeApiRequest` without session cookies. The routes are skipped in `shouldSkipAuthCheck`.

```typescript
import { test, expect } from "./fixtures";
import { API_BASE_URL } from "../../consts";

test.describe("Archestra Catalog Proxy", () => {
  test("includes archestra-browser in online catalog results", async ({ request }) => {
    // Catalog proxy is public, can use direct request
    const response = await request.get(`${API_BASE_URL}/api/archestra-catalog/servers`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const browserServer = data.servers.find(
      (s: { name: string }) => s.name === "archestra-browser"
    );

    expect(browserServer).toBeDefined();
    expect(browserServer.display_name).toBe("Archestra Browser");
    expect(browserServer.tool_calling_policy?.prompt_on_install).toBe(true);
    expect(browserServer.tool_calling_policy?.preset).toBe("browser");
  });

  test("can fetch archestra-browser by name", async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/servers/archestra-browser`
    );
    expect(response.ok()).toBeTruthy();

    const server = await response.json();
    expect(server.name).toBe("archestra-browser");
    expect(server.category).toBe("Browser Automation");
  });

  test("includes Browser Automation category from builtin servers", async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/archestra-catalog/categories`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.categories).toContain("Browser Automation");
  });

  test("filters builtin servers by search query", async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/servers?q=browser`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const browserServer = data.servers.find(
      (s: { name: string }) => s.name === "archestra-browser"
    );
    expect(browserServer).toBeDefined();
  });

  test("filters builtin servers by category", async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/api/archestra-catalog/servers?category=Browser%20Automation`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const browserServer = data.servers.find(
      (s: { name: string }) => s.name === "archestra-browser"
    );
    expect(browserServer).toBeDefined();
  });
});
```

---

## Files Summary

> **POLICY**: Prefer additive changes. CREATE new files instead of MODIFY when possible.

### New Files (CREATE)

| File | Description |
|------|-------------|
| `platform/browser-mcp-server/package.json` | Package config |
| `platform/browser-mcp-server/tsconfig.json` | TypeScript config |
| `platform/browser-mcp-server/vitest.config.ts` | Test config |
| `platform/browser-mcp-server/src/server.ts` | MCP server entry |
| `platform/browser-mcp-server/src/browser-manager.ts` | Session management |
| `platform/browser-mcp-server/src/tools/*.ts` | 7 tool files + index.ts |
| `platform/browser-mcp-server/src/types.ts` | Type definitions |
| `platform/browser-mcp-server/tests/browser-manager.test.ts` | Unit tests |
| `platform/backend/src/builtin-mcp-registry/index.ts` | Registry core (filter, find, categories) |
| `platform/backend/src/builtin-mcp-registry/servers/index.ts` | Auto-import all built-in servers |
| `platform/backend/src/builtin-mcp-registry/servers/archestra-browser.ts` | Browser server descriptor |
| `platform/backend/src/routes/archestra-catalog-proxy.ts` | Catalog proxy with registry merge |
| `platform/backend/src/models/policy-presets.ts` | Policy presets (browser, future: filesystem, etc.) |
| `platform/backend/src/models/policy-presets.test.ts` | Policy preset tests |
| `platform/frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx` | Dialog component |
| `platform/frontend/src/lib/mcp-server-policies.query.ts` | Query hook |
| `platform/e2e-tests/tests/api/internal-mcp-catalog-policies.spec.ts` | E2E tests for catalog policy |
| `platform/e2e-tests/tests/api/archestra-catalog-proxy.spec.ts` | E2E tests for builtin registry proxy |

### Append-Only Changes (minimal modifications)

| File | Change |
|------|--------|
| `platform/pnpm-workspace.yaml` | Add `browser-mcp-server` to packages list |
| `platform/backend/src/routes/index.ts` | Add exports for new routes |
| `platform/shared/access-control.ts` | Add new RouteId values to `RouteId` object (no permissions mapping - public routes) |
| `platform/frontend/next.config.ts` | Change archestra-catalog rewrite to backend proxy |
| `platform/frontend/src/app/mcp-catalog/_parts/archestra-catalog-tab.tsx` | Add dialog integration + transport type transformation in handleAddToCatalog |
| `platform/backend/src/auth/fastify-plugin/middleware.ts` | Add `/api/archestra-catalog` to shouldSkipAuthCheck |

---

## Acceptance Criteria

- [ ] "Archestra Browser" appears in **Online Catalog** (injected via backend proxy from built-in registry)
- [ ] User can click "Add to Your Registry" to add it to their Internal MCP Catalog
- [ ] After adding to registry, policy config dialog appears automatically (triggered by built-in manifest's `tool_calling_policy.prompt_on_install === true`)
- [ ] "Accept" saves policy preference: catalog entry gets `toolCallingPolicy: { preset: "browser", applyOnAssignment: true }`
- [ ] "Skip" closes dialog without saving preference (catalog entry has `toolCallingPolicy: null`)
- [ ] User can then install the browser MCP server (existing install flow works with the new catalog entry)
- [ ] All tests pass (unit tests for browser-manager, policy-presets; E2E tests for catalog proxy and policy storage)

> **Note**: Actual policy application happens in a future task when tools are assigned to agents. This task only stores the preference.
> **Note**: Pod runtime behavior (Playwright image, streamable-http transport) is configured via `localConfig` in the catalog entry - no Helm/deployment changes needed. The existing MCP server runtime handles this.

---

## Definition of Done

- [ ] All deliverables completed
- [ ] Browser MCP appears in Online Catalog and can be added to registry
- [ ] Security policy dialog works correctly (saves preference to Internal MCP Catalog)
- [ ] Tests added and passing
- [ ] Code passes `pnpm lint` and `pnpm type-check`
- [ ] Code reviewed and approved
- [ ] Documentation updated (if applicable)

> **Note**: Policy application to Tools UI happens in a future task when Agent-Tool assignment is implemented. This task only stores the preference in the catalog.

---

## Alignment Notes Summary

This task document has been reviewed and aligned with the existing codebase:

### Architecture Clarification

**Data Flow:**
```
                                    Built-in Registry (in code)
                                              ↓
Frontend  →  Next.js Rewrite  →  Backend Route  →  External Catalog (archestra.ai)
                                     ↓
                              Merge & Return  →  Online Catalog UI

User clicks "Add to Your Registry"
        │
        ▼
Internal MCP Catalog (database)  ──►  Install  ──►  MCP Server (K8s pod)
```

**Components:**
- **Built-in MCP Registry** = Code-based registry (`builtin-mcp-registry/`) for Archestra-provided servers like Browser
- **External Catalog** = Remote service at `archestra.ai/mcp-catalog/api` with community MCP servers
- **Backend Route** = New route (`/api/archestra-catalog/*`) that fetches from external catalog and merges built-in servers
- **Next.js Rewrite** = Existing rewrite updated to point to backend route instead of directly to external catalog
- **Online Catalog** = UI showing merged results (built-in + external)
- **Internal MCP Catalog** = Organization's private registry in DB (populated when user adds from Online Catalog)
- **MCP Server** = Installed/running instance in K8s

**Key Point:** Browser MCP is NOT seeded to DB. It lives in built-in registry and appears in Online Catalog via backend route (which merges built-in + external catalog results).

### Additive-First Policy
1. **Create new files** instead of modifying existing ones when possible
2. **New directory** `builtin-mcp-registry/` for extensible built-in server registration
3. **New route file** `archestra-catalog-proxy.ts` for catalog proxy with registry merge
4. **New model file** `policy-presets.ts` for reusable policy preset definitions
5. **Append-only changes** for barrel exports, RouteId values, and schema updates

### Technical Alignment
1. **Package versions**: Match `backend/package.json` (zod ^4.1.12, typescript ^5.9.2, vitest ^4.0.10)
2. **Build tooling**: Use `tsdown` instead of `tsc` (matches backend pattern)
3. **No express**: Use Node.js `http` module + MCP SDK's `StreamableHTTPServerTransport`
4. **Route patterns**: Use `constructResponseSchema`, `ApiError`, `RouteId` from shared
5. **Frontend patterns**: TanStack Query mutations, shadcn/ui components, SDK-based API calls
6. **Testing**: PGlite for backend tests, use existing fixtures
7. **Model-only DB access**: All database queries through models
8. **Error handling**: Check existence before insert (don't rely on try/catch for duplicates)

### Naming Convention Clarification

The `tool_calling_policy` field uses different naming conventions across layers:

| Layer | Field Name | Notes |
|-------|------------|-------|
| **Built-in Registry (code)** | `tool_calling_policy` (snake_case) | Custom extension - NOT in external catalog types |
| **Drizzle Schema (DB column)** | `tool_calling_policy` (snake_case) | SQL column name |
| **Drizzle Schema (TS property)** | `toolCallingPolicy` (camelCase) | TypeScript interface property |
| **API Response (codegen)** | `toolCallingPolicy` (camelCase) | Auto-generated from Zod schema |
| **Frontend (SDK)** | `toolCallingPolicy` (camelCase) | Uses generated SDK types |

**Important**: The external catalog API (`archestraCatalogTypes.ArchestraMcpServerManifest`) does NOT have a `tool_calling_policy` field. This is a custom extension for the built-in registry only. The `BuiltinMcpServer` interface extends `ArchestraMcpServerManifest` to add this field.

**Type Safety Note**: Since `tool_calling_policy` is NOT in the generated `ArchestraMcpServerManifest` type, the proxy response will include this field but TypeScript won't type-check it on the frontend. Options:
1. **Recommended**: Use `.passthrough()` on the Zod schema (already done in proxy route) to allow extra fields
2. The frontend can cast to `BuiltinMcpServer` type when checking `tool_calling_policy`
3. Alternatively, export `BuiltinMcpServer` from `@shared` for frontend use

The E2E tests access `tool_calling_policy` via `any` typing since Playwright doesn't enforce TypeScript types at runtime.

**Summary**:
- **Database column**: `tool_calling_policy` (snake_case in SQL)
- **TypeScript/API**: `toolCallingPolicy` (camelCase everywhere in TS code)
- **Built-in Registry only**: `tool_calling_policy` (snake_case, custom extension not in external catalog)

Drizzle automatically handles the mapping between snake_case column names and camelCase TypeScript properties.