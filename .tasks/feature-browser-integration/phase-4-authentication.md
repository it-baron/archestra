# Phase 4: Authentication

**Priority**: High
**Dependencies**: Phase 2
**Complexity**: Medium

---

## Objective

Enable secure credential injection for browser login. Implement agent-driven selector detection where the agent analyzes the page and provides form selectors, while credentials are injected server-side without ever being exposed to the LLM.

---

## Deliverables

- [ ] 4.1 - Add `browser_credential` secret type
- [ ] 4.2 - Create browser credential database schema and model
- [ ] 4.3 - Implement `archestra__browser_login` tool
- [ ] 4.4 - Implement `archestra__browser_request_user_action` tool
- [ ] 4.5 - Create browser credentials settings page
- [ ] 4.6 - Write tests

---

## Task 4.1: Add Browser Credential Secret Type

Extend the secret types to include browser credentials.

### Files to Modify

- `backend/src/types/secret.ts`

### Changes

```typescript
// backend/src/types/secret.ts

// Existing secret types...

export interface BrowserCredentialSecret {
  type: "browser_credential";
  username: string;
  password: string;
}

// Update SecretValue union type
export type SecretValue =
  | ApiKeySecret
  | DatabaseSecret
  | BrowserCredentialSecret  // NEW
  | GenericSecret;

// Type guard
export function isBrowserCredentialSecret(
  secret: SecretValue
): secret is BrowserCredentialSecret {
  return secret.type === "browser_credential";
}
```

### Acceptance Criteria

- [ ] `browser_credential` type defined
- [ ] Type guard function works
- [ ] Compatible with existing secretManager (DB/Vault)

---

## Task 4.2: Create Browser Credential Database Schema

Create database schema and model for browser credentials.

### Files to Create

- `backend/src/database/schemas/browser-credential.ts`
- `backend/src/models/browser-credential.ts`

### Database Schema

```typescript
// backend/src/database/schemas/browser-credential.ts

import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agentsTable } from "./agent";
import { secretTable } from "./secret";

export const browserCredentialTable = pgTable(
  "browser_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .references(() => agentsTable.id, { onDelete: "cascade" })
      .notNull(),
    domain: text("domain").notNull(),  // e.g., "github.com"
    secretId: uuid("secret_id")
      .references(() => secretTable.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => ({
    // One credential per domain per profile
    profileDomainUnique: uniqueIndex("browser_credential_profile_domain_idx")
      .on(table.profileId, table.domain)
  })
);

export type BrowserCredential = typeof browserCredentialTable.$inferSelect;
export type NewBrowserCredential = typeof browserCredentialTable.$inferInsert;
```

### Model Implementation

```typescript
// backend/src/models/browser-credential.ts

import { eq, and } from "drizzle-orm";
import { db } from "@/database";
import {
  browserCredentialTable,
  BrowserCredential,
  NewBrowserCredential
} from "@/database/schemas/browser-credential";
import { secretTable } from "@/database/schemas/secret";

export const BrowserCredentialModel = {
  async create(data: NewBrowserCredential): Promise<BrowserCredential> {
    const [credential] = await db
      .insert(browserCredentialTable)
      .values(data)
      .returning();
    return credential;
  },

  async findById(id: string): Promise<BrowserCredential | undefined> {
    const [credential] = await db
      .select()
      .from(browserCredentialTable)
      .where(eq(browserCredentialTable.id, id));
    return credential;
  },

  async findByProfileAndDomain(
    profileId: string,
    domain: string
  ): Promise<BrowserCredential | undefined> {
    const [credential] = await db
      .select()
      .from(browserCredentialTable)
      .where(
        and(
          eq(browserCredentialTable.profileId, profileId),
          eq(browserCredentialTable.domain, domain)
        )
      );
    return credential;
  },

  async findByProfile(profileId: string): Promise<BrowserCredential[]> {
    return db
      .select()
      .from(browserCredentialTable)
      .where(eq(browserCredentialTable.profileId, profileId));
  },

  async update(
    id: string,
    data: Partial<NewBrowserCredential>
  ): Promise<BrowserCredential | undefined> {
    const [credential] = await db
      .update(browserCredentialTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(browserCredentialTable.id, id))
      .returning();
    return credential;
  },

  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(browserCredentialTable)
      .where(eq(browserCredentialTable.id, id));
    return result.rowCount > 0;
  },

  async deleteByProfileAndDomain(
    profileId: string,
    domain: string
  ): Promise<boolean> {
    const result = await db
      .delete(browserCredentialTable)
      .where(
        and(
          eq(browserCredentialTable.profileId, profileId),
          eq(browserCredentialTable.domain, domain)
        )
      );
    return result.rowCount > 0;
  }
};
```

### Migration

