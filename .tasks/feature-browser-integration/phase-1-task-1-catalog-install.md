# Phase 1 - Task 1: Add Browser MCP to Catalog with Security Policy Dialog

**Goal**: User should be able to add "Archestra Browser" from catalog to private registry, with security policy configuration dialog.

**Priority**: Critical
**Dependencies**: None
**Status**: Not Started

---

## Objective

When a user installs "Archestra Browser" from the MCP Catalog, they should:
1. See the browser MCP server in the catalog
2. Click "Install" and have it added to their private registry
3. Be prompted with a security policy configuration dialog
4. Choose to accept recommended policies or skip

---

## Deliverables

- [ ] 1.1.1 - Create `platform/browser-mcp-server/` package structure
- [ ] 1.1.2 - Implement MCP server with Playwright integration (7 tools)
- [ ] 1.1.3 - Add browser MCP catalog entry via seeding
- [ ] 1.1.4 - Create security policy configuration dialog
- [ ] 1.1.5 - Implement policy defaults service and API endpoint
- [ ] 1.1.6 - Publish package to npm as `@archestra/browser-mcp-server`

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
│   ├── server.ts
│   ├── browser-manager.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── navigate.ts
│   │   ├── screenshot.ts
│   │   ├── click.ts
│   │   ├── type.ts
│   │   ├── get-content.ts
│   │   ├── scroll.ts
│   │   └── fill-and-submit.ts
│   └── types.ts
└── README.md
```

### package.json

```json
{
  "name": "@archestra/browser-mcp-server",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/server.js",
  "bin": {
    "browser-mcp-server": "./dist/server.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/server.js",
    "test": "vitest",
    "lint": "biome check",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.22.0",
    "playwright": "^1.50.0",
    "express": "^4.18.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/express": "^4.17.21",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
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
  - "browser-mcp-server"  # NEW
```

---

## Task 1.1.2: Implement MCP Server

Implement the 7 browser tools with session management.

### Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL |
| `browser_screenshot` | Take screenshot |
| `browser_click` | Click element |
| `browser_type` | Type text |
| `browser_get_content` | Get page content |
| `browser_scroll` | Scroll page |
| `browser_fill_and_submit` | Fill form and submit |

### Session Management

- 30-minute TTL with auto-cleanup
- Session ID format: `browser-{profileId}-{timestamp}`
- One browser instance per session

---

## Task 1.1.3: Add Catalog Entry via Seeding

Add to `backend/src/database/seed.ts`:

```typescript
async function seedBrowserMcpCatalog(): Promise<void> {
  const existingEntry = await InternalMcpCatalogModel.findByName("Archestra Browser");

  if (!existingEntry) {
    await InternalMcpCatalogModel.create({
      name: "Archestra Browser",
      version: "0.0.1",
      description: "Browse the web with AI assistance. Provides screenshot-based browser automation using Playwright.",
      serverType: "local",
      localConfig: {
        dockerImage: "mcr.microsoft.com/playwright:v1.50.0-noble",
        command: "npx",
        arguments: ["@archestra/browser-mcp-server"],
        environment: [
          { key: "MCP_HTTP_PORT", type: "plain_text", value: "8080", promptOnInstallation: false },
          { key: "MCP_HTTP_PATH", type: "plain_text", value: "/mcp", promptOnInstallation: false }
        ],
        transportType: "streamable-http",
        httpPort: 8080,
        httpPath: "/mcp"
      }
    });
    logger.info("Seeded Archestra Browser MCP catalog entry");
  }
}
```

---

## Task 1.1.4: Security Policy Configuration Dialog

Create `frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx`:

```typescript
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
  mcpServerId: string;
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
      <DialogContent>
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
          <ul className="list-disc list-inside text-sm space-y-1">
            <li>Allow browser tools to chain within a session</li>
            <li>Block access to internal networks (SSRF protection)</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            You can always modify these policies later in the Tools page.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={isLoading}>
            Skip
          </Button>
          <Button onClick={onAccept} disabled={isLoading}>
            {isLoading ? "Configuring..." : "Accept & Configure"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Integration

Show dialog after successful MCP server installation when server name includes "browser".

---

## Task 1.1.5: Policy Defaults Service

### Backend Service

Create `backend/src/services/policy-defaults.ts`:

```typescript
import { ToolInvocationPolicyModel } from "@/models";
import type { Tool, AgentTool } from "@/types";
import { logger } from "@/logging";

const BROWSER_TOOL_POLICIES = {
  "*": [
    {
      argumentName: "sessionId",
      operator: "regex" as const,
      value: "^browser-[a-f0-9-]+-[0-9]+$",
      action: "allow_when_context_is_untrusted" as const,
      reason: "Allow browser tools with valid session format",
    },
  ],
  "browser_navigate": [
    {
      argumentName: "url",
      operator: "regex" as const,
      value: "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0|169\\.254\\.|metadata\\.google|metadata\\.aws)",
      action: "block_always" as const,
      reason: "Block internal network and cloud metadata access (SSRF protection)",
    },
  ],
};

export async function createBrowserDefaultPolicies(
  agentTools: AgentTool[],
  tools: Tool[]
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const agentTool of agentTools) {
    const tool = tools.find((t) => t.id === agentTool.toolId);
    if (!tool) continue;

    const toolName = tool.name.replace("archestra_browser__", "");
    const policies = [
      ...(BROWSER_TOOL_POLICIES["*"] || []),
      ...(BROWSER_TOOL_POLICIES[toolName as keyof typeof BROWSER_TOOL_POLICIES] || []),
    ];

    for (const policy of policies) {
      try {
        await ToolInvocationPolicyModel.create({
          agentToolId: agentTool.id,
          ...policy,
        });
        created++;
      } catch {
        skipped++;
      }
    }
  }

  logger.info({ created, skipped }, "Created browser default policies");
  return { created, skipped };
}

export function needsPolicyConfigPrompt(mcpServerName: string): boolean {
  return mcpServerName.toLowerCase().includes("browser");
}
```

### Backend API Endpoint

Add to `backend/src/routes/mcp-server.ts`:

```typescript
fastify.post(
  "/api/mcp_server/:id/configure-policies",
  {
    schema: {
      operationId: RouteId.ConfigureMcpServerPolicies,
      params: z.object({ id: UuidIdSchema }),
      response: constructResponseSchema(
        z.object({ created: z.number(), skipped: z.number() })
      ),
    },
  },
  async ({ params: { id } }, reply) => {
    const mcpServer = await McpServerModel.findById(id);
    if (!mcpServer) throw new ApiError(404, "MCP server not found");

    const tools = await ToolModel.findByMcpServerId(id);
    const agentTools = await AgentToolModel.findByToolIds(tools.map(t => t.id));

    const result = await createBrowserDefaultPolicies(agentTools, tools);
    return reply.send(result);
  }
);
```

---

## Task 1.1.6: Publish to npm

### CI/CD Workflow

Create `.github/workflows/publish-browser-mcp.yml`:

```yaml
name: Publish Browser MCP Server

on:
  push:
    tags:
      - 'browser-mcp-server@*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm --filter @archestra/browser-mcp-server build

      - name: Publish
        run: pnpm --filter @archestra/browser-mcp-server publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Files Summary

| Action | File |
|--------|------|
| CREATE | `platform/browser-mcp-server/package.json` |
| CREATE | `platform/browser-mcp-server/tsconfig.json` |
| CREATE | `platform/browser-mcp-server/src/server.ts` |
| CREATE | `platform/browser-mcp-server/src/browser-manager.ts` |
| CREATE | `platform/browser-mcp-server/src/tools/*.ts` (7 files) |
| CREATE | `platform/backend/src/services/policy-defaults.ts` |
| CREATE | `platform/frontend/src/app/mcp-catalog/_parts/policy-config-dialog.tsx` |
| CREATE | `.github/workflows/publish-browser-mcp.yml` |
| MODIFY | `platform/pnpm-workspace.yaml` |
| MODIFY | `platform/backend/src/database/seed.ts` |
| MODIFY | `platform/backend/src/routes/mcp-server.ts` |
| MODIFY | `platform/frontend/src/app/mcp-catalog/` (integrate dialog) |

---

## Acceptance Criteria

- [ ] "Archestra Browser" visible in MCP Catalog
- [ ] User can click "Install" to add to private registry
- [ ] After installation, policy config dialog appears
- [ ] "Accept" creates session allowlist + SSRF block policies
- [ ] "Skip" does nothing (manual config later)
- [ ] Package published to npm as `@archestra/browser-mcp-server`
- [ ] Pod starts using Microsoft Playwright image

---

## Definition of Done

- [ ] All deliverables completed
- [ ] Browser MCP appears in catalog and can be installed
- [ ] Security policy dialog works correctly
- [ ] Policies visible in Tools UI after acceptance
- [ ] Code reviewed and approved
