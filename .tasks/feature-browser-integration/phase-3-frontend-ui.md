# Phase 3: Frontend UI Components

**Priority**: Critical
**Dependencies**: Phase 2
**Complexity**: Medium

---

## Objective

Display browser state inline in chat messages. Create UI components for screenshot display, user interaction (click overlay), and navigation controls.

---

## Deliverables

- [ ] 3.1 - Create BrowserPreview component
- [ ] 3.2 - Integrate with chat message rendering
- [ ] 3.3 - Add click overlay for user interaction
- [ ] 3.4 - Add session status indicator
- [ ] 3.5 - Write tests

---

## Task 3.1: Create BrowserPreview Component

Create the main component for displaying browser screenshots.

### Files to Create

- `frontend/src/components/chat/browser-preview.tsx`

### Component Implementation

```typescript
// frontend/src/components/chat/browser-preview.tsx
"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Globe,
  MousePointer,
  Maximize2,
  Minimize2,
  X,
  ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BrowserPreviewProps {
  screenshot: string;  // Base64 PNG
  url: string;
  title?: string;
  sessionId?: string;
  onClose?: () => void;
  onNavigate?: (url: string) => void;
  onClickCoordinates?: (x: number, y: number) => void;
  className?: string;
}

export function BrowserPreview({
  screenshot,
  url,
  title,
  sessionId,
  onClose,
  onNavigate,
  onClickCoordinates,
  className
}: BrowserPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [clickMode, setClickMode] = useState(false);
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null);

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!clickMode || !onClickCoordinates) return;

    const rect = e.currentTarget.getBoundingClientRect();
    // Convert click position to browser coordinates (1280x720)
    const x = Math.round((e.clientX - rect.left) / rect.width * 1280);
    const y = Math.round((e.clientY - rect.top) / rect.height * 720);

    setLastClick({ x, y });
    onClickCoordinates(x, y);
    setClickMode(false);
  }, [clickMode, onClickCoordinates]);

  const displayUrl = url.length > 50 ? `${url.substring(0, 50)}...` : url;

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      isExpanded ? "fixed inset-4 z-50 flex flex-col" : "max-w-2xl",
      className
    )}>
      <CardHeader className="py-2 px-3 flex flex-row items-center gap-2 border-b bg-muted/30">
        <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium truncate flex-1" title={url}>
          {title || displayUrl}
        </span>

        {/* Session indicator */}
        {sessionId && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>Live</span>
          </div>
        )}

        <div className="flex gap-1 flex-shrink-0">
          {/* Click mode toggle */}
          {onClickCoordinates && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setClickMode(!clickMode)}
              title={clickMode ? "Cancel click mode" : "Click on page"}
            >
              <MousePointer className={cn(
                "h-3 w-3",
                clickMode && "text-primary"
              )} />
            </Button>
          )}

          {/* Open in new tab */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => window.open(url, "_blank")}
            title="Open in new tab"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>

          {/* Expand/collapse */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Minimize" : "Expand"}
          >
            {isExpanded ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>

          {/* Close */}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className={cn(
        "p-2",
        isExpanded && "flex-1 overflow-auto"
      )}>
        <div className="relative">
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt={`Browser screenshot of ${url}`}
            className={cn(
              "rounded border w-full",
              clickMode ? "cursor-crosshair" : "cursor-default",
              isExpanded && "max-h-full object-contain"
            )}
            onClick={handleImageClick}
          />

          {/* Click mode overlay */}
          {clickMode && (
            <div className="absolute inset-0 bg-primary/10 rounded pointer-events-none flex items-center justify-center">
              <span className="text-sm bg-background/90 px-3 py-1.5 rounded-full shadow-sm">
                Click anywhere on the page
              </span>
            </div>
          )}

          {/* Last click indicator */}
          {lastClick && (
            <div
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                left: `${(lastClick.x / 1280) * 100}%`,
                top: `${(lastClick.y / 720) * 100}%`
              }}
            >
              <div className="w-full h-full rounded-full bg-primary/50 animate-ping" />
              <div className="absolute inset-0 w-2 h-2 m-auto rounded-full bg-primary" />
            </div>
          )}
        </div>

        {/* URL bar */}
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{url}</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Acceptance Criteria

- [ ] Component renders screenshot correctly
- [ ] URL displayed in header
- [ ] Expand/collapse works
- [ ] Responsive design

---

## Task 3.2: Integrate with Chat Message Rendering

Add browser preview rendering to chat messages.

### Files to Modify

- `frontend/src/components/chat/chat-messages.tsx`
- `frontend/src/components/chat/tool-result-renderer.tsx` (or equivalent)

### Implementation

```typescript
// frontend/src/components/chat/tool-result-renderer.tsx