```sql
-- Create browser_credential table
CREATE TABLE browser_credential (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  secret_id UUID NOT NULL REFERENCES secret(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Unique constraint: one credential per domain per profile
CREATE UNIQUE INDEX browser_credential_profile_domain_idx
  ON browser_credential(profile_id, domain);

-- Index for profile lookups
CREATE INDEX browser_credential_profile_id_idx
  ON browser_credential(profile_id);
```

### Acceptance Criteria

- [ ] Migration runs successfully
- [ ] Model CRUD operations work
- [ ] Unique constraint enforced
- [ ] Cascade delete works

---

## Task 4.3: Implement archestra__browser_login Tool

Add the login tool that injects credentials server-side.

### Files to Modify

- `backend/src/archestra-mcp-server.ts`

### Tool Definition

```typescript
{
  name: "archestra__browser_login",
  description: `Authenticate to a website using stored credentials.
You must first analyze the page with archestra__browser_get_content to detect form selectors.
Credentials are injected server-side and never exposed to the agent.

Workflow:
1. Navigate to login page
2. Call archestra__browser_get_content with format="accessibility"
3. Identify username, password, and submit selectors from the response
4. Call this tool with the detected selectors`,
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Domain to authenticate to (e.g., 'github.com')"
      },
      usernameSelector: {
        type: "string",
        description: "CSS selector for username/email field (detected from page)"
      },
      passwordSelector: {
        type: "string",
        description: "CSS selector for password field (detected from page)"
      },
      submitSelector: {
        type: "string",
        description: "CSS selector for submit button (detected from page)"
      }
    },
    required: ["domain", "usernameSelector", "passwordSelector", "submitSelector"]
  }
}
```

### Tool Execution

```typescript
case "archestra__browser_login": {
  const { domain, usernameSelector, passwordSelector, submitSelector } = args as {
    domain: string;
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
  };

  if (!session.browserState) {
    return errorResult("No browser session. Call archestra__browser_open first.");
  }

  // 1. Find credential for this domain + profile
  const credential = await BrowserCredentialModel.findByProfileAndDomain(
    profile.id,
    domain
  );

  if (!credential) {
    return errorResult(`No credentials configured for domain: ${domain}. Configure credentials in Settings > Browser Credentials.`);
  }

  // 2. Retrieve secret (server-side only)
  const secret = await secretManager.getSecret(credential.secretId);

  if (!isBrowserCredentialSecret(secret)) {
    return errorResult("Invalid credential format.");
  }

  // 3. Execute login via browser pod
  try {
    const result = await executeBrowserCommand(
      session.browserState.mcpServerId,
      "browser_fill_and_submit",
      {
        sessionId: session.browserState.sessionId,
        fields: [
          { selector: usernameSelector, value: secret.username },
          { selector: passwordSelector, value: secret.password }
        ],
        submitSelector
      }
    );

    // 4. Wait for navigation and take screenshot
    await new Promise(resolve => setTimeout(resolve, 2000));

    const screenshot = await executeBrowserCommand(
      session.browserState.mcpServerId,
      "browser_screenshot",
      { sessionId: session.browserState.sessionId }
    );

    session.browserState.lastScreenshot = screenshot.image;

    // 5. Return status only (NO credentials in response)
    return successResult({
      status: result.success ? "authenticated" : "failed",
      domain,
      message: result.success ? "Login successful" : result.error,
      screenshot: screenshot.image
    });
  } catch (error) {
    return errorResult(`Login failed: ${error.message}`);
  }
}
```

### Security Considerations

- Credentials retrieved from secretManager only
- Never included in tool response
- Never sent to LLM
- Logged only as "login attempted for domain X"

### Acceptance Criteria

- [ ] Tool retrieves credentials from secretManager
- [ ] Credentials never in response
- [ ] Login flow executes correctly
- [ ] Screenshot returned after login

---

## Task 4.4: Implement archestra__browser_request_user_action Tool

Fallback tool for CAPTCHAs, 2FA, and other edge cases.

### Tool Definition

```typescript
{
  name: "archestra__browser_request_user_action",
  description: `Request user to complete an action in the browser.
Use this when encountering CAPTCHAs, 2FA prompts, or other interactive challenges that cannot be automated.
The user will see the current screenshot with a click overlay to interact manually.`,
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why user action is needed (e.g., 'CAPTCHA detected', '2FA required')"
      },
      timeout: {
        type: "number",
        default: 120,
        description: "Seconds to wait for user action"
      }
    },
    required: ["reason"]
  }
}
```

### Tool Execution

