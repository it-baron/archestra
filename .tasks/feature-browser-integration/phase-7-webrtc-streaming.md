# Phase 7: WebRTC Live Streaming (Optional)

**Priority**: Optional Enhancement
**Dependencies**: Phases 1-6
**Complexity**: High

---

## Objective

Provide real-time video streaming of browser sessions using [Neko](https://github.com/m1k1o/neko) (Apache-2.0 licensed). This enables users to watch agent actions in real-time and optionally take control of the browser mid-session.

---

## Why WebRTC Streaming?

| Use Case | Screenshots (Phases 1-6) | WebRTC (Phase 7) |
|----------|--------------------------|------------------|
| Quick page inspection | Sufficient | Overkill |
| Long-running automation | Limited | Excellent |
| Watching agent work | Choppy | Smooth |
| User takeover | Clunky | Seamless |
| Bandwidth usage | Lower | Higher |
| Implementation complexity | Low | High |

---

## Deliverables

- [ ] 7.1 - Neko-based Docker image with MCP integration
- [ ] 7.2 - WebRTC signaling integration
- [ ] 7.3 - BrowserStreamView frontend component
- [ ] 7.4 - Hybrid mode (screenshots + streaming)
- [ ] 7.5 - User takeover capability
- [ ] 7.6 - Write tests

---

## Task 7.1: Neko-Based Docker Image

Create a Docker image combining Neko's WebRTC streaming with MCP server capabilities.

### Architecture Option A: Neko as Browser Runtime

Use Neko container with Playwright connecting via CDP:

```dockerfile
# packages/browser-mcp-server/Dockerfile.neko
FROM ghcr.io/m1k1o/neko/chromium:latest

# Install Node.js
RUN apt-get update && apt-get install -y nodejs npm
RUN npm install -g pnpm

# Add MCP server layer
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Neko configuration
ENV NEKO_BIND=:8080
ENV NEKO_EPR=52000-52100
ENV NEKO_SCREEN=1280x720@30

# MCP server will connect to Chrome via CDP
ENV CHROME_CDP_URL=http://localhost:9222

# Supervisor to run both Neko and MCP server
COPY supervisord.conf /etc/supervisor/conf.d/
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
```

### Supervisor Configuration

```ini
# supervisord.conf
[supervisord]
nodaemon=true

[program:neko]
command=/usr/bin/neko serve
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0

[program:mcp-server]
command=node /app/dist/server.js
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
```

### MCP Server with CDP Connection

```typescript
// packages/browser-mcp-server/src/neko-browser-manager.ts
import { chromium, Browser } from "playwright";

export class NekoBrowserManager {
  private browser: Browser | null = null;
  private cdpUrl = process.env.CHROME_CDP_URL || "http://localhost:9222";

  async connect(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    // Connect to Neko's browser via Chrome DevTools Protocol
    this.browser = await chromium.connectOverCDP(this.cdpUrl);

    return this.browser;
  }

  async getPage() {
    const browser = await this.connect();
    const contexts = browser.contexts();

    if (contexts.length === 0) {
      throw new Error("No browser context available");
    }

    const pages = contexts[0].pages();
    return pages[0] || await contexts[0].newPage();
  }
}
```

### Acceptance Criteria

- [ ] Docker image builds successfully
- [ ] Neko starts and streams video
- [ ] MCP server connects via CDP
- [ ] Playwright commands work while streaming

---

## Task 7.2: WebRTC Signaling Integration

Integrate WebRTC signaling with Archestra backend.

### Files to Create

- `backend/src/routes/browser-stream.ts`
- `backend/src/browser/webrtc-signaling.ts`

### Signaling Proxy

```typescript
// backend/src/routes/browser-stream.ts
import { FastifyPluginAsync } from "fastify";
import websocket from "@fastify/websocket";

export const browserStreamRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(websocket);

  // WebSocket proxy to Neko
  fastify.get(
    "/api/browser-stream/:serverId",
    { websocket: true },
    async (connection, request) => {
      const { serverId } = request.params as { serverId: string };

      // Get browser pod details
      const server = await McpServerModel.findById(serverId);
      if (!server) {
        connection.socket.close(4004, "Server not found");
        return;
      }

      // Get pod IP and connect to Neko WebSocket
      const podIp = await getPodIp(server.id);
      const nekoWs = new WebSocket(`ws://${podIp}:8080/ws`);

      // Proxy messages between client and Neko
      connection.socket.on("message", (data) => {
        nekoWs.send(data);
      });

      nekoWs.on("message", (data) => {
        connection.socket.send(data);
      });

      nekoWs.on("close", () => {
        connection.socket.close();
      });

      connection.socket.on("close", () => {
        nekoWs.close();
      });
    }
  );
};
```

### TURN/STUN Configuration

```typescript
// backend/src/browser/webrtc-signaling.ts

