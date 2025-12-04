# Archestra Security System - Technical Design Report

**Date**: 2024-12-02
**Author**: Security Analysis
**Status**: Documentation

---

## Executive Summary

Archestra implements a **two-layer security model** to protect AI agents from prompt injection attacks and unauthorized tool usage. The system uses a **default-deny approach** where all external data is considered untrusted until explicitly marked otherwise.

### Root Cause of Browser Screenshot Block

The `browser_screenshot` tool was blocked with error: *"Tool invocation blocked: context contains untrusted data"*

**Cause Chain**:
1. `browser_navigate` returned external web content (GitHub page)
2. No trusted data policy exists for this tool's output
3. Context marked as **untrusted** (default behavior)
4. `browser_screenshot` called with untrusted context
5. No `allow_when_context_is_untrusted` policy or `allowUsageWhenUntrustedDataIsPresent` flag
6. Tool invocation blocked by security policy

---

## Architecture Overview

```
                    REQUEST FLOW
                         |
                         v
    +--------------------------------------------+
    |        LAYER 1: TRUSTED DATA POLICIES      |
    |                                            |
    |  Evaluates: Tool OUTPUTS (responses)       |
    |  Purpose:   Determine if data is trusted   |
    |  Actions:   block_always                   |
    |             mark_as_trusted                |
    |             sanitize_with_dual_llm         |
    |  Output:    contextIsTrusted (boolean)     |
    +--------------------------------------------+
                         |
                         v
                   [CALL LLM]
                         |
                         v
    +--------------------------------------------+
    |     LAYER 2: TOOL INVOCATION POLICIES      |
    |                                            |
    |  Evaluates: Tool INPUTS (arguments)        |
    |  Uses:      contextIsTrusted from Layer 1  |
    |  Actions:   block_always                   |
    |             allow_when_context_is_untrusted|
    |  Output:    Allow or Block tool execution  |
    +--------------------------------------------+
                         |
                         v
                    RESPONSE
```

---

## Database Schema

### Core Tables

#### 1. `agents` (Profiles)
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  consider_context_untrusted BOOLEAN DEFAULT false,  -- Force all context untrusted
  ...
);
```

#### 2. `agent_tools` (Profile-Tool Junction)
```sql
CREATE TABLE agent_tools (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  tool_id UUID REFERENCES tools(id),

  -- Security Configuration
  allow_usage_when_untrusted_data_is_present BOOLEAN DEFAULT false,
  tool_result_treatment TEXT DEFAULT 'untrusted',  -- 'trusted' | 'untrusted' | 'sanitize_with_dual_llm'

  -- Optional
  response_modifier_template TEXT,  -- Handlebars.js template
  UNIQUE(agent_id, tool_id)
);
```

#### 3. `tool_invocation_policies`
```sql
CREATE TABLE tool_invocation_policies (
  id UUID PRIMARY KEY,
  agent_tool_id UUID REFERENCES agent_tools(id) ON DELETE CASCADE,

  -- Condition
  argument_name TEXT NOT NULL,      -- e.g., "url", "sessionId", "path"
  operator TEXT NOT NULL,           -- equal, contains, startsWith, endsWith, regex, etc.
  value TEXT NOT NULL,              -- Value to match against

  -- Action
  action TEXT NOT NULL,             -- 'block_always' | 'allow_when_context_is_untrusted'
  reason TEXT                       -- Human-readable explanation
);
```

#### 4. `trusted_data_policies`
```sql
CREATE TABLE trusted_data_policies (
  id UUID PRIMARY KEY,
  agent_tool_id UUID REFERENCES agent_tools(id) ON DELETE CASCADE,

  -- Condition
  attribute_path TEXT NOT NULL,     -- JSONPath, e.g., "data.url", "emails[*].from"
  operator TEXT NOT NULL,           -- equal, contains, startsWith, endsWith, regex, etc.
  value TEXT NOT NULL,              -- Value to match against

  -- Action
  action TEXT NOT NULL,             -- 'block_always' | 'mark_as_trusted' | 'sanitize_with_dual_llm'
  description TEXT NOT NULL         -- Human-readable description
);
```

---

## Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `equal` | Exact match | `url == "https://example.com"` |
| `notEqual` | Not equal | `status != "error"` |
| `contains` | Substring match | `url contains "github.com"` |
| `notContains` | Substring not present | `content notContains "malicious"` |
| `startsWith` | Prefix match | `path startsWith "/safe/"` |
| `endsWith` | Suffix match | `email endsWith "@company.com"` |
| `regex` | Regular expression | `id regex "^[a-f0-9-]+$"` |

---

## Policy Actions

### Trusted Data Policy Actions

| Action | Effect |
|--------|--------|
| `block_always` | Replace tool output with "[Content blocked by policy]" |
| `mark_as_trusted` | Mark data as trusted, context remains trusted |
| `sanitize_with_dual_llm` | Pass through Dual LLM quarantine pattern |

### Tool Invocation Policy Actions

| Action | Effect |
|--------|--------|
| `block_always` | Block tool execution unconditionally when condition matches |
| `allow_when_context_is_untrusted` | Override untrusted context block when condition matches |

---

## Evaluation Logic

### Trusted Data Evaluation (`trusted-data-policy.ts`)

```typescript
// Security Principle: Default DENY
// Data is UNTRUSTED by default. Only data that explicitly matches
// a trusted data policy is considered safe.

async evaluateBulk(agentId, toolCalls) {
  for (toolCall of toolCalls) {
    // 1. Archestra tools always trusted
    if (isArchestraMcpServerTool(toolName)) return { isTrusted: true }

    // 2. Check block policies FIRST
    if (matchesPolicy(action: "block_always")) return { isBlocked: true }

    // 3. Check trust policies
    if (matchesPolicy(action: "mark_as_trusted")) return { isTrusted: true }

    // 4. Check sanitize policies
    if (matchesPolicy(action: "sanitize_with_dual_llm"))
      return { shouldSanitizeWithDualLlm: true }

    // 5. Fallback to tool config
    return toolResultTreatment === "trusted"
      ? { isTrusted: true }
      : { isTrusted: false }
  }
}
```

### Tool Invocation Evaluation (`tool-invocation-policy.ts`)

```typescript
async evaluate(agentId, toolName, toolInput, isContextTrusted) {
  // 1. Archestra tools always allowed
  if (isArchestraMcpServerTool(toolName)) return { isAllowed: true }

  // 2. Evaluate block_always policies FIRST
  for (policy of policies.filter(p => p.action === "block_always")) {
    if (conditionMatches(policy, toolInput)) {
      return { isAllowed: false, reason: policy.reason }
    }
  }

  // 3. Check allow_when_context_is_untrusted policies
  let hasExplicitAllowRule = false
  for (policy of policies.filter(p => p.action === "allow_when_context_is_untrusted")) {
    if (conditionMatches(policy, toolInput)) {
      hasExplicitAllowRule = true
    }
  }

  // 4. Apply security decision
  if (!isContextTrusted && allowUsageWhenUntrustedDataIsPresent) {
    return { isAllowed: true }  // Tool config allows untrusted context
  }

  if (!isContextTrusted && !hasExplicitAllowRule) {
    return {
      isAllowed: false,
      reason: "Tool invocation blocked: context contains untrusted data"
    }
  }

  return { isAllowed: true }
}
```

---

## Dual LLM Pattern

### Purpose
Protect agents from prompt injection attacks when processing untrusted data (emails, web scrapes, user files).

### Architecture

```
Main LLM (Privileged)          Quarantined LLM (Restricted)
       |                                |
       |  "What is the sender?"         |
       |------------------------------->|
       |                                | [Has access to untrusted data]
       |        Answer: "2"             | [Can ONLY respond with indices]
       |<-------------------------------|
       |                                |
       | [Synthesizes safe summary      |
       |  from Q&A results]             |