import { BrowserPreview } from "./browser-preview";

interface BrowserToolResult {
  status: string;
  screenshot?: string;
  url?: string;
  title?: string;
  sessionId?: string;
  content?: string | object;
  error?: string;
}

function isBrowserToolResult(toolName: string): boolean {
  return toolName.startsWith("archestra__browser_");
}

function parseBrowserResult(result: unknown): BrowserToolResult | null {
  try {
    if (typeof result === "string") {
      return JSON.parse(result);
    }
    return result as BrowserToolResult;
  } catch {
    return null;
  }
}

export function renderToolResult(
  toolName: string,
  result: unknown,
  onClickCoordinates?: (x: number, y: number) => void
) {
  // Handle browser tools
  if (isBrowserToolResult(toolName)) {
    const browserResult = parseBrowserResult(result);

    if (browserResult?.screenshot) {
      return (
        <BrowserPreview
          screenshot={browserResult.screenshot}
          url={browserResult.url || ""}
          title={browserResult.title}
          sessionId={browserResult.sessionId}
          onClickCoordinates={onClickCoordinates}
        />
      );
    }

    // Non-screenshot browser result (e.g., get_content)
    if (browserResult?.content) {
      return (
        <div className="mt-2 p-3 bg-muted rounded-lg">
          <pre className="text-xs overflow-auto max-h-64">
            {typeof browserResult.content === "string"
              ? browserResult.content
              : JSON.stringify(browserResult.content, null, 2)}
          </pre>
        </div>
      );
    }

    // Error result
    if (browserResult?.error) {
      return (
        <div className="mt-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          {browserResult.error}
        </div>
      );
    }
  }

  // Default rendering for non-browser tools
  return (
    <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}
```

### Acceptance Criteria

- [ ] Browser screenshots render inline in chat
- [ ] Non-screenshot results (content) render properly
- [ ] Errors displayed with appropriate styling
- [ ] Fallback for unknown result formats

---

## Task 3.3: Add Click Overlay for User Interaction

Enable users to click on screenshots to interact with the browser.

### Implementation

The click overlay is already part of `BrowserPreview`. We need to wire it up to actually send click commands.

### Files to Modify

- `frontend/src/components/chat/chat-interface.tsx` (or equivalent)

### Wiring Click Handler

```typescript
// In the chat interface component

async function handleBrowserClick(x: number, y: number) {
  // Call the browser click tool via the profile's MCP gateway
  await sendMessage({
    role: "user",
    content: `[User clicked at coordinates (${x}, ${y}) on the browser screenshot]`
  });

  // Or directly call the tool if we have that capability
  // await callTool("archestra__browser_click", { x, y });
}

// Pass to BrowserPreview
<BrowserPreview
  {...props}
  onClickCoordinates={handleBrowserClick}
/>
```

### Alternative: Direct Tool Call

```typescript
// frontend/src/hooks/use-browser-actions.ts
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useBrowserClick(profileId: string) {
  return useMutation({
    mutationFn: async ({ x, y }: { x: number; y: number }) => {
      // Call MCP Gateway with browser_click tool
      const response = await api.post(`/v1/mcp`, {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "archestra__browser_click",
          arguments: { x, y }
        },
        id: Date.now()
      }, {
        headers: {
          Authorization: `Bearer ${profileId}`
        }
      });

      return response.data;
    }
  });
}
```

### Acceptance Criteria

- [ ] Click mode toggle works
- [ ] Clicking sends coordinates to backend
- [ ] Click indicator shown on screenshot
- [ ] Response updates chat with new screenshot

---

## Task 3.4: Add Session Status Indicator

Show browser session status in the UI.

### Files to Create

- `frontend/src/components/chat/browser-session-indicator.tsx`

### Implementation

```typescript
// frontend/src/components/chat/browser-session-indicator.tsx
"use client";