```typescript
case "archestra__browser_request_user_action": {
  const { reason, timeout = 120 } = args as {
    reason: string;
    timeout?: number;
  };

  if (!session.browserState) {
    return errorResult("No browser session.");
  }

  // Take current screenshot
  const screenshot = await executeBrowserCommand(
    session.browserState.mcpServerId,
    "browser_screenshot",
    { sessionId: session.browserState.sessionId }
  );

  // Return special response that triggers UI interaction mode
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "awaiting_user_action",
        reason,
        timeout,
        screenshot: screenshot.image,
        sessionId: session.browserState.sessionId,
        instructions: `User action required: ${reason}. Please interact with the browser screenshot.`
      })
    }],
    isError: false,
    // Custom metadata for UI
    _meta: {
      requiresUserAction: true,
      actionType: "browser_interaction"
    }
  };
}
```

### Frontend Handling

```typescript
// Detect user action request in chat
function isUserActionRequired(result: unknown): boolean {
  const parsed = JSON.parse(result);
  return parsed.status === "awaiting_user_action";
}

// Show interactive mode
function UserActionOverlay({ screenshot, reason, onComplete }) {
  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center">
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Action Required: {reason}</CardTitle>
        </CardHeader>
        <CardContent>
          <BrowserPreview
            screenshot={screenshot}
            url=""
            onClickCoordinates={async (x, y) => {
              await browserClick(x, y);
              onComplete();
            }}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            Click on the screenshot to interact with the page
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Acceptance Criteria

- [ ] Tool returns special "awaiting_user_action" status
- [ ] UI shows interactive overlay
- [ ] User can click and interact
- [ ] Agent resumes after user action

---

## Task 4.5: Create Browser Credentials Settings Page

Create UI for managing browser credentials.

### Files to Create

- `frontend/src/app/settings/browser-credentials/page.tsx`
- `frontend/src/app/settings/browser-credentials/browser-credentials.query.ts`

### Settings Page

```typescript
// frontend/src/app/settings/browser-credentials/page.tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Plus, Trash2, Key } from "lucide-react";
import { getBrowserCredentials, createBrowserCredential, deleteBrowserCredential } from "./browser-credentials.query";
import { ProfileSelector } from "@/components/profile-selector";