```

### Security Properties
- Main LLM never sees raw untrusted content
- Quarantined LLM can only output integer indices (0, 1, 2...)
- Malicious instructions in data cannot influence Main LLM
- Free-form text from untrusted sources never reaches agent

### Configuration
```typescript
interface DualLlmConfig {
  mainAgentPrompt: string       // Template: {{originalUserRequest}}
  quarantinedAgentPrompt: string // Templates: {{toolResultData}}, {{question}}, {{options}}, {{maxIndex}}
  summaryPrompt: string         // Template: {{qaText}}
  maxRounds: number             // Default: 5
}
```

---

## Decision Matrix

| Context Trusted | Tool Has AllowUntrusted | Block Policy Matches | Allow Policy Matches | Result |
|-----------------|------------------------|---------------------|---------------------|--------|
| true | - | no | - | **ALLOWED** |
| true | - | yes | - | **BLOCKED** |
| false | true | no | - | **ALLOWED** |
| false | true | yes | - | **BLOCKED** |
| false | false | no | yes | **ALLOWED** |
| false | false | no | no | **BLOCKED** |
| false | false | yes | - | **BLOCKED** |

**Key Principles**:
1. `block_always` policies override everything
2. Untrusted context blocks by default
3. `allowUsageWhenUntrustedDataIsPresent` or explicit allow policy can override
4. Archestra built-in tools (`archestra__*`) bypass all policies

---

## Key Files

| Component | Path |
|-----------|------|
| Tool Invocation Policy Model | `backend/src/models/tool-invocation-policy.ts` |
| Trusted Data Policy Model | `backend/src/models/trusted-data-policy.ts` |
| Trust Evaluation Utils | `backend/src/routes/proxy/utils/trusted-data.ts` |
| Policy Evaluation Utils | `backend/src/routes/proxy/utils/tool-invocation.ts` |
| Agent-Tool Schema | `backend/src/database/schemas/agent-tool.ts` |
| Tool Invocation Policy Schema | `backend/src/database/schemas/tool-invocation-policy.ts` |
| Trusted Data Policy Schema | `backend/src/database/schemas/trusted-data-policy.ts` |
| Anthropic Proxy Integration | `backend/src/routes/proxy/anthropic.ts` |
| OpenAI Proxy Integration | `backend/src/routes/proxy/openai.ts` |
| Dual LLM Subagent | `backend/src/routes/proxy/utils/dual-llm-subagent.ts` |
| Dual LLM Config Model | `backend/src/models/dual-llm-config.ts` |

---

## Configuration Options for Browser Tools

### Option 1: Allow Untrusted Data (Per-Tool)
```json
PUT /api/agent-tools/:id
{
  "allowUsageWhenUntrustedDataIsPresent": true
}
```

### Option 2: Tool Invocation Policy (Fine-Grained)
```json
POST /api/tool-invocation-policies
{
  "agentToolId": "<agent-tool-id>",
  "argumentName": "sessionId",
  "operator": "startsWith",
  "value": "browser-session",
  "action": "allow_when_context_is_untrusted",
  "reason": "Allow browser tools with valid session IDs"
}
```

### Option 3: Trust Browser Output (Higher Risk)
```json
PUT /api/agent-tools/:id
{
  "toolResultTreatment": "trusted"
}
```

### Option 4: Sanitize with Dual LLM (Most Secure)
```json
PUT /api/agent-tools/:id
{
  "toolResultTreatment": "sanitize_with_dual_llm"
}
```

---

## Security Design Philosophy

### Default Deny Principle
- All external data is **untrusted by default**
- Tools must be explicitly allowed to work with untrusted context
- This prevents prompt injection attacks from external sources

### Layered Defense
1. **Trusted Data Policies**: Filter/sanitize data BEFORE it reaches the LLM
2. **Tool Invocation Policies**: Control tool execution AFTER LLM decides to use them
3. **Dual LLM Pattern**: Isolate dangerous content in quarantined environment

### Flexibility vs Security Trade-off
- More restrictive = more secure but requires explicit configuration
- Less restrictive = easier to use but higher risk of prompt injection
- The system defaults to security, requiring explicit opt-in for risky operations

---

## Browser Automation Security Solutions

### The Challenge

Browser automation tools present unique security challenges:
1. **External Data**: Web content is inherently untrusted (prompt injection risk)
2. **Chained Operations**: Navigate -> Screenshot -> Click requires context to flow
3. **Session State**: Browser sessions persist across tool calls
4. **Rich Output**: Screenshots, DOM content, accessibility trees contain arbitrary data

### Solution Architecture

```
                    BROWSER TOOL SECURITY MODEL
                              |
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
   INPUT CONTROL         OUTPUT CONTROL        SESSION CONTROL
        |                     |                     |
   Tool Invocation       Trusted Data          Session Isolation
   Policies              Policies              + Timeouts
        |                     |                     |
   - URL allowlists      - Dual LLM sanitize   - Unique sessionIds
   - Block internal IPs  - Response modifiers  - 30min timeout
   - Selector blocklists - Content filtering   - Per-agent isolation
```

---

### Design Solution 1: Session-Based Trust (Recommended)

**Concept**: Trust is scoped to browser sessions, not individual tool calls.

```
Session Created → All tools in session share trust context
                → Session output treated as single unit
                → Dual LLM runs once per session (not per tool)
```

**Configuration**:
```json
// Tool Invocation Policy: Allow tools with valid session
{
  "agentToolId": "<browser-navigate-agent-tool-id>",
  "argumentName": "sessionId",
  "operator": "regex",
  "value": "^browser-session-[a-f0-9-]+$",
  "action": "allow_when_context_is_untrusted",
  "reason": "Allow browser tools with valid session format"
}