interface IceConfig {
  iceServers: {
    urls: string[];
    username?: string;
    credential?: string;
  }[];
}

export function getIceConfig(): IceConfig {
  return {
    iceServers: [
      // Public STUN servers
      { urls: ["stun:stun.l.google.com:19302"] },
      // Add TURN server if configured
      ...(process.env.TURN_SERVER_URL ? [{
        urls: [process.env.TURN_SERVER_URL],
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      }] : [])
    ]
  };
}
```

### Acceptance Criteria

- [ ] WebSocket signaling proxy works
- [ ] ICE configuration available
- [ ] Connection established through NAT
- [ ] Graceful disconnect handling

---

## Task 7.3: BrowserStreamView Frontend Component

Create React component for WebRTC video playback.

### Files to Create

- `frontend/src/components/chat/browser-stream-view.tsx`

### Implementation

```typescript
// frontend/src/components/chat/browser-stream-view.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
  MousePointer,
  Hand,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BrowserStreamViewProps {
  serverId: string;
  sessionId: string;
  onControl?: (event: ControlEvent) => void;
  className?: string;
}

interface ControlEvent {
  type: "click" | "move" | "scroll" | "key";
  x?: number;
  y?: number;
  key?: string;
  deltaY?: number;
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "failed";

export function BrowserStreamView({
  serverId,
  sessionId,
  onControl,
  className
}: BrowserStreamViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [isExpanded, setIsExpanded] = useState(false);
  const [controlMode, setControlMode] = useState(false);

  // Initialize WebRTC connection
  useEffect(() => {
    const connect = async () => {
      try {
        setConnectionState("connecting");

        // Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
          ]
        });
        pcRef.current = pc;

        // Handle incoming video stream
        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setConnectionState("connected");
          }
        };

        // Connect to signaling server
        const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/browser-stream/${serverId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          // Request offer from Neko
          ws.send(JSON.stringify({ type: "signal/request" }));
        };