import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";

interface BrowserSessionIndicatorProps {
  isActive: boolean;
  url?: string;
  className?: string;
}

export function BrowserSessionIndicator({
  isActive,
  url,
  className
}: BrowserSessionIndicatorProps) {
  if (!isActive) return null;

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full text-sm",
      className
    )}>
      <div className="relative">
        <Globe className="h-4 w-4" />
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" />
      </div>
      <span className="text-muted-foreground">
        Browser session active
        {url && (
          <>
            {" - "}
            <span className="font-medium truncate max-w-[200px] inline-block align-bottom">
              {new URL(url).hostname}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
```

### Integration with Chat Header

```typescript
// In chat header or message input area
<BrowserSessionIndicator
  isActive={hasBrowserSession}
  url={currentBrowserUrl}
/>
```

### Acceptance Criteria

- [ ] Indicator shows when browser session active
- [ ] Current domain displayed
- [ ] Green dot animation for "live" status
- [ ] Hidden when no session

---

## Task 3.5: Write Tests

Write tests for UI components.

### Component Tests

```typescript
// frontend/src/components/chat/__tests__/browser-preview.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserPreview } from "../browser-preview";

const mockScreenshot = "iVBORw0KGgoAAAANSUhEUg..."; // Base64 PNG

describe("BrowserPreview", () => {
  it("renders screenshot", () => {
    render(
      <BrowserPreview
        screenshot={mockScreenshot}
        url="https://example.com"
      />
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      expect.stringContaining("data:image/png;base64")
    );
  });

  it("displays URL", () => {
    render(
      <BrowserPreview
        screenshot={mockScreenshot}
        url="https://example.com"
      />
    );

    expect(screen.getByText("https://example.com")).toBeInTheDocument();
  });

  it("expands on button click", () => {
    render(
      <BrowserPreview
        screenshot={mockScreenshot}
        url="https://example.com"
      />
    );

    const expandButton = screen.getByTitle("Expand");
    fireEvent.click(expandButton);

    // Should have fixed positioning class
    expect(screen.getByRole("article")).toHaveClass("fixed");
  });

  it("enables click mode", () => {
    const handleClick = vi.fn();

    render(
      <BrowserPreview
        screenshot={mockScreenshot}
        url="https://example.com"
        onClickCoordinates={handleClick}
      />
    );

    const clickModeButton = screen.getByTitle("Click on page");
    fireEvent.click(clickModeButton);

    // Click on image
    const img = screen.getByRole("img");
    fireEvent.click(img, { clientX: 100, clientY: 100 });

    expect(handleClick).toHaveBeenCalled();
  });
});
```

### Acceptance Criteria

- [ ] Component tests pass
- [ ] Click interaction tests pass
- [ ] Accessibility tests pass (alt text, keyboard nav)

---

## Technical Notes

### Screenshot Size

- Browser viewport: 1280x720
- Screenshots returned as PNG base64
- Display scaled to fit container
- Click coordinates converted back to 1280x720

### Performance Considerations

- Screenshots can be large (~500KB-1MB)
- Consider lazy loading for older messages
- Use `loading="lazy"` on images outside viewport

### Accessibility

- Alt text describes screenshot content
- Keyboard navigation for click mode
- Screen reader announces session status

---

## Definition of Done

- [ ] All tasks completed
- [ ] All tests passing
- [ ] Components render correctly in chat
- [ ] Click interaction works end-to-end
- [ ] Responsive on mobile/tablet
- [ ] Code reviewed and approved

---

*Task file for Phase 3 of Browser Integration*
