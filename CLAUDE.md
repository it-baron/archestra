# CLAUDE.md

!!! Before doing something with code, read and understand repomix-output.txt !!!

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is the **Archestra Platform** - an MCP-native centralized AI platform providing enterprise-grade MCP toolbox, observability, and control with strong security foundations.

```
archestra/
├── docs/           # Documentation website content
├── platform/       # Main platform codebase (pnpm monorepo)
└── README.md       # Project overview and quickstart
```

## Working Directory

**IMPORTANT**: Almost all development work happens in the `platform/` directory.

- For platform development: `cd platform/` and refer to `platform/CLAUDE.md`
- For documentation updates: Work in `docs/pages/` following `docs/docs_writer_prompt.md`

## Common Commands

```bash
# Development (run from platform/ directory)
cd platform
tilt up                    # Start full Kubernetes development environment
pnpm dev                   # Start all workspaces in dev mode
pnpm lint                  # Lint and auto-fix code
pnpm type-check           # Check TypeScript types
pnpm test                  # Run unit tests
pnpm test:e2e             # Run end-to-end tests

# Database (run from platform/ directory)
pnpm db:migrate           # Run database migrations
pnpm db:studio            # Open Drizzle Studio
pnpm db:generate          # Generate new migrations
```

## Platform Architecture Overview

**Archestra Platform** is a Kubernetes-native MCP orchestrator that provides:

1. **MCP Gateway**: Unified access point for MCP tool execution with security policies
2. **LLM Proxy**: OpenAI/Anthropic-compatible proxy with observability and cost controls
3. **MCP Orchestrator**: Kubernetes-based runtime for MCP servers (one pod per server)
4. **Security Features**: Dual LLM pattern, tool invocation policies, trusted data policies
5. **Observability**: Distributed tracing (Tempo), metrics (Prometheus), and logs
6. **Cost Management**: Token usage limits, pricing configuration, and optimization rules
7. **Team-based Access Control**: Profiles and MCP servers with team-based authorization

**Tech Stack**:
- **Frontend**: Next.js 15 (App Router) + React 19 + shadcn/ui + TanStack Query
- **Backend**: Fastify + Drizzle ORM + PostgreSQL
- **Orchestration**: Kubernetes + Tilt (local dev) + Helm (production)
- **Observability**: OpenTelemetry + Tempo + Prometheus + Grafana
- **Monorepo**: pnpm workspaces + Turbo

## Key Concepts

### MCP Server Lifecycle
- Local MCP servers run as dedicated Kubernetes pods
- Two transport types: `stdio` (JSON-RPC proxy) and `streamable-http` (native HTTP)
- Automatic pod lifecycle management (start/restart/stop)
- Custom Docker images supported per server
- Secrets managed via Database or HashiCorp Vault

### Security Architecture
- **Dual LLM Pattern**: Isolate dangerous tool responses from main agent
- **Tool Invocation Policies**: Control which tools can be called and when
- **Trusted Data Policies**: Validate tool responses before sending to LLM
- **Dynamic Tools**: Tools are revealed to LLM only when policies allow
- **Archestra Built-in Tools**: Always trusted, prefixed with `archestra__`

### Authentication & Authorization
- **Better-Auth**: Session management with dynamic RBAC
- **API Key Auth**: `Authorization: ${apiKey}` (not Bearer)
- **Custom Roles**: Up to 50 custom roles per organization
- **Team-based Access**: Profiles and MCP servers assigned to teams
- **Profile Labels**: Key-value labels for organization/categorization

### Tool Execution Flow
1. Client calls LLM Proxy → receives tool_use/tool_calls
2. Client executes tools via MCP Gateway (`POST /v1/mcp` with `Bearer ${agentId}`)
3. Client sends tool results back to LLM Proxy
4. Client receives final answer

Tool invocation policies and trusted data policies are enforced by the proxy.

## Documentation Guidelines

When updating documentation in `docs/pages/`:

1. **Check writing guidelines first**: Read `docs/docs_writer_prompt.md`
2. **Human-built vs AI-generated**: Many docs are marked "human-built, shouldn't be updated with AI"
3. **Follow conventions**: Use existing docs as templates for structure and tone
4. **Update both code and docs**: For feature changes, audit `docs/pages/` to identify what needs updating

## Development Workflow

1. **Start with platform/CLAUDE.md**: Contains detailed conventions and architecture
2. **Use Tilt for local dev**: `tilt up` in `platform/` directory
3. **Follow coding conventions**: See `platform/CLAUDE.md` for:
   - Database access through models only
   - Frontend API client usage (no direct fetch)
   - Backend testing with PGlite (no mocks)
   - Error handling with typed Result values
   - Pagination and sorting helpers

## Security & Dependencies

- **Install scripts disabled**: `.npmrc` has `ignore-scripts=true` to prevent supply chain attacks
- **7-day minimum release age**: Packages must be published for 7+ days before installation
- **Manual rebuild when needed**: `pnpm rebuild <package-name>` for packages requiring scripts

## Key Files to Reference

- `platform/CLAUDE.md`: Detailed platform development guide (START HERE for coding work)
- `platform/.cursorrules`: Legacy Cursor rules (deprecated, use `.cursor/rules/` instead)
- `platform/.cursor/rules/`: Modern Cursor project rules (kept in sync with CLAUDE.md)
- `docs/docs_writer_prompt.md`: Documentation writing guidelines
- `README.md`: Project overview and quickstart for users

## Next Steps

- **For platform development**: `cd platform/` and read `platform/CLAUDE.md` thoroughly
- **For documentation updates**: Read `docs/docs_writer_prompt.md` first
- **For architecture questions**: Check `docs/pages/platform-*.md` files
- **For contributing**: See `docs/pages/contributing.md`

---

**Remember**: The `platform/` directory contains the actual codebase. Always work from there for development tasks.