        ws.onmessage = async (event) => {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "signal/offer":
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(JSON.stringify({
                type: "signal/answer",
                sdp: answer
              }));
              break;

            case "signal/candidate":
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              break;
          }
        };

        ws.onclose = () => {
          setConnectionState("disconnected");
        };

        ws.onerror = () => {
          setConnectionState("failed");
        };

        // Send ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "signal/candidate",
              candidate: event.candidate
            }));
          }
        };

      } catch (error) {
        console.error("WebRTC connection failed:", error);
        setConnectionState("failed");
      }
    };

    connect();

    return () => {
      wsRef.current?.close();
      pcRef.current?.close();
    };
  }, [serverId]);

  // Handle mouse events for control
  const handleMouseEvent = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (!controlMode || !onControl || !videoRef.current) return;

    const rect = videoRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / rect.width * 1280);
    const y = Math.round((e.clientY - rect.top) / rect.height * 720);

    if (e.type === "click") {
      onControl({ type: "click", x, y });
      sendControlToNeko("click", x, y);
    } else if (e.type === "mousemove") {
      sendControlToNeko("move", x, y);
    }
  }, [controlMode, onControl]);

  const sendControlToNeko = (type: string, x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: `control/${type}`,
        x,
        y
      }));
    }
  };

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      isExpanded && "fixed inset-4 z-50 flex flex-col",
      className
    )}>
      <CardHeader className="py-2 px-3 flex flex-row items-center gap-2 border-b bg-muted/30">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          {connectionState === "connected" ? (
            <Video className="h-4 w-4 text-green-500" />
          ) : connectionState === "connecting" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <VideoOff className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {connectionState === "connected" ? "Live Stream" :
             connectionState === "connecting" ? "Connecting..." :
             "Disconnected"}
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex gap-1">
          {/* Control mode toggle */}
          {onControl && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setControlMode(!controlMode)}
              title={controlMode ? "Disable control" : "Take control"}
            >
              {controlMode ? (
                <Hand className="h-3 w-3 text-primary" />
              ) : (
                <MousePointer className="h-3 w-3" />
              )}
            </Button>
          )}

          {/* Expand/collapse */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className={cn(
        "p-2",
        isExpanded && "flex-1 overflow-hidden"
      )}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            "w-full rounded border bg-black",
            controlMode && "cursor-pointer",
            isExpanded && "h-full object-contain"
          )}
          style={{ aspectRatio: "16/9" }}
          onClick={handleMouseEvent}
          onMouseMove={controlMode ? handleMouseEvent : undefined}
        />

        {/* Control mode indicator */}
        {controlMode && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            You are in control. Click to interact with the browser.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### Acceptance Criteria

- [ ] Video plays smoothly
- [ ] Connection state displayed
- [ ] Expand/collapse works
- [ ] Control mode toggle works

---

## Task 7.4: Hybrid Mode

Switch between screenshots and streaming based on context.

### Files to Create

- `frontend/src/components/chat/browser-hybrid-view.tsx`

### Implementation

```typescript
// frontend/src/components/chat/browser-hybrid-view.tsx
"use client";

import { useState } from "react";
import { BrowserPreview } from "./browser-preview";
import { BrowserStreamView } from "./browser-stream-view";
import { Button } from "@/components/ui/button";
import { Image, Video } from "lucide-react";

interface BrowserHybridViewProps {
  mode: "screenshot" | "stream";
  serverId: string;
  sessionId: string;
  screenshot?: string;
  url?: string;
  onModeChange?: (mode: "screenshot" | "stream") => void;
  onClickCoordinates?: (x: number, y: number) => void;
}

export function BrowserHybridView({
  mode,
  serverId,
  sessionId,
  screenshot,
  url,
  onModeChange,
  onClickCoordinates
}: BrowserHybridViewProps) {
  const [currentMode, setCurrentMode] = useState(mode);

  const handleModeChange = (newMode: "screenshot" | "stream") => {
    setCurrentMode(newMode);
    onModeChange?.(newMode);
  };

  return (
    <div className="space-y-2">
      {/* Mode switcher */}
      <div className="flex gap-1">
        <Button
          variant={currentMode === "screenshot" ? "default" : "outline"}
          size="sm"
          onClick={() => handleModeChange("screenshot")}
        >
          <Image className="h-4 w-4 mr-1" />
          Screenshot
        </Button>
        <Button
          variant={currentMode === "stream" ? "default" : "outline"}
          size="sm"
          onClick={() => handleModeChange("stream")}
        >
          <Video className="h-4 w-4 mr-1" />
          Live Stream
        </Button>
      </div>

      {/* Display based on mode */}
      {currentMode === "screenshot" && screenshot ? (
        <BrowserPreview
          screenshot={screenshot}
          url={url || ""}
          onClickCoordinates={onClickCoordinates}
        />
      ) : (
        <BrowserStreamView
          serverId={serverId}
          sessionId={sessionId}
          onControl={onClickCoordinates ?
            (e) => e.type === "click" && onClickCoordinates(e.x!, e.y!) :
            undefined
          }
        />
      )}
    </div>
  );
}
```

### When to Use Each Mode

```typescript
// Auto-select mode based on context
function selectBrowserMode(context: BrowserContext): "screenshot" | "stream" {
  // Prefer streaming for:
  if (context.isLongRunning) return "stream";
  if (context.userWantsToWatch) return "stream";
  if (context.requiresUserTakeover) return "stream";

  // Prefer screenshots for:
  if (context.isMobile) return "screenshot";
  if (context.lowBandwidth) return "screenshot";
  if (context.isReplay) return "screenshot";

  // Default
  return "screenshot";
}
```

### Acceptance Criteria

- [ ] Mode switcher works
- [ ] Smooth transition between modes
- [ ] State preserved when switching
- [ ] Auto-select based on context

---

## Task 7.5: User Takeover Capability

Allow users to take control of the browser mid-session.

### Control Events

```typescript
// Keyboard events
interface KeyEvent {
  type: "key";
  key: string;
  modifiers?: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  };
}

// Scroll events
interface ScrollEvent {
  type: "scroll";
  deltaY: number;
  x: number;
  y: number;
}

// Full control message
type ControlMessage =
  | { type: "control/click"; x: number; y: number }
  | { type: "control/move"; x: number; y: number }
  | { type: "control/key"; key: string; modifiers?: object }
  | { type: "control/scroll"; deltaY: number };
```

### Takeover UI

```typescript
// Add to BrowserStreamView

const [isTakeover, setIsTakeover] = useState(false);

// Keyboard handler
useEffect(() => {
  if (!isTakeover) return;

  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    sendControlToNeko("key", 0, 0, {
      key: e.key,
      modifiers: {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey
      }
    });
  };

  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [isTakeover]);

// Takeover mode toggle
<Button
  variant={isTakeover ? "default" : "outline"}
  onClick={() => setIsTakeover(!isTakeover)}
>
  {isTakeover ? "Release Control" : "Take Control"}
</Button>
```

### Backend: Pause Agent During Takeover

```typescript
// backend/src/browser/takeover.ts

export async function pauseAgentForTakeover(
  sessionId: string
): Promise<void> {
  // Set flag in session state
  const session = await getSession(sessionId);
  session.browserState.userInControl = true;

  // Notify agent that user is in control
  // Agent should wait for release
}

export async function releaseControlToAgent(
  sessionId: string
): Promise<void> {
  const session = await getSession(sessionId);
  session.browserState.userInControl = false;

  // Agent can resume
}
```

### Acceptance Criteria

- [ ] Mouse click/move events work
- [ ] Keyboard input works
- [ ] Agent pauses during takeover
- [ ] Control released cleanly

---

## Task 7.6: Write Tests

### WebRTC Connection Tests

```typescript
// frontend/src/components/chat/__tests__/browser-stream-view.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserStreamView } from "../browser-stream-view";

// Mock WebRTC
const mockPeerConnection = {
  ontrack: null,
  onicecandidate: null,
  setRemoteDescription: vi.fn(),
  createAnswer: vi.fn().mockResolvedValue({ type: "answer" }),
  setLocalDescription: vi.fn(),
  addIceCandidate: vi.fn(),
  close: vi.fn()
};

vi.mock("RTCPeerConnection", () => vi.fn(() => mockPeerConnection));

describe("BrowserStreamView", () => {
  it("shows connecting state initially", () => {
    render(
      <BrowserStreamView
        serverId="server-1"
        sessionId="session-1"
      />
    );

    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("shows connected state when stream received", async () => {
    render(
      <BrowserStreamView
        serverId="server-1"
        sessionId="session-1"
      />
    );

    // Simulate track event
    mockPeerConnection.ontrack({
      streams: [new MediaStream()]
    });

    await waitFor(() => {
      expect(screen.getByText("Live Stream")).toBeInTheDocument();
    });
  });
});
```

### Control Event Tests

```typescript
// frontend/src/components/chat/__tests__/browser-control.test.tsx
import { render, fireEvent } from "@testing-library/react";
import { BrowserStreamView } from "../browser-stream-view";

describe("Browser Control", () => {
  it("sends click events when in control mode", () => {
    const onControl = vi.fn();

    render(
      <BrowserStreamView
        serverId="server-1"
        sessionId="session-1"
        onControl={onControl}
      />
    );

    // Enable control mode
    fireEvent.click(screen.getByTitle("Take control"));

    // Click on video
    const video = screen.getByRole("video");
    fireEvent.click(video, { clientX: 100, clientY: 100 });

    expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "click" })
    );
  });
});
```

### Acceptance Criteria

- [ ] Connection tests pass
- [ ] Control event tests pass
- [ ] Hybrid mode tests pass
- [ ] Takeover tests pass

---

## Technical Notes

### Neko Configuration

```env
# Neko environment variables
NEKO_BIND=:8080
NEKO_EPR=52000-52100
NEKO_SCREEN=1280x720@30
NEKO_VIDEO_CODEC=vp8
NEKO_AUDIO_CODEC=opus
NEKO_NAT1TO1=  # Set to pod IP for NAT traversal
```

### Network Requirements

- WebSocket for signaling
- UDP for WebRTC media (ports 52000-52100)
- TURN server for restrictive NATs

### Bandwidth Considerations

| Quality | Resolution | Bitrate | Bandwidth |
|---------|------------|---------|-----------|
| Low | 640x360 | 500 Kbps | ~0.5 Mbps |
| Medium | 1280x720 | 1.5 Mbps | ~1.5 Mbps |
| High | 1280x720 | 3 Mbps | ~3 Mbps |

### Fallback Strategy

If WebRTC fails:
1. Attempt TURN server
2. Fall back to WebSocket with lower quality
3. Fall back to screenshot mode

---

## Definition of Done

- [ ] All tasks completed
- [ ] WebRTC streaming works
- [ ] User takeover works
- [ ] Hybrid mode works
- [ ] Tests passing
- [ ] Performance acceptable (< 100ms latency)
- [ ] Code reviewed and approved

---

*Task file for Phase 7 of Browser Integration*