// Same policy for ALL browser tools:
// browser_screenshot, browser_click, browser_type, etc.
```

**Benefits**:
- Simple configuration (one policy pattern for all tools)
- Session ID acts as capability token
- Tools can chain without repeated policy checks

**Trade-off**:
- Less granular control per-tool
- Session must be managed/cleaned up

---

### Design Solution 2: Domain-Based Trust

**Concept**: Trust specific domains, block others.

```
Trusted Domains: github.com, docs.google.com, internal.company.com
Blocked: All others (default deny)
```

**Configuration**:
```json
// Trusted Data Policy: Trust output from safe domains
{
  "agentToolId": "<browser-navigate-agent-tool-id>",
  "attributePath": "url",
  "operator": "contains",
  "value": "github.com",
  "action": "mark_as_trusted",
  "description": "Trust GitHub content"
}

// Tool Invocation Policy: Block dangerous URLs
{
  "agentToolId": "<browser-navigate-agent-tool-id>",
  "argumentName": "url",
  "operator": "regex",
  "value": "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)",
  "action": "block_always",
  "reason": "Internal network access blocked"
}

// Block non-HTTPS
{
  "argumentName": "url",
  "operator": "regex",
  "value": "^(?!https://)",
  "action": "block_always",
  "reason": "Only HTTPS URLs allowed"
}
```

**Benefits**:
- Fine-grained domain control
- Can allowlist specific sites for specific use cases
- Clear audit trail of allowed domains

**Trade-off**:
- Requires maintenance of domain lists
- May need many policies for diverse use cases

---

### Design Solution 3: Dual LLM Quarantine (Most Secure)

**Concept**: All browser output passes through Dual LLM sanitization.

```
Browser Output → Quarantined LLM (restricted) → Q&A extraction → Main LLM
                 [Can only answer with indices]
```

**Configuration**:
```json
// Agent-Tool Configuration
{
  "toolResultTreatment": "sanitize_with_dual_llm"
}

// OR via Trusted Data Policy
{
  "agentToolId": "<browser-navigate-agent-tool-id>",
  "attributePath": "*",
  "operator": "regex",
  "value": ".*",
  "action": "sanitize_with_dual_llm",
  "description": "Sanitize all browser output through Dual LLM"
}
```

**Benefits**:
- Maximum security against prompt injection
- Works with any domain/content
- Provable isolation of untrusted content

**Trade-off**:
- Higher latency (extra LLM call)
- Higher cost (additional tokens)
- May lose some content nuance in sanitization

---

### Design Solution 4: Response Modifier Templates

**Concept**: Transform browser output to extract only safe fields.

```
Raw Output: { url, title, html, cookies, scripts, ... }
                           ↓