export default function BrowserCredentialsPage() {
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: credentials, isLoading } = useQuery({
    queryKey: ["browser-credentials", selectedProfile],
    queryFn: () => getBrowserCredentials(selectedProfile!),
    enabled: !!selectedProfile
  });

  const createMutation = useMutation({
    mutationFn: createBrowserCredential,
    onSuccess: () => {
      queryClient.invalidateQueries(["browser-credentials"]);
      setIsAddDialogOpen(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBrowserCredential,
    onSuccess: () => {
      queryClient.invalidateQueries(["browser-credentials"]);
    }
  });

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Browser Credentials</h1>
          <p className="text-muted-foreground">
            Manage login credentials for browser automation
          </p>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!selectedProfile}>
              <Plus className="h-4 w-4 mr-2" />
              Add Credential
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Browser Credential</DialogTitle>
            </DialogHeader>
            <AddCredentialForm
              profileId={selectedProfile!}
              onSubmit={createMutation.mutate}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileSelector
            value={selectedProfile}
            onChange={setSelectedProfile}
          />
        </CardContent>
      </Card>

      {selectedProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Stored Credentials
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p>Loading...</p>
            ) : credentials?.length === 0 ? (
              <p className="text-muted-foreground">
                No credentials configured for this profile
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials?.map((cred) => (
                    <TableRow key={cred.id}>
                      <TableCell className="font-medium">{cred.domain}</TableCell>
                      <TableCell>{cred.username}</TableCell>
                      <TableCell>
                        {new Date(cred.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(cred.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddCredentialForm({ profileId, onSubmit, isLoading }) {
  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ profileId, domain, username, password });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="domain">Domain</Label>
        <Input
          id="domain"
          placeholder="github.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground mt-1">
          The website domain (without https://)
        </p>
      </div>

      <div>
        <Label htmlFor="username">Username / Email</Label>
        <Input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Saving..." : "Save Credential"}
      </Button>
    </form>
  );
}
```

### API Routes

```typescript
// backend/src/routes/browser-credentials.ts

import { FastifyPluginAsync } from "fastify";
import { BrowserCredentialModel } from "@/models/browser-credential";
import { secretManager } from "@/secrets";

export const browserCredentialsRoutes: FastifyPluginAsync = async (fastify) => {
  // List credentials for profile
  fastify.get("/api/browser-credentials/:profileId", async (request) => {
    const { profileId } = request.params as { profileId: string };
    const credentials = await BrowserCredentialModel.findByProfile(profileId);

    // Return without actual password
    return credentials.map(c => ({
      id: c.id,
      domain: c.domain,
      createdAt: c.createdAt,
      // Get username only (no password)
      username: "***" // Placeholder
    }));
  });

  // Create credential
  fastify.post("/api/browser-credentials", async (request) => {
    const { profileId, domain, username, password } = request.body as {
      profileId: string;
      domain: string;
      username: string;
      password: string;
    };

    // 1. Create secret
    const secret = await secretManager.createSecret({
      type: "browser_credential",
      username,
      password
    });

    // 2. Create credential record
    const credential = await BrowserCredentialModel.create({
      profileId,
      domain: domain.toLowerCase().replace(/^https?:\/\//, ""),
      secretId: secret.id
    });

    return { id: credential.id, domain: credential.domain };
  });

  // Delete credential
  fastify.delete("/api/browser-credentials/:id", async (request) => {
    const { id } = request.params as { id: string };

    // Credential deletion cascades to secret
    await BrowserCredentialModel.delete(id);

    return { success: true };
  });
};
```

### Acceptance Criteria

- [ ] Settings page accessible at /settings/browser-credentials
- [ ] Can add/delete credentials per profile per domain
- [ ] Passwords never displayed in UI
- [ ] Credentials stored via secretManager

---

## Task 4.6: Write Tests

Write tests for authentication functionality.

### Backend Tests

```typescript
// backend/src/models/__tests__/browser-credential.test.ts
import { test, expect } from "@/test";
import { BrowserCredentialModel } from "../browser-credential";

test("creates browser credential", async ({ makeAgent }) => {
  const agent = await makeAgent();

  const credential = await BrowserCredentialModel.create({
    profileId: agent.id,
    domain: "github.com",
    secretId: "secret-123"
  });

  expect(credential.domain).toBe("github.com");
  expect(credential.profileId).toBe(agent.id);
});

test("enforces unique domain per profile", async ({ makeAgent }) => {
  const agent = await makeAgent();

  await BrowserCredentialModel.create({
    profileId: agent.id,
    domain: "github.com",
    secretId: "secret-1"
  });

  await expect(
    BrowserCredentialModel.create({
      profileId: agent.id,
      domain: "github.com",
      secretId: "secret-2"
    })
  ).rejects.toThrow();
});

test("finds by profile and domain", async ({ makeAgent }) => {
  const agent = await makeAgent();

  await BrowserCredentialModel.create({
    profileId: agent.id,
    domain: "github.com",
    secretId: "secret-123"
  });

  const credential = await BrowserCredentialModel.findByProfileAndDomain(
    agent.id,
    "github.com"
  );

  expect(credential).toBeDefined();
  expect(credential?.domain).toBe("github.com");
});
```

### Tool Tests

```typescript
// backend/src/archestra-mcp-server/__tests__/browser-login.test.ts
import { test, expect } from "@/test";

test("browser_login requires credentials", async ({ makeAgent }) => {
  const agent = await makeAgent();
  const session = { agentId: agent.id, browserState: { sessionId: "test" } };

  const result = await executeArchestraBrowserTool(
    "archestra__browser_login",
    {
      domain: "example.com",
      usernameSelector: "#user",
      passwordSelector: "#pass",
      submitSelector: "#submit"
    },
    { profile: agent, session }
  );

  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text).error).toContain("No credentials configured");
});
```

### Acceptance Criteria

- [ ] Model tests pass
- [ ] Tool tests pass
- [ ] API route tests pass

---

## Technical Notes

### Credential Storage

Credentials are stored using the existing `secretManager`:
- **DB Mode**: Encrypted in PostgreSQL
- **Vault Mode**: Stored in HashiCorp Vault

The `browser_credential` table only stores references (secretId), not actual credentials.

### Agent-Driven Login Flow

1. Agent navigates to login page
2. Agent calls `archestra__browser_get_content` with `format: "accessibility"`
3. Response includes form structure with selectors:
   ```json
   {
     "forms": [{
       "fields": [
         { "type": "text", "name": "login", "selector": "#login_field" },
         { "type": "password", "selector": "#password" }
       ],
       "submit": { "selector": "input[type='submit']" }
     }]
   }
   ```
4. Agent extracts selectors and calls `archestra__browser_login`
5. Backend retrieves credentials and fills form

### Security Audit Log

All login attempts are logged in `mcp_tool_call`:
```json
{
  "toolName": "archestra__browser_login",
  "arguments": {
    "domain": "github.com",
    "usernameSelector": "#login_field",
    "passwordSelector": "#password",
    "submitSelector": "input[type='submit']"
  }
}
```

Note: Actual credentials are **never** logged.

---

## Definition of Done

- [ ] All tasks completed
- [ ] All tests passing
- [ ] Credentials stored securely
- [ ] Login flow works end-to-end
- [ ] Settings page functional
- [ ] Code reviewed and approved

---

*Task file for Phase 4 of Browser Integration*