Template:   { url, title, linkCount }  // Only safe fields
```

**Configuration**:
```json
// Agent-Tool with Response Modifier
{
  "responseModifierTemplate": "{{#with (lookup response 0)}}{{#with (json this.text)}}{\"url\": \"{{this.url}}\", \"title\": \"{{{escapeJson this.title}}}\", \"success\": true}{{/with}}{{/with}}"
}
```

**Example Templates**:

```handlebars
// Navigate - Extract only URL and title
{{#with (lookup response 0)}}
{
  "url": "{{this.url}}",
  "title": "{{{escapeJson this.title}}}",
  "navigated": true
}
{{/with}}

// Screenshot - Strip to metadata only
{{#with (lookup response 0)}}
{
  "captured": true,
  "mimeType": "{{this.resource.mimeType}}",
  "hasImage": true
}
{{/with}}

// Get Content - Limit text length
{{#with (lookup response 0)}}
{
  "text": "{{{escapeJson (truncate this.text 1000)}}}",
  "linkCount": {{this.links.length}}
}
{{/with}}
```

**Benefits**:
- Precise control over output shape
- Can strip dangerous fields (scripts, cookies)
- No additional LLM calls

**Trade-off**:
- Requires template per tool
- May lose useful data if template too restrictive
- Template errors can break tool output

---

### Design Solution 5: Hybrid Approach (Recommended for Production)

**Concept**: Combine multiple strategies based on tool risk level.

```
┌─────────────────┬──────────────────┬─────────────────────────────┐
│ Tool            │ Risk Level       │ Security Configuration      │
├─────────────────┼──────────────────┼─────────────────────────────┤
│ browser_navigate│ Medium           │ Domain allowlist +          │
│                 │                  │ Response modifier           │
├─────────────────┼──────────────────┼─────────────────────────────┤
│ browser_screenshot│ Low (image)    │ allowUsageWhenUntrusted +   │
│                 │                  │ Session validation          │
├─────────────────┼──────────────────┼─────────────────────────────┤
│ browser_get_content│ High (HTML)   │ Dual LLM sanitization       │
├─────────────────┼──────────────────┼─────────────────────────────┤
│ browser_click   │ Low (action)     │ Selector blocklist +        │
│                 │                  │ Session validation          │
├─────────────────┼──────────────────┼─────────────────────────────┤
│ browser_type    │ Medium           │ Input validation +          │
│                 │                  │ Field selector blocklist    │
├─────────────────┼──────────────────┼─────────────────────────────┤
│ browser_fill_and_submit│ High      │ Domain allowlist +          │
│                 │                  │ Field validation            │
└─────────────────┴──────────────────┴─────────────────────────────┘
```

**Implementation**:

```json
// 1. Base: All browser tools allow untrusted context with session validation
{
  "argumentName": "sessionId",
  "operator": "regex",
  "value": "^browser-session-[0-9]+$",
  "action": "allow_when_context_is_untrusted"
}

// 2. Navigate: Domain restrictions + response modifier
{
  "argumentName": "url",
  "operator": "regex",
  "value": "^https://(github\\.com|docs\\.google\\.com|.*\\.company\\.com)/",
  "action": "allow_when_context_is_untrusted"
}

// 3. Get Content: Dual LLM for HTML
{
  "toolResultTreatment": "sanitize_with_dual_llm"
}

// 4. Click/Type: Selector blocklist
{
  "argumentName": "selector",
  "operator": "regex",
  "value": "(password|credit.?card|ssn|secret)",
  "action": "block_always",
  "reason": "Sensitive field interaction blocked"
}
```

---

### Recommended Implementation Steps

#### Step 1: Enable Session-Based Allow (Quick Fix)
```sql
UPDATE agent_tools
SET allow_usage_when_untrusted_data_is_present = true
WHERE tool_id IN (
  SELECT id FROM tools
  WHERE name LIKE 'archestra_browser__%'
);
```

#### Step 2: Add Session Validation Policies
```sql
INSERT INTO tool_invocation_policies (agent_tool_id, argument_name, operator, value, action, reason)
SELECT at.id, 'sessionId', 'regex', '^browser-session-[0-9]+$', 'allow_when_context_is_untrusted', 'Valid session format'
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name LIKE 'archestra_browser__%';
```

#### Step 3: Add URL Restrictions for Navigate
```sql
INSERT INTO tool_invocation_policies (agent_tool_id, argument_name, operator, value, action, reason)
SELECT at.id, 'url', 'regex', '(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.)', 'block_always', 'Internal network blocked'
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name = 'archestra_browser__browser_navigate';
```

#### Step 4: Configure Dual LLM for Content Extraction
```sql
UPDATE agent_tools
SET tool_result_treatment = 'sanitize_with_dual_llm'
WHERE tool_id = (SELECT id FROM tools WHERE name = 'archestra_browser__browser_get_content');
```

---

### Security vs Usability Matrix

| Approach | Security | Usability | Latency | Cost |
|----------|----------|-----------|---------|------|
| Block all (default) | Highest | Lowest | None | None |
| Session-based allow | Medium | High | None | None |
| Domain allowlist | High | Medium | None | None |
| Response modifiers | Medium-High | High | None | None |
| Dual LLM sanitize | Highest | Medium | +2-5s | +$$ |
| Hybrid (recommended) | High | High | Varies | Varies |

---

### API Endpoints for Configuration

```bash
# List browser tools for a profile
GET /api/agent-tools?agentId=<profile-id>&toolName=archestra_browser__

# Update tool security config
PUT /api/agent-tools/<agent-tool-id>
{
  "allowUsageWhenUntrustedDataIsPresent": true,
  "toolResultTreatment": "untrusted"
}

# Create tool invocation policy
POST /api/tool-invocation-policies
{
  "agentToolId": "<agent-tool-id>",
  "argumentName": "sessionId",
  "operator": "regex",
  "value": "^browser-session-[0-9]+$",
  "action": "allow_when_context_is_untrusted",
  "reason": "Allow valid browser sessions"
}

# Create trusted data policy
POST /api/trusted-data-policies
{
  "agentToolId": "<agent-tool-id>",
  "attributePath": "url",
  "operator": "startsWith",
  "value": "https://github.com",
  "action": "mark_as_trusted",
  "description": "Trust GitHub URLs"
}
```

---

## Session-Based Trust Implementation (Detailed Design)

### Current Architecture Gap

The current trust system has a fundamental limitation for browser automation:

```
CURRENT: Context-Based Trust
┌─────────────────────────────────────────────────────────────┐
│ Tool 1 Output → Untrusted → Context becomes untrusted       │
│                                    ↓                        │
│ Tool 2 Call   → BLOCKED (context is untrusted)              │
└─────────────────────────────────────────────────────────────┘

NEEDED: Session-Based Trust
┌─────────────────────────────────────────────────────────────┐
│ Session Created → Trust level: "pending"                    │
│ Tool 1 (navigate) → Session continues                       │
│ Tool 2 (login) → Session trust: "authenticated"             │
│ Tool 3 (screenshot) → ALLOWED (session is authenticated)    │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Options

#### Option A: Session Trust Fields on agent_tools (Recommended)

Add session tracking directly to the agent-tool relationship:

```typescript
// Schema addition to agent_tools table
{
  // Existing fields...
  allowUsageWhenUntrustedDataIsPresent: boolean,
  toolResultTreatment: enum,

  // NEW: Session-based trust fields
  sessionTrustEnabled: boolean,              // Enable session-based trust for this tool
  sessionTrustPattern: string,               // Regex pattern for valid sessionIds
  sessionTrustLevel: enum,                   // 'untrusted' | 'pending' | 'authenticated' | 'trusted'
  sessionTrustExpiry: timestamp,             // When session trust expires
  lastSessionActivity: timestamp,            // Track activity for timeout
}
```

**Pros**: Simple, no new tables, easy to query
**Cons**: Session state tied to agent-tool, not shared across tools

#### Option B: Dedicated Session Trust Table (More Flexible)

Create a separate table for session trust state:

```sql
CREATE TABLE browser_session_trust (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  session_id TEXT NOT NULL,                  -- e.g., "browser-session-12345"
  trust_level TEXT NOT NULL DEFAULT 'untrusted',  -- 'untrusted' | 'pending' | 'authenticated' | 'trusted'
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  last_activity TIMESTAMP,
  metadata JSONB,                            -- Store login domain, auth method, etc.

  UNIQUE(agent_id, session_id)
);
```

**Pros**: Shared trust across all browser tools, rich metadata, audit trail
**Cons**: New table, more complex queries

#### Option C: Policy-Based Session Trust (Most Flexible)

Extend tool invocation policies with session-aware actions:

```sql
-- Extend tool_invocation_policies with new action types
ALTER TYPE tool_invocation_action ADD VALUE 'allow_when_session_authenticated';
ALTER TYPE tool_invocation_action ADD VALUE 'allow_when_session_trusted';
ALTER TYPE tool_invocation_action ADD VALUE 'require_session_validation';

-- Add session-specific policy fields
ALTER TABLE tool_invocation_policies ADD COLUMN session_trust_level TEXT;
```

**Pros**: Uses existing policy framework, fine-grained control
**Cons**: Complex policy logic, harder to understand

---

### Recommended Implementation: Option B + Option C Hybrid

Combine a session trust table with policy extensions for maximum flexibility.

#### Database Schema Changes

```sql
-- Migration: add_browser_session_trust.sql

-- 1. Create session trust table
CREATE TABLE browser_session_trust (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'untrusted'
    CHECK (trust_level IN ('untrusted', 'pending', 'authenticated', 'trusted')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  last_activity_at TIMESTAMP,
  authenticated_domain TEXT,                 -- Domain where auth occurred
  metadata JSONB DEFAULT '{}',

  UNIQUE(agent_id, session_id)
);

-- 2. Add index for fast lookups
CREATE INDEX idx_session_trust_agent_session ON browser_session_trust(agent_id, session_id);
CREATE INDEX idx_session_trust_expiry ON browser_session_trust(expires_at) WHERE expires_at IS NOT NULL;

-- 3. Extend tool invocation policy actions
-- Note: This requires updating the enum in code, not SQL
```

#### Model Implementation

```typescript
// backend/src/models/browser-session-trust.ts

import db, { schema } from "@/database";
import { eq, and, gt } from "drizzle-orm";

type TrustLevel = "untrusted" | "pending" | "authenticated" | "trusted";

interface SessionTrust {
  id: string;
  agentId: string;
  sessionId: string;
  trustLevel: TrustLevel;
  expiresAt: Date | null;
  lastActivityAt: Date | null;
  authenticatedDomain: string | null;
  metadata: Record<string, unknown>;
}

class BrowserSessionTrustModel {
  /**
   * Get trust level for a browser session
   */
  static async getTrustLevel(
    agentId: string,
    sessionId: string
  ): Promise<TrustLevel> {
    const [session] = await db
      .select()
      .from(schema.browserSessionTrustTable)
      .where(
        and(
          eq(schema.browserSessionTrustTable.agentId, agentId),
          eq(schema.browserSessionTrustTable.sessionId, sessionId)
        )
      );

    if (!session) return "untrusted";

    // Check expiry
    if (session.expiresAt && session.expiresAt < new Date()) {
      return "untrusted";
    }

    return session.trustLevel as TrustLevel;
  }

  /**
   * Create or update session trust
   */
  static async setTrustLevel(
    agentId: string,
    organizationId: string,
    sessionId: string,
    trustLevel: TrustLevel,
    options?: {
      expiresAt?: Date;
      authenticatedDomain?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<SessionTrust> {
    const [result] = await db
      .insert(schema.browserSessionTrustTable)
      .values({
        agentId,
        organizationId,
        sessionId,
        trustLevel,
        expiresAt: options?.expiresAt,
        authenticatedDomain: options?.authenticatedDomain,
        metadata: options?.metadata ?? {},
        lastActivityAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.browserSessionTrustTable.agentId,
          schema.browserSessionTrustTable.sessionId,
        ],
        set: {
          trustLevel,
          expiresAt: options?.expiresAt,
          authenticatedDomain: options?.authenticatedDomain,
          metadata: options?.metadata,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  }

  /**
   * Update last activity timestamp (keeps session alive)
   */
  static async touchSession(agentId: string, sessionId: string): Promise<void> {
    await db
      .update(schema.browserSessionTrustTable)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.browserSessionTrustTable.agentId, agentId),
          eq(schema.browserSessionTrustTable.sessionId, sessionId)
        )
      );
  }

  /**
   * Revoke session trust (e.g., on logout or security event)
   */
  static async revokeTrust(agentId: string, sessionId: string): Promise<void> {
    await db
      .update(schema.browserSessionTrustTable)
      .set({ trustLevel: "untrusted", updatedAt: new Date() })
      .where(
        and(
          eq(schema.browserSessionTrustTable.agentId, agentId),
          eq(schema.browserSessionTrustTable.sessionId, sessionId)
        )
      );
  }

  /**
   * Clean up expired sessions
   */
  static async cleanupExpired(): Promise<number> {
    const result = await db
      .delete(schema.browserSessionTrustTable)
      .where(gt(new Date(), schema.browserSessionTrustTable.expiresAt));

    return result.rowCount ?? 0;
  }
}

export default BrowserSessionTrustModel;
```

#### Integration into Tool Invocation Policy Evaluation

```typescript
// backend/src/models/tool-invocation-policy.ts
// Modify the evaluate() method

static async evaluate(
  agentId: string,
  toolName: string,
  toolInput: Record<string, any>,
  isContextTrusted: boolean,
): Promise<EvaluationResult> {
  // ... existing code ...

  // NEW: Extract sessionId from tool input for browser tools
  const sessionId = toolInput.sessionId as string | undefined;
  let sessionTrustLevel: TrustLevel = "untrusted";

  if (sessionId && toolName.startsWith("archestra_browser__")) {
    sessionTrustLevel = await BrowserSessionTrustModel.getTrustLevel(
      agentId,
      sessionId
    );

    // Touch session to keep it alive
    await BrowserSessionTrustModel.touchSession(agentId, sessionId);
  }

  // ... existing policy evaluation ...

  // NEW: Session-based trust check (after block_always, before context trust)
  if (sessionId && sessionTrustLevel !== "untrusted") {
    // Session has some trust level - check policies
    for (const policy of applicablePoliciesForAgent) {
      if (policy.action === "allow_when_session_authenticated" &&
          (sessionTrustLevel === "authenticated" || sessionTrustLevel === "trusted")) {
        return { isAllowed: true, reason: "Session is authenticated" };
      }

      if (policy.action === "allow_when_session_trusted" &&
          sessionTrustLevel === "trusted") {
        return { isAllowed: true, reason: "Session is fully trusted" };
      }
    }
  }

  // ... existing context trust check ...
  if (!isContextTrusted && allowUsageWhenUntrustedDataIsPresent) {
    return { isAllowed: true, reason: "" };
  }

  if (!isContextTrusted && !hasExplicitAllowRule) {
    return {
      isAllowed: false,
      reason: "Tool invocation blocked: context contains untrusted data",
    };
  }

  return { isAllowed: true, reason: "" };
}
```

#### New Policy Actions

```typescript
// backend/src/types/autonomy-policies/tool-invocation.ts

export const ToolInvocationPolicyActionSchema = z.enum([
  // Existing
  "allow_when_context_is_untrusted",
  "block_always",

  // NEW: Session-based actions
  "allow_when_session_pending",        // Allow if session exists (any trust level)
  "allow_when_session_authenticated",  // Allow if session is authenticated
  "allow_when_session_trusted",        // Allow if session is fully trusted
]);
```

---

### Session Trust Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SESSION TRUST LIFECYCLE                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. SESSION CREATED                                                 │
│     └─ browser_navigate("https://example.com")                      │
│        └─ Trust Level: "pending" (session exists but not verified)  │
│                                                                     │
│  2. AUTHENTICATION DETECTED                                         │
│     └─ browser_fill_and_submit(login form)                          │
│        └─ Trust Level: "authenticated" (user logged in)             │
│        └─ authenticatedDomain: "example.com"                        │
│        └─ expiresAt: now + 30 minutes                               │
│                                                                     │
│  3. ELEVATED TRUST (optional)                                       │
│     └─ Manual admin approval OR MFA completion                      │
│        └─ Trust Level: "trusted" (full access)                      │
│                                                                     │
│  4. SESSION EXPIRES                                                 │
│     └─ expiresAt reached OR inactivity timeout                      │
│        └─ Trust Level: "untrusted"                                  │
│                                                                     │
│  5. SESSION REVOKED                                                 │
│     └─ Logout detected OR security event                            │
│        └─ Trust Level: "untrusted"                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### API Endpoints for Session Trust

```typescript
// backend/src/routes/browser-session-trust.ts

// Get session trust status
GET /api/browser-sessions/:sessionId/trust
Response: { trustLevel, expiresAt, authenticatedDomain, lastActivityAt }

// Set session trust level (admin/system use)
PUT /api/browser-sessions/:sessionId/trust
Body: { trustLevel, expiresAt?, authenticatedDomain? }

// Revoke session trust
DELETE /api/browser-sessions/:sessionId/trust

// List all active sessions for an agent
GET /api/agents/:agentId/browser-sessions
Response: [{ sessionId, trustLevel, expiresAt, lastActivityAt }]

// Revoke all sessions for an agent (security action)
DELETE /api/agents/:agentId/browser-sessions
```

---

### Automatic Trust Escalation (Optional)

Detect authentication events and automatically escalate trust:

```typescript
// backend/src/routes/proxy/utils/session-trust-detector.ts

interface AuthDetectionResult {
  isAuthEvent: boolean;
  domain?: string;
  trustLevel?: TrustLevel;
}

/**
 * Detect if a tool call represents an authentication event
 */
export function detectAuthEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: unknown
): AuthDetectionResult {
  // Detect login form submission
  if (toolName === "archestra_browser__browser_fill_and_submit") {
    const fields = toolInput.fields as Array<{ selector: string }>;
    const hasPasswordField = fields?.some(f =>
      f.selector.includes("password") ||
      f.selector.includes("passwd")
    );

    if (hasPasswordField) {
      const url = new URL(toolInput.url as string);
      return {
        isAuthEvent: true,
        domain: url.hostname,
        trustLevel: "authenticated",
      };
    }
  }

  // Detect OAuth callback
  if (toolName === "archestra_browser__browser_navigate") {
    const url = toolInput.url as string;
    if (url.includes("oauth") || url.includes("callback") || url.includes("auth")) {
      return {
        isAuthEvent: true,
        domain: new URL(url).hostname,
        trustLevel: "authenticated",
      };
    }
  }

  return { isAuthEvent: false };
}
```

---

### Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/database/schemas/browser-session-trust.ts` | Create | New schema |
| `backend/src/database/migrations/XXXX_add_browser_session_trust.ts` | Create | Migration |
| `backend/src/models/browser-session-trust.ts` | Create | Model |
| `backend/src/models/tool-invocation-policy.ts` | Modify | Add session trust evaluation |
| `backend/src/types/autonomy-policies/tool-invocation.ts` | Modify | Add new actions |
| `backend/src/routes/browser-session-trust.ts` | Create | API endpoints |
| `backend/src/routes/proxy/utils/session-trust-detector.ts` | Create | Auth detection |
| `backend/src/routes/proxy/anthropic.ts` | Modify | Integrate session trust |
| `backend/src/routes/proxy/openai.ts` | Modify | Integrate session trust |

---

---

## Recommended Approach: Allowlist Policy (Simplest Solution)

### Philosophy

The "untrusted context" block is an **application policy decision**, not an LLM security measure. Browser output (URL, title) isn't a prompt injection risk - it's external data that the system treats conservatively by default.

**Key insight**: We don't need to modify the security system. We just need to configure policies that allow browser tools to work within the existing framework.

### Session Model

Simple lifecycle matching Anthropic's computer use pattern:

```
Chat starts → Browser session created → Tools chain freely → Chat ends/timeout → Session closed
```

- One session per chat
- Session closed by timeout (30 min) or when user ends chat
- No complex trust escalation needed

### Implementation: Two Policies

#### Policy 1: Allow Browser Tools with Valid Session (Allowlist)

```sql
-- Allow all browser tools when they have a valid sessionId format
INSERT INTO tool_invocation_policies (agent_tool_id, argument_name, operator, value, action, reason)
SELECT
  at.id,
  'sessionId',
  'regex',
  '^browser-session-[0-9]+$',
  'allow_when_context_is_untrusted',
  'Allow browser tools with valid session format'
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name LIKE 'archestra_browser__%';
```

#### Policy 2: Block Internal Network Access (SSRF Protection)

```sql
-- Block navigation to internal network addresses
INSERT INTO tool_invocation_policies (agent_tool_id, argument_name, operator, value, action, reason)
SELECT
  at.id,
  'url',
  'regex',
  '(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0)',
  'block_always',
  'Internal network access blocked for security'
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name = 'archestra_browser__browser_navigate';
```

### Why SSRF Protection is Important

Without URL restrictions, an agent could:
- Access internal services (`http://localhost:8080/admin`)
- Scan internal network (`http://192.168.1.1`)
- Access cloud metadata (`http://169.254.169.254/`)

The `block_always` policy prevents this by blocking internal IP patterns before the tool executes.

### Complete SQL Script

```sql
-- ============================================
-- Browser Automation Security Policies
-- ============================================

-- 1. ALLOWLIST: Enable browser tools with valid sessions
-- This allows browser_navigate, browser_screenshot, browser_click, etc.
-- to work even when context contains "untrusted" data from previous tool calls
INSERT INTO tool_invocation_policies (id, agent_tool_id, argument_name, operator, value, action, reason, created_at, updated_at)
SELECT
  gen_random_uuid(),
  at.id,
  'sessionId',
  'regex',
  '^browser-session-[0-9]+$',
  'allow_when_context_is_untrusted',
  'Allow browser tools with valid session format',
  NOW(),
  NOW()
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name LIKE 'archestra_browser__%'
ON CONFLICT DO NOTHING;

-- 2. SSRF PROTECTION: Block internal network access
-- Prevents agents from accessing localhost, private IPs, and link-local addresses
INSERT INTO tool_invocation_policies (id, agent_tool_id, argument_name, operator, value, action, reason, created_at, updated_at)
SELECT
  gen_random_uuid(),
  at.id,
  'url',
  'regex',
  '(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0|169\\.254\\.|metadata\\.google|metadata\\.aws)',
  'block_always',
  'Internal network and cloud metadata access blocked',
  NOW(),
  NOW()
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name = 'archestra_browser__browser_navigate'
ON CONFLICT DO NOTHING;

-- 3. OPTIONAL: Require HTTPS for all navigation
-- Uncomment if you want to enforce HTTPS-only browsing
/*
INSERT INTO tool_invocation_policies (id, agent_tool_id, argument_name, operator, value, action, reason, created_at, updated_at)
SELECT
  gen_random_uuid(),
  at.id,
  'url',
  'regex',
  '^(?!https://)',
  'block_always',
  'Only HTTPS URLs allowed',
  NOW(),
  NOW()
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE t.name = 'archestra_browser__browser_navigate'
ON CONFLICT DO NOTHING;
*/
```

### API Alternative

If you prefer to use the API instead of direct SQL:

```bash
# 1. Get agent-tool IDs for browser tools
curl -X GET "http://localhost:9000/api/agent-tools?toolName=archestra_browser__" \
  -H "Authorization: <api-key>"

# 2. Create allowlist policy for each tool
curl -X POST "http://localhost:9000/api/tool-invocation-policies" \
  -H "Authorization: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentToolId": "<agent-tool-id>",
    "argumentName": "sessionId",
    "operator": "regex",
    "value": "^browser-session-[0-9]+$",
    "action": "allow_when_context_is_untrusted",
    "reason": "Allow browser tools with valid session format"
  }'

# 3. Create SSRF protection for browser_navigate
curl -X POST "http://localhost:9000/api/tool-invocation-policies" \
  -H "Authorization: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentToolId": "<browser-navigate-agent-tool-id>",
    "argumentName": "url",
    "operator": "regex",
    "value": "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0|169\\.254\\.|metadata\\.google|metadata\\.aws)",
    "action": "block_always",
    "reason": "Internal network and cloud metadata access blocked"
  }'
```

### Summary

| Policy | Purpose | Action |
|--------|---------|--------|
| Session allowlist | Allow browser tools to chain | `allow_when_context_is_untrusted` |
| SSRF protection | Block internal network | `block_always` |
| HTTPS only (optional) | Enforce secure connections | `block_always` |

**No code changes required.** This approach uses the existing policy system exactly as designed.

---

## Existing Services for Policy Management

### Backend API Endpoints

Full CRUD API exists at `backend/src/routes/autonomy-policies.ts`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/autonomy-policies/operators` | GET | List all supported operators |
| `/api/autonomy-policies/tool-invocation` | GET | List all tool invocation policies |
| `/api/autonomy-policies/tool-invocation` | POST | Create new policy |
| `/api/autonomy-policies/tool-invocation/:id` | GET | Get policy by ID |
| `/api/autonomy-policies/tool-invocation/:id` | PUT | Update policy |
| `/api/autonomy-policies/tool-invocation/:id` | DELETE | Delete policy |
| `/api/trusted-data-policies` | GET | List all trusted data policies |
| `/api/trusted-data-policies` | POST | Create new policy |
| `/api/trusted-data-policies/:id` | GET/PUT/DELETE | CRUD by ID |

### Frontend UI

Policy management UI exists at:
- **Location**: `frontend/src/app/tools/_parts/tool-call-policies.tsx`
- **Access**: Tools page -> Click on a tool -> "Tool Call Policies" section
- **URL**: `http://localhost:3000/tools` -> Select tool -> Details dialog

The UI provides:
1. **Toggle switch** for `allowUsageWhenUntrustedDataIsPresent`
2. **Policy editor** with dropdowns for:
   - Argument name (from tool schema)
   - Operator (equal, contains, regex, etc.)
   - Value input
   - Action (allow_when_context_is_untrusted, block_always)
3. **Add/Delete** policy buttons

### Frontend Query Hooks

React Query hooks at `frontend/src/lib/policy.query.ts`:

```typescript
// Tool Invocation Policies
useToolInvocationPolicies()           // List all
useToolInvocationPolicyCreateMutation()
useToolInvocationPolicyUpdateMutation()
useToolInvocationPolicyDeleteMutation()

// Trusted Data Policies
useToolResultPolicies()               // List all
useToolResultPoliciesCreateMutation()
useToolResultPoliciesUpdateMutation()
useToolResultPoliciesDeleteMutation()

// Operators
useOperators()                        // Get available operators
```

### How to Configure Browser Tools via UI

1. Go to `http://localhost:3000/tools`
2. Find browser tools (e.g., `archestra_browser__browser_navigate`)
3. Click on the tool row to open details dialog
4. In "Tool Call Policies" section:
   - Toggle ON "Allow usage when untrusted data is present" for quick fix
   - OR click "Add Policy" to create specific rules:
     - Argument: `sessionId`
     - Operator: `regex`
     - Value: `^browser-session-[0-9]+$`
     - Action: `allow_when_context_is_untrusted`
5. For SSRF protection on `browser_navigate`:
   - Add Policy:
     - Argument: `url`
     - Operator: `regex`
     - Value: `(localhost|127\.0\.0\.1|192\.168\.|10\.|...)`
     - Action: `block_always`

### API Usage Example

```bash
# 1. Get all browser tool agent-tool relationships
curl "http://localhost:9000/api/agent-tools" \
  -H "Authorization: <api-key>" | jq '.data[] | select(.tool.name | startswith("archestra_browser"))'

# 2. Create allowlist policy
curl -X POST "http://localhost:9000/api/autonomy-policies/tool-invocation" \
  -H "Authorization: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentToolId": "<from-step-1>",
    "argumentName": "sessionId",
    "operator": "regex",
    "value": "^browser-session-[0-9]+$",
    "action": "allow_when_context_is_untrusted",
    "reason": "Allow browser tools with valid session"
  }'

# 3. Create SSRF block policy (for browser_navigate only)
curl -X POST "http://localhost:9000/api/autonomy-policies/tool-invocation" \
  -H "Authorization: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentToolId": "<browser-navigate-agent-tool-id>",
    "argumentName": "url",
    "operator": "regex",
    "value": "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|169\\.254\\.|metadata)",
    "action": "block_always",
    "reason": "Block internal network access"
  }'
```

### Summary: No SQL Needed

You can configure everything through:
1. **UI**: Tools page -> Tool details -> Tool Call Policies
2. **API**: `/api/autonomy-policies/tool-invocation` endpoints
3. **Generated SDK**: `archestraApiSdk.createToolInvocationPolicy()`

The SQL examples in this document are for bulk setup or database seeding only.

---

## Automatic Policy Creation on MCP Server Installation

### Goal

When the Browser MCP server is installed, automatically create:
1. **Allowlist policy** for all browser tools (sessionId validation)
2. **SSRF block policy** for `browser_navigate` (internal network protection)

### MCP Server Installation Flow

```
POST /api/mcp_server (Install MCP Server)
         │
         ▼
┌─────────────────────────────────┐
│ 1. Create MCP Server record     │
│ 2. Start K8s pod (if local)     │
│ 3. Fetch tools from server      │
│ 4. Create tools in database     │  ◄── HOOK POINT
│ 5. Assign tools to agents       │  ◄── HOOK POINT
└─────────────────────────────────┘
```

**Key File**: `backend/src/routes/mcp-server.ts`

### Implementation Option 1: Hook After Tool Assignment

Add policy creation after tools are assigned to agents (lines 340-349 for local, 429-431 for remote):

```typescript
// backend/src/routes/mcp-server.ts

// After line 349 (local servers) or line 431 (remote servers):
// ... existing tool assignment code ...

// NEW: Create default policies for browser tools
if (mcpServer.name.includes("browser") || catalogItem?.name?.includes("Browser")) {
  await createBrowserDefaultPolicies(createdAgentTools, createdTools);
}
```

### Implementation Option 2: Policy Defaults Service (Recommended)

Create a dedicated service for default policy creation:

```typescript
// backend/src/services/policy-defaults.ts

import { ToolInvocationPolicyModel } from "@/models";
import type { Tool, AgentTool } from "@/types";

interface PolicyDefault {
  argumentName: string;
  operator: "regex" | "contains" | "startsWith" | "equal";
  value: string;
  action: "allow_when_context_is_untrusted" | "block_always";
  reason: string;
}

// Define default policies per MCP server type
const BROWSER_TOOL_POLICIES: Record<string, PolicyDefault[]> = {
  // Apply to ALL browser tools
  "*": [
    {
      argumentName: "sessionId",
      operator: "regex",
      value: "^browser-session-[0-9]+$",
      action: "allow_when_context_is_untrusted",
      reason: "Allow browser tools with valid session format",
    },
  ],
  // Apply only to browser_navigate
  "browser_navigate": [
    {
      argumentName: "url",
      operator: "regex",
      value: "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|0\\.0\\.0\\.0|169\\.254\\.|metadata\\.google|metadata\\.aws)",
      action: "block_always",
      reason: "Block internal network and cloud metadata access (SSRF protection)",
    },
  ],
};

/**
 * Create default policies for browser MCP tools
 */
export async function createBrowserDefaultPolicies(
  agentTools: AgentTool[],
  tools: Tool[]
): Promise<void> {
  for (const agentTool of agentTools) {
    const tool = tools.find((t) => t.id === agentTool.toolId);
    if (!tool) continue;

    // Get tool-specific policies + wildcard policies
    const toolName = tool.name.replace("archestra_browser__", "");
    const policies = [
      ...(BROWSER_TOOL_POLICIES["*"] || []),
      ...(BROWSER_TOOL_POLICIES[toolName] || []),
    ];

    for (const policy of policies) {
      try {
        await ToolInvocationPolicyModel.create({
          agentToolId: agentTool.id,
          ...policy,
        });
      } catch (error) {
        // Policy may already exist - skip
        console.warn(`Policy creation skipped for ${tool.name}: ${error}`);
      }
    }
  }
}

/**
 * Check if MCP server is a browser server
 */
export function isBrowserMcpServer(
  mcpServerName: string,
  catalogName?: string
): boolean {
  const name = (mcpServerName || catalogName || "").toLowerCase();
  return name.includes("browser");
}
```

### Integration into MCP Server Route

```typescript
// backend/src/routes/mcp-server.ts

import { createBrowserDefaultPolicies, isBrowserMcpServer } from "@/services/policy-defaults";

// Inside POST /api/mcp_server handler...

// After tools are created and assigned (around line 349 for local):
if (agentIds && agentIds.length > 0) {
  const createdAgentTools = await AgentToolModel.bulkCreateForAgentsAndTools(
    agentIds.flatMap((agentId) =>
      createdTools.map((tool) => ({ agentId, toolId: tool.id }))
    )
  );

  // NEW: Create default policies for browser MCP
  if (isBrowserMcpServer(mcpServer.name, catalogItem?.name)) {
    await createBrowserDefaultPolicies(createdAgentTools, createdTools);
    fastify.log.info(
      { mcpServerId: mcpServer.id, toolCount: createdTools.length },
      "Created default browser security policies"
    );
  }
}
```

### Implementation Option 3: Catalog-Driven Defaults (Most Flexible)

Store default policies in the MCP catalog entry:

```typescript
// backend/src/database/schemas/internal-mcp-catalog.ts

// Add to schema:
defaultPolicies: jsonb("default_policies").$type<{
  toolInvocation?: Array<{
    toolPattern: string;  // regex to match tool names
    argumentName: string;
    operator: string;
    value: string;
    action: string;
    reason: string;
  }>;
  trustedData?: Array<{
    toolPattern: string;
    attributePath: string;
    operator: string;
    value: string;
    action: string;
    description: string;
  }>;
}>(),
```

Then in seed.ts:

```typescript
// backend/src/database/seed.ts

await InternalMcpCatalogModel.create({
  name: "Archestra Browser",
  // ... existing config ...
  defaultPolicies: {
    toolInvocation: [
      {
        toolPattern: ".*",  // All tools
        argumentName: "sessionId",
        operator: "regex",
        value: "^browser-session-[0-9]+$",
        action: "allow_when_context_is_untrusted",
        reason: "Allow browser tools with valid session",
      },
      {
        toolPattern: "browser_navigate",
        argumentName: "url",
        operator: "regex",
        value: "(localhost|127\\.0\\.0\\.1|192\\.168\\.|10\\.|...)",
        action: "block_always",
        reason: "SSRF protection",
      },
    ],
  },
});
```

### Files to Modify

| File | Change |
|------|--------|
| `backend/src/services/policy-defaults.ts` | **Create** - Policy defaults service |
| `backend/src/routes/mcp-server.ts` | **Modify** - Call policy defaults after tool assignment |
| `backend/src/database/seed.ts` | **Optional** - Add defaultPolicies to browser catalog |
| `backend/src/database/schemas/internal-mcp-catalog.ts` | **Optional** - Add defaultPolicies field |

### Sequence Diagram

```
┌──────────┐     ┌───────────┐     ┌───────────┐     ┌─────────────┐
│  Client  │     │ MCP Route │     │ToolModel  │     │PolicyDefaults│
└────┬─────┘     └─────┬─────┘     └─────┬─────┘     └──────┬──────┘
     │                 │                 │                   │
     │ POST /api/mcp_server              │                   │
     │────────────────>│                 │                   │
     │                 │                 │                   │
     │                 │ bulkCreateTools │                   │
     │                 │────────────────>│                   │
     │                 │                 │                   │
     │                 │    createdTools │                   │
     │                 │<────────────────│                   │
     │                 │                 │                   │
     │                 │ createAgentTools│                   │
     │                 │────────────────>│                   │
     │                 │                 │                   │
     │                 │  agentTools     │                   │
     │                 │<────────────────│                   │
     │                 │                 │                   │
     │                 │ createBrowserDefaultPolicies        │
     │                 │────────────────────────────────────>│
     │                 │                 │                   │
     │                 │                 │  ToolInvocationPolicy.create()
     │                 │                 │                   │───────┐
     │                 │                 │                   │       │ (per tool)
     │                 │                 │                   │<──────┘
     │                 │                 │                   │
     │   201 Created   │                 │                   │
     │<────────────────│                 │                   │
```

### Summary

**Recommended approach**: Option 2 (Policy Defaults Service)

- Clean separation of concerns
- Easy to extend for other MCP servers
- No schema changes required
- Can be unit tested independently

**Implementation effort**: ~2-3 hours
- Create `policy-defaults.ts` service
- Modify `mcp-server.ts` to call service
- Add tests
