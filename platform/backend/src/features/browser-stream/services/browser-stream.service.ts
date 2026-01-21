import { isBrowserMcpTool } from "@shared";
import { getChatMcpClient } from "@/clients/chat-mcp-client";
import logger from "@/logging";
import { ToolModel } from "@/models";
import { ApiError } from "@/types";
import {
  applyNavigate,
  applyTabsClose,
  applyTabsCreate,
  applyTabsList,
  resolveIndexForTab,
} from "./browser-stream.state";
import {
  createInitialState,
  generateTabId,
} from "./browser-stream.state.conversion";
import { isErr, isOk, isSome } from "./browser-stream.state.helpers";
import {
  type BrowserState,
  type BrowserTabsListEntry,
  Some,
} from "./browser-stream.state.types";
import {
  browserStateManager,
  toConversationStateKey,
} from "./browser-stream.state-manager";

/**
 * User context required for MCP client authentication
 */
export interface BrowserUserContext {
  userId: string;
  userIsProfileAdmin: boolean;
}

export interface AvailabilityResult {
  available: boolean;
  tools?: string[];
  error?: string;
}

export interface NavigateResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface ScreenshotResult {
  screenshot?: string;
  url?: string;
  error?: string;
}

export interface TabResult {
  success: boolean;
  tabIndex?: number;
  tabs?: Array<{ index: number; title?: string; url?: string }>;
  error?: string;
}

export interface ClickResult {
  success: boolean;
  error?: string;
}

export interface TypeResult {
  success: boolean;
  error?: string;
}

export interface ScrollResult {
  success: boolean;
  error?: string;
}

export interface SnapshotResult {
  snapshot?: string;
  error?: string;
}

/**
 * Tracks which agent+user combos have been cleaned up after server restart.
 * On first browser panel open after restart, we close all orphaned tabs.
 */
type AgentUserKey = `${string}:${string}`;
const cleanedUpAgents = new Set<AgentUserKey>();

const toAgentUserKey = (agentId: string, userId: string): AgentUserKey =>
  `${agentId}:${userId}`;

/**
 * Service for browser streaming via Playwright MCP
 * Calls Playwright MCP tools directly through the MCP Gateway
 */
export class BrowserStreamService {
  private async findToolName(
    agentId: string,
    matches: (toolName: string) => boolean,
  ): Promise<string | null> {
    const tools = await ToolModel.getMcpToolsByAgent(agentId);

    for (const tool of tools) {
      const toolName = tool.name;
      if (typeof toolName === "string" && matches(toolName)) {
        return toolName;
      }
    }

    return null;
  }

  /**
   * Check if Playwright MCP browser tools are available for an agent
   */
  async checkAvailability(agentId: string): Promise<AvailabilityResult> {
    const tools = await ToolModel.getMcpToolsByAgent(agentId);
    const browserToolNames = tools.flatMap((tool) => {
      const toolName = tool.name;
      if (typeof toolName !== "string") return [];
      if (isBrowserMcpTool(toolName)) {
        return [toolName];
      }
      return [];
    });

    return {
      available: browserToolNames.length > 0,
      tools: browserToolNames,
    };
  }

  /**
   * Find the Playwright browser navigate tool for an agent
   */
  private async findNavigateTool(agentId: string): Promise<string | null> {
    return this.findToolName(
      agentId,
      (toolName) =>
        toolName.includes("browser_navigate") ||
        toolName.endsWith("__navigate") ||
        (toolName.includes("playwright") && toolName.includes("navigate")),
    );
  }

  /**
   * Find the Playwright browser screenshot tool for an agent
   */
  private async findScreenshotTool(agentId: string): Promise<string | null> {
    // Prefer browser_take_screenshot or browser_screenshot
    return this.findToolName(
      agentId,
      (toolName) =>
        toolName.includes("browser_take_screenshot") ||
        toolName.includes("browser_screenshot"),
    );
  }

  /**
   * Find the Playwright browser tabs tool for an agent
   */
  private async findTabsTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_tabs"),
    );
  }

  /**
   * Clean up orphaned browser tabs after server restart.
   * Closes all tabs except tab 0 (default tab) to start fresh.
   * Called once per agent+user combination after restart.
   */
  private async cleanupOrphanedTabs(
    agentId: string,
    userContext: BrowserUserContext,
    tabsTool: string,
    client: NonNullable<Awaited<ReturnType<typeof getChatMcpClient>>>,
  ): Promise<void> {
    const agentUserKey = toAgentUserKey(agentId, userContext.userId);

    // Skip if already cleaned up
    if (cleanedUpAgents.has(agentUserKey)) {
      return;
    }

    // Mark as cleaned up immediately to prevent concurrent cleanup attempts
    cleanedUpAgents.add(agentUserKey);

    try {
      // List all existing tabs
      const listResult = await client.callTool({
        name: tabsTool,
        arguments: { action: "list" },
      });

      if (listResult.isError) {
        logger.warn(
          { agentId, userId: userContext.userId },
          "Failed to list tabs for cleanup",
        );
        return;
      }

      const tabs = this.parseTabsList(listResult.content);

      // Close all tabs except tab 0 (close in reverse order to avoid index shifts)
      if (tabs.length > 1) {
        logger.info(
          { agentId, userId: userContext.userId, tabCount: tabs.length },
          "Cleaning up orphaned browser tabs after restart",
        );

        const closableTabs = tabs
          .filter((tab) => tab.index !== 0)
          .sort((a, b) => b.index - a.index);

        for (const tab of closableTabs) {
          try {
            await client.callTool({
              name: tabsTool,
              arguments: { action: "close", index: tab.index },
            });
          } catch (error) {
            logger.warn(
              {
                agentId,
                userId: userContext.userId,
                tabIndex: tab.index,
                error,
              },
              "Failed to close orphaned tab",
            );
          }
        }

        logger.info(
          { agentId, userId: userContext.userId },
          "Finished cleaning up orphaned browser tabs",
        );
      }
    } catch (error) {
      logger.error(
        { agentId, userId: userContext.userId, error },
        "Error during orphaned tabs cleanup",
      );
    }
  }

  /**
   * Select or create a browser tab for a conversation
   * Uses Playwright MCP browser_tabs tool and persists state to database
   */
  async selectOrCreateTab(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
  ): Promise<TabResult> {
    const tabsTool = await this.findTabsTool(agentId);
    if (!tabsTool) {
      logger.info(
        { agentId, conversationId },
        "No browser_tabs tool available, using shared browser page",
      );
      return { success: true, tabIndex: 0 };
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      return { success: false, error: "Failed to connect to MCP Gateway" };
    }

    // Clean up orphaned tabs on first access after server restart
    await this.cleanupOrphanedTabs(agentId, userContext, tabsTool, client);

    const stateKey = toConversationStateKey(
      agentId,
      userContext.userId,
      conversationId,
    );

    logger.info(
      {
        stateKey,
        agentId,
        userId: userContext.userId,
        conversationId,
      },
      "selectOrCreateTab called",
    );

    try {
      // Load existing state from cache or database
      const loadResult = await browserStateManager.getOrLoad({
        agentId,
        userId: userContext.userId,
        conversationId,
      });

      if (isErr(loadResult)) {
        logger.warn(
          { agentId, conversationId, error: loadResult.error },
          "Failed to load browser state, will create new",
        );
      }

      const existingState = isOk(loadResult) ? loadResult.value : null;

      // If we have existing state with a tab, try to resolve its index
      if (existingState && existingState.tabs.length > 0) {
        const activeTab = existingState.tabs.find(
          (t) => t.id === existingState.activeTabId,
        );

        // Check if we have a resolved index
        if (activeTab && isSome(activeTab.index)) {
          const existingTabIndex = activeTab.index.value;
          try {
            const selectExistingResult = await client.callTool({
              name: tabsTool,
              arguments: { action: "select", index: existingTabIndex },
            });

            if (!selectExistingResult.isError) {
              logger.info(
                {
                  agentId,
                  conversationId,
                  tabIndex: existingTabIndex,
                  action: "switch_to_existing_tab",
                },
                "[BrowserTabs] Switched to existing tab for conversation",
              );
              return { success: true, tabIndex: existingTabIndex };
            }

            const errorText = this.extractTextContent(
              selectExistingResult.content,
            );
            logger.warn(
              {
                agentId,
                conversationId,
                tabIndex: existingTabIndex,
                error: errorText,
              },
              "Failed to select existing conversation tab, will sync indices",
            );
          } catch (selectError) {
            logger.warn(
              {
                agentId,
                conversationId,
                tabIndex: existingTabIndex,
                error:
                  selectError instanceof Error
                    ? selectError.message
                    : String(selectError),
              },
              "Exception selecting existing tab, will sync indices",
            );
          }
        }

        // If index unavailable or selection failed, sync with browser_tabs.list
        const listResult = await client.callTool({
          name: tabsTool,
          arguments: { action: "list" },
        });

        if (!listResult.isError) {
          const browserTabs = this.parseTabsList(listResult.content);
          const listEntries = this.toBrowserTabsListEntries(browserTabs);

          // Check if tab counts match - if so, sync indices
          if (listEntries.length === existingState.tabs.length) {
            const syncResult = applyTabsList({
              state: existingState,
              list: listEntries,
            });

            if (isOk(syncResult)) {
              const updatedState = syncResult.value;
              await browserStateManager.set({
                agentId,
                userId: userContext.userId,
                conversationId,
                state: updatedState,
              });

              const indexResult = resolveIndexForTab({
                state: updatedState,
                tabId: updatedState.activeTabId,
              });

              if (isOk(indexResult)) {
                // Select the active tab
                await client.callTool({
                  name: tabsTool,
                  arguments: { action: "select", index: indexResult.value },
                });
                logger.info(
                  {
                    agentId,
                    conversationId,
                    tabIndex: indexResult.value,
                    action: "synced_and_selected",
                  },
                  "[BrowserTabs] Synced indices and selected active tab",
                );
                return { success: true, tabIndex: indexResult.value };
              }
            }
          }
        }

        // Tab count mismatch or sync failed - clear state and start fresh
        logger.warn(
          { agentId, conversationId },
          "State/browser mismatch, clearing state and creating new tab",
        );
        await browserStateManager.clear({
          agentId,
          userId: userContext.userId,
          conversationId,
        });
      }

      // No existing state or state cleared - create new tab
      const listResult = await client.callTool({
        name: tabsTool,
        arguments: { action: "list" },
      });

      if (listResult.isError) {
        const errorText = this.extractTextContent(listResult.content);
        return { success: false, error: errorText || "Failed to list tabs" };
      }

      const existingTabs = this.parseTabsList(listResult.content);
      const expectedNewTabIndex = this.getMaxTabIndex(existingTabs) + 1;

      const createResult = await client.callTool({
        name: tabsTool,
        arguments: { action: "new" },
      });

      if (createResult.isError) {
        const errorText = this.extractTextContent(createResult.content);
        return { success: false, error: errorText || "Failed to create tab" };
      }

      const postCreateList = await client.callTool({
        name: tabsTool,
        arguments: { action: "list" },
      });

      const postCreateTabs = postCreateList.isError
        ? []
        : this.parseTabsList(postCreateList.content);
      const existingIndexSet = new Set(existingTabs.map((tab) => tab.index));

      let resolvedTabIndex: number | null = null;
      if (!postCreateList.isError) {
        const newIndices = postCreateTabs
          .map((tab) => tab.index)
          .filter(
            (index) => Number.isInteger(index) && !existingIndexSet.has(index),
          );
        const uniqueNewIndices = Array.from(new Set(newIndices));

        if (uniqueNewIndices.length === 1) {
          resolvedTabIndex = uniqueNewIndices[0];
        } else if (uniqueNewIndices.length > 1) {
          resolvedTabIndex = uniqueNewIndices.includes(expectedNewTabIndex)
            ? expectedNewTabIndex
            : Math.max(...uniqueNewIndices);
        }
      }

      if (resolvedTabIndex === null) {
        resolvedTabIndex =
          postCreateTabs.length > 0
            ? this.getMaxTabIndex(postCreateTabs)
            : expectedNewTabIndex;
      }

      const selectNewResult = await client.callTool({
        name: tabsTool,
        arguments: { action: "select", index: resolvedTabIndex },
      });

      if (selectNewResult.isError) {
        const errorText = this.extractTextContent(selectNewResult.content);
        return { success: false, error: errorText || "Failed to select tab" };
      }

      // Create initial state with the new tab
      const tabId = generateTabId();
      const initialState = createInitialState(tabId, "about:blank");
      // Update the tab with the resolved index
      const stateWithIndex: BrowserState = {
        ...initialState,
        tabs: initialState.tabs.map((t) =>
          t.id === tabId
            ? { ...t, index: Some(resolvedTabIndex as number) }
            : t,
        ),
      };

      await browserStateManager.set({
        agentId,
        userId: userContext.userId,
        conversationId,
        state: stateWithIndex,
      });

      logger.info(
        {
          agentId,
          conversationId,
          tabIndex: resolvedTabIndex,
          tabId,
          action: "created_new_tab",
        },
        "[BrowserTabs] Created new tab for conversation",
      );
      return { success: true, tabIndex: resolvedTabIndex };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { error, agentId, conversationId },
        "Tab select/create failed",
      );
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Convert parsed tabs list to BrowserTabsListEntry format
   */
  private toBrowserTabsListEntries(
    tabs: Array<{ index: number; title?: string; url?: string }>,
  ): BrowserTabsListEntry[] {
    // Determine which tab is current (first one with isCurrent flag, or index 0)
    const currentIndex = tabs.find((t) => t.index === 0)?.index ?? 0;
    return tabs.map((t) => ({
      index: t.index,
      isCurrent: t.index === currentIndex,
    }));
  }

  /**
   * Find the Playwright browser click tool for an agent
   */
  private async findClickTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_click"),
    );
  }

  /**
   * Find the Playwright browser type tool for an agent
   */
  private async findTypeTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_type"),
    );
  }

  /**
   * Find the Playwright browser press key tool for an agent
   */
  private async findPressKeyTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_press_key"),
    );
  }

  /**
   * Find the Playwright browser navigate back tool for an agent
   */
  private async findNavigateBackTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_navigate_back"),
    );
  }

  /**
   * Find the Playwright browser snapshot tool for an agent
   */
  private async findSnapshotTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_snapshot"),
    );
  }

  /**
   * Navigate browser to a URL in a conversation's tab.
   * Updates history in persisted state.
   */
  async navigate(
    agentId: string,
    conversationId: string,
    url: string,
    userContext: BrowserUserContext,
  ): Promise<NavigateResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const toolName = await this.findNavigateTool(agentId);
    if (!toolName) {
      throw new ApiError(
        400,
        "No browser navigate tool available for this agent",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    logger.info({ agentId, toolName, url }, "Navigating browser via MCP");

    const result = await client.callTool({
      name: toolName,
      arguments: { url },
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Navigation failed");
    }

    // Update history in state
    const loadResult = await browserStateManager.getOrLoad({
      agentId,
      userId: userContext.userId,
      conversationId,
    });

    if (isOk(loadResult) && loadResult.value) {
      const state = loadResult.value;
      const navigateResult = applyNavigate({
        state,
        tabId: state.activeTabId,
        url,
      });

      if (isOk(navigateResult)) {
        await browserStateManager.set({
          agentId,
          userId: userContext.userId,
          conversationId,
          state: navigateResult.value,
        });
        const activeTab = navigateResult.value.tabs.find(
          (t) => t.id === state.activeTabId,
        );
        logger.info(
          {
            agentId,
            conversationId,
            url,
            tabId: state.activeTabId,
            history: activeTab?.history,
            historyLength: activeTab?.history.length,
            historyCursor: activeTab?.historyCursor,
          },
          "[BrowserTabs] Updated navigation history",
        );
      }
    }

    return {
      success: true,
      url,
    };
  }

  /**
   * Navigate browser back to the previous page
   */
  async navigateBack(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
  ): Promise<NavigateResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const toolName = await this.findNavigateBackTool(agentId);
    if (!toolName) {
      throw new ApiError(
        400,
        "No browser navigate back tool available for this agent",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    logger.info({ agentId, toolName }, "Navigating browser back via MCP");

    const result = await client.callTool({
      name: toolName,
      arguments: {},
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Navigate back failed");
    }

    return {
      success: true,
    };
  }

  /**
   * Activate a conversation's browser tab (create if doesn't exist, select if exists)
   * Called when user switches to a chat with browser panel open
   */
  async activateTab(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
  ): Promise<TabResult> {
    const tabsTool = await this.findTabsTool(agentId);
    if (!tabsTool) {
      throw new ApiError(400, "No browser tabs tool available for this agent");
    }

    const result = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!result.success) {
      throw new ApiError(500, result.error ?? "Failed to activate tab");
    }

    return result;
  }

  /**
   * List all browser tabs
   */
  async listTabs(
    agentId: string,
    userContext: BrowserUserContext,
  ): Promise<TabResult> {
    const tabsTool = await this.findTabsTool(agentId);
    if (!tabsTool) {
      throw new ApiError(400, "No browser tabs tool available");
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );

    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    const result = await client.callTool({
      name: tabsTool,
      arguments: { action: "list" },
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Failed to list tabs");
    }

    return {
      success: true,
      tabs: this.parseTabsList(result.content),
    };
  }

  /**
   * Close a conversation's browser tab.
   * Uses persisted browser state to track tab indices.
   */
  async closeTab(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
  ): Promise<TabResult> {
    const tabsTool = await this.findTabsTool(agentId);
    if (!tabsTool) {
      await browserStateManager.clear({
        agentId,
        userId: userContext.userId,
        conversationId,
      });
      return { success: true };
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      await browserStateManager.clear({
        agentId,
        userId: userContext.userId,
        conversationId,
      });
      return { success: true };
    }

    // Load state to get tab index
    const loadResult = await browserStateManager.getOrLoad({
      agentId,
      userId: userContext.userId,
      conversationId,
    });

    let tabIndex: number | undefined;
    if (isOk(loadResult) && loadResult.value) {
      const state = loadResult.value;
      const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
      if (activeTab && isSome(activeTab.index)) {
        tabIndex = activeTab.index.value;
      }
    }

    // If we don't have the tab index, try to find it from browser
    if (tabIndex === undefined) {
      logger.info(
        { agentId, conversationId },
        "Tab index not in state, checking browser tabs",
      );

      try {
        const listResult = await client.callTool({
          name: tabsTool,
          arguments: { action: "list" },
        });

        if (!listResult.isError) {
          const tabs = this.parseTabsList(listResult.content);
          if (tabs.length <= 1) {
            await browserStateManager.clear({
              agentId,
              userId: userContext.userId,
              conversationId,
            });
            return { success: true };
          }

          // Close the highest-indexed tab as best-effort
          const maxTab = tabs.reduce((max, tab) =>
            tab.index > max.index ? tab : max,
          );
          if (maxTab.index > 0) {
            tabIndex = maxTab.index;
            logger.info(
              { agentId, conversationId, tabIndex },
              "Closing most recent tab as best-effort cleanup",
            );
          }
        }
      } catch (error) {
        logger.warn(
          { error, agentId, conversationId },
          "Failed to list tabs for cleanup",
        );
        await browserStateManager.clear({
          agentId,
          userId: userContext.userId,
          conversationId,
        });
        return { success: true };
      }
    }

    if (tabIndex === undefined || tabIndex === 0) {
      logger.info(
        { agentId, conversationId, tabIndex },
        "[BrowserTabs] No tab to close (undefined or tab 0)",
      );
      await browserStateManager.clear({
        agentId,
        userId: userContext.userId,
        conversationId,
      });
      return { success: true };
    }

    logger.info(
      {
        agentId,
        conversationId,
        closingTabIndex: tabIndex,
      },
      "[BrowserTabs] Closing tab",
    );

    try {
      await client.callTool({
        name: tabsTool,
        arguments: { action: "close", index: tabIndex },
      });

      // Clear the state for this conversation
      await browserStateManager.clear({
        agentId,
        userId: userContext.userId,
        conversationId,
      });

      logger.info(
        {
          agentId,
          conversationId,
          closedTabIndex: tabIndex,
        },
        "[BrowserTabs] Closed tab and cleared state",
      );

      return { success: true };
    } catch (error) {
      logger.error({ error, agentId, conversationId }, "Failed to close tab");
      await browserStateManager.clear({
        agentId,
        userId: userContext.userId,
        conversationId,
      });
      return { success: true };
    }
  }

  /**
   * Sync browser state from AI-initiated browser_tabs tool calls.
   * Updates state manager based on the tool action and result.
   */
  async syncTabMappingFromTabsToolCall(params: {
    agentId: string;
    conversationId: string;
    userContext: BrowserUserContext;
    toolArguments?: Record<string, unknown>;
    toolResultContent: unknown;
  }): Promise<void> {
    const {
      agentId,
      conversationId,
      userContext,
      toolArguments,
      toolResultContent,
    } = params;

    const actionValue = toolArguments?.action;
    if (typeof actionValue !== "string") {
      return;
    }

    const action = actionValue.trim().toLowerCase();

    // Load existing state
    const loadResult = await browserStateManager.getOrLoad({
      agentId,
      userId: userContext.userId,
      conversationId,
    });

    const existingState = isOk(loadResult) ? loadResult.value : null;

    if (action === "list") {
      // On list, sync indices with current browser state
      if (!existingState) return;

      const browserTabs = this.parseTabsList(toolResultContent);
      const listEntries = this.toBrowserTabsListEntries(browserTabs);

      if (listEntries.length === existingState.tabs.length) {
        const syncResult = applyTabsList({
          state: existingState,
          list: listEntries,
        });

        if (isOk(syncResult)) {
          await browserStateManager.set({
            agentId,
            userId: userContext.userId,
            conversationId,
            state: syncResult.value,
          });
          logger.info(
            { agentId, conversationId, action },
            "[BrowserTabs] Synced indices from AI list action",
          );
        }
      }
      return;
    }

    if (action === "new") {
      // On new tab, create a new tab in state
      const currentIndex =
        this.extractCurrentTabIndexFromTabsContent(toolResultContent);
      if (currentIndex === undefined) return;

      const tabId = generateTabId();

      if (existingState) {
        const createResult = applyTabsCreate({
          state: existingState,
          tabId,
          index: currentIndex,
          initialUrl: "about:blank",
        });

        if (isOk(createResult)) {
          await browserStateManager.set({
            agentId,
            userId: userContext.userId,
            conversationId,
            state: createResult.value,
          });
          logger.info(
            { agentId, conversationId, action, tabId, index: currentIndex },
            "[BrowserTabs] Created new tab in state from AI action",
          );
        }
      } else {
        // No existing state - create initial state
        const initialState = createInitialState(tabId, "about:blank");
        const stateWithIndex: BrowserState = {
          ...initialState,
          tabs: initialState.tabs.map((t) =>
            t.id === tabId ? { ...t, index: Some(currentIndex) } : t,
          ),
        };

        await browserStateManager.set({
          agentId,
          userId: userContext.userId,
          conversationId,
          state: stateWithIndex,
        });
        logger.info(
          { agentId, conversationId, action, tabId, index: currentIndex },
          "[BrowserTabs] Created initial state from AI new action",
        );
      }
      return;
    }

    if (action === "select") {
      // On select, update active tab ID based on index
      if (!existingState) return;

      const selectedIndex = this.parseTabIndexValue(toolArguments?.index);
      if (selectedIndex === null) return;

      // Find tab with this index and set as active
      const selectedTab = existingState.tabs.find(
        (t) => isSome(t.index) && t.index.value === selectedIndex,
      );

      if (selectedTab) {
        const updatedState: BrowserState = {
          ...existingState,
          activeTabId: selectedTab.id,
        };

        await browserStateManager.set({
          agentId,
          userId: userContext.userId,
          conversationId,
          state: updatedState,
        });
        logger.info(
          {
            agentId,
            conversationId,
            action,
            selectedIndex,
            activeTabId: selectedTab.id,
          },
          "[BrowserTabs] Updated active tab from AI select action",
        );
      }
      return;
    }

    if (action === "close") {
      // On close, remove tab from state
      if (!existingState) return;

      const closedIndex = this.parseTabIndexValue(toolArguments?.index);
      if (closedIndex === null) return;

      const closeResult = applyTabsClose({
        state: existingState,
        index: closedIndex,
      });

      if (isOk(closeResult)) {
        await browserStateManager.set({
          agentId,
          userId: userContext.userId,
          conversationId,
          state: closeResult.value,
        });
        logger.info(
          { agentId, conversationId, action, closedIndex },
          "[BrowserTabs] Removed tab from state after AI close action",
        );
      } else if (closeResult.error.kind === "CannotCloseLastTab") {
        // Clear state if trying to close last tab
        await browserStateManager.clear({
          agentId,
          userId: userContext.userId,
          conversationId,
        });
        logger.info(
          { agentId, conversationId, action },
          "[BrowserTabs] Cleared state after closing last tab",
        );
      }
    }
  }

  /**
   * Parse tabs list from tool response
   */
  private parseTabsList(
    content: unknown,
  ): Array<{ index: number; title?: string; url?: string }> {
    const textContent = this.extractTextContent(content);
    // This is a simplified parser - actual format depends on Playwright MCP
    const tabs: Array<{ index: number; title?: string; url?: string }> = [];

    const parseIndex = (value: unknown, fallback: number): number => {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          return parsed;
        }
      }
      return fallback;
    };

    // Try to parse JSON if content is JSON
    try {
      const parsed: unknown = JSON.parse(textContent);
      if (Array.isArray(parsed)) {
        return parsed.map((item, fallbackIndex) => {
          if (typeof item === "object" && item !== null) {
            const candidate = item as Record<string, unknown>;
            const rawTitle = candidate.title;
            const rawUrl = candidate.url;
            const rawIndex = candidate.index ?? candidate.id;
            const title = typeof rawTitle === "string" ? rawTitle : undefined;
            const url = typeof rawUrl === "string" ? rawUrl : undefined;
            return {
              index: parseIndex(rawIndex, fallbackIndex),
              title,
              url,
            };
          }
          if (typeof item === "string") {
            return { index: fallbackIndex, title: item };
          }
          return { index: fallbackIndex };
        });
      }
    } catch {
      // Not JSON, try line-by-line parsing
      const lines = textContent.split("\n");
      for (const line of lines) {
        const match = line.match(/(\d+)[:\s]+(.+)/);
        if (match) {
          tabs.push({
            index: Number.parseInt(match[1], 10),
            title: match[2].trim(),
          });
        }
      }
    }

    return tabs;
  }

  private getMaxTabIndex(
    tabs: Array<{ index: number; title?: string; url?: string }>,
  ): number {
    let maxIndex = -1;
    for (const tab of tabs) {
      if (Number.isInteger(tab.index) && tab.index > maxIndex) {
        maxIndex = tab.index;
      }
    }
    return maxIndex;
  }

  /**
   * Take a screenshot of a conversation's browser tab
   * Note: Tab should already be selected via selectOrCreateTab when subscribing
   */
  async takeScreenshot(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
  ): Promise<ScreenshotResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const toolName = await this.findScreenshotTool(agentId);
    if (!toolName) {
      throw new ApiError(
        400,
        "No browser screenshot tool available for this agent",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );

    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    logger.info(
      { agentId, conversationId, toolName },
      "Taking browser screenshot via MCP",
    );

    const result = await client.callTool({
      name: toolName,
      arguments: {
        type: "jpeg",
      },
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Screenshot failed");
    }

    // Extract screenshot from MCP response
    // Playwright MCP returns screenshots as base64 images in content array
    const screenshot = this.extractScreenshot(result.content);

    if (!screenshot) {
      return { error: "No screenshot returned from browser tool" };
    }

    // Log screenshot size for debugging token usage issues
    const base64Match = screenshot.match(/^data:([^;]+);base64,(.+)$/);
    if (base64Match) {
      const mimeType = base64Match[1];
      const base64Data = base64Match[2];
      const estimatedSizeKB = Math.round((base64Data.length * 3) / 4 / 1024);

      logger.info(
        {
          agentId,
          conversationId,
          mimeType,
          base64Length: base64Data.length,
          estimatedSizeKB,
        },
        "[BrowserStream] Screenshot captured",
      );
    }

    // Get URL reliably using browser_evaluate instead of extracting from screenshot response
    // This ensures the URL matches the page content shown in the screenshot
    const url = await this.getCurrentUrl(agentId, userContext);

    return {
      screenshot,
      url,
    };
  }

  /**
   * Extract text content from MCP response
   */
  private extractTextContent(content: unknown): string {
    if (!Array.isArray(content)) return "";

    return content
      .filter(
        (item): item is { type: string; text: string } =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item,
      )
      .map((item) => item.text)
      .join("\n");
  }

  /**
   * Extract screenshot (base64 image) from MCP response
   */
  private extractScreenshot(content: unknown): string | undefined {
    if (!Array.isArray(content)) return undefined;

    // Look for image content
    for (const item of content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "image" &&
        "data" in item
      ) {
        // Return as data URL
        const mimeType =
          "mimeType" in item ? (item.mimeType as string) : "image/png";
        return `data:${mimeType};base64,${item.data}`;
      }
    }

    // Some tools might return base64 in text content
    const textContent = this.extractTextContent(content);
    if (textContent.startsWith("data:image")) {
      return textContent;
    }

    return undefined;
  }

  /**
   * Get current page URL using browser_tabs
   * Parses the current tab's URL from the tabs list
   */
  private parseTabIndexValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return null;
  }

  private isCurrentTabFlag(
    flag: unknown,
    candidateIndex: number | null,
  ): boolean {
    if (flag === true) return true;
    if (typeof flag === "string") {
      const normalized = flag.trim().toLowerCase();
      if (normalized === "true") return true;
      const numericFlag = this.parseTabIndexValue(flag);
      if (numericFlag === 1) return true;
      if (numericFlag === 0) return false;
      if (numericFlag !== null && candidateIndex !== null) {
        return numericFlag === candidateIndex;
      }
    }
    if (typeof flag === "number") {
      if (flag === 1) return true;
      if (flag === 0) return false;
      if (candidateIndex !== null) {
        return flag === candidateIndex;
      }
    }
    return false;
  }

  private extractCurrentTabIndexFromTabsJson(
    textContent: string,
  ): number | undefined {
    if (textContent.trim() === "") return undefined;

    const findCurrentIndex = (
      tabs: unknown[],
      currentIndex: number | null,
    ): number | undefined => {
      if (currentIndex !== null) {
        return currentIndex;
      }

      for (const item of tabs) {
        if (typeof item !== "object" || item === null) continue;
        const candidate = item as Record<string, unknown>;
        const candidateIndex = this.parseTabIndexValue(
          candidate.index ?? candidate.id ?? candidate.tabIndex,
        );
        const currentFlag =
          candidate.current ??
          candidate.isCurrent ??
          candidate.is_current ??
          candidate.active ??
          candidate.selected;

        if (this.isCurrentTabFlag(currentFlag, candidateIndex)) {
          if (candidateIndex !== null) {
            return candidateIndex;
          }
        }
      }

      return undefined;
    };

    try {
      const parsed: unknown = JSON.parse(textContent);
      if (Array.isArray(parsed)) {
        return findCurrentIndex(parsed, null);
      }

      if (typeof parsed === "object" && parsed !== null) {
        const candidate = parsed as Record<string, unknown>;
        const currentIndex = this.parseTabIndexValue(
          candidate.currentIndex ??
            candidate.current_index ??
            candidate.selectedIndex ??
            candidate.selected_index,
        );
        const tabs = candidate.tabs;

        if (Array.isArray(tabs)) {
          return findCurrentIndex(tabs, currentIndex);
        }

        if (currentIndex !== null) {
          return currentIndex;
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private extractCurrentTabIndexFromTabsContent(
    content: unknown,
  ): number | undefined {
    const textContent = this.extractTextContent(content);

    const indexFromJson = this.extractCurrentTabIndexFromTabsJson(textContent);
    if (indexFromJson !== undefined) {
      return indexFromJson;
    }

    const lines = textContent.split("\n");
    for (const line of lines) {
      if (!line.includes("(current)")) continue;
      const match = line.match(/(?:^|\\s|-)\\s*(\\d+)\\s*:/);
      if (!match) continue;
      const parsed = Number.parseInt(match[1], 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    return undefined;
  }

  private extractCurrentUrlFromTabsJson(
    textContent: string,
  ): string | undefined {
    if (textContent.trim() === "") return undefined;

    const findCurrentUrlInTabs = (
      tabs: unknown[],
      currentIndex: number | null,
    ): string | undefined => {
      if (currentIndex !== null) {
        for (const item of tabs) {
          if (typeof item !== "object" || item === null) continue;
          const candidate = item as Record<string, unknown>;
          const candidateIndex = this.parseTabIndexValue(
            candidate.index ?? candidate.id ?? candidate.tabIndex,
          );
          if (candidateIndex !== null && candidateIndex === currentIndex) {
            if (typeof candidate.url === "string") {
              return candidate.url;
            }
          }
        }

        if (currentIndex >= 0 && currentIndex < tabs.length) {
          const fallback = tabs[currentIndex];
          if (typeof fallback === "object" && fallback !== null) {
            const candidate = fallback as Record<string, unknown>;
            if (typeof candidate.url === "string") {
              return candidate.url;
            }
          }
        }
      }

      for (const item of tabs) {
        if (typeof item !== "object" || item === null) continue;
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.url !== "string") continue;
        const candidateIndex = this.parseTabIndexValue(
          candidate.index ?? candidate.id ?? candidate.tabIndex,
        );
        const currentFlag =
          candidate.current ??
          candidate.isCurrent ??
          candidate.is_current ??
          candidate.active ??
          candidate.selected;
        if (this.isCurrentTabFlag(currentFlag, candidateIndex)) {
          return candidate.url;
        }
      }

      return undefined;
    };

    try {
      const parsed: unknown = JSON.parse(textContent);
      if (Array.isArray(parsed)) {
        return findCurrentUrlInTabs(parsed, null);
      }

      if (typeof parsed === "object" && parsed !== null) {
        const candidate = parsed as Record<string, unknown>;
        const currentIndex = this.parseTabIndexValue(
          candidate.currentIndex ??
            candidate.current_index ??
            candidate.selectedIndex ??
            candidate.selected_index,
        );
        const tabs = candidate.tabs;

        if (Array.isArray(tabs)) {
          return findCurrentUrlInTabs(tabs, currentIndex);
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  async getCurrentUrl(
    agentId: string,
    userContext: BrowserUserContext,
  ): Promise<string | undefined> {
    const tabsTool = await this.findTabsTool(agentId);
    if (!tabsTool) {
      return undefined;
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      return undefined;
    }

    try {
      const result = await client.callTool({
        name: tabsTool,
        arguments: { action: "list" },
      });

      if (result.isError) {
        return undefined;
      }

      const textContent = this.extractTextContent(result.content);
      const currentUrlFromJson =
        this.extractCurrentUrlFromTabsJson(textContent);
      if (currentUrlFromJson) {
        return currentUrlFromJson;
      }
      // Parse the current tab's URL from format like:
      // "- 1: (current) [Title] (https://example.com)"
      const currentTabMatch = textContent.match(
        /\(current\)[^()]*\(((?:https?|about):\/\/[^)]+)\)/,
      );
      return currentTabMatch?.[1];
    } catch {
      return undefined;
    }
  }

  /**
   * Find the Playwright browser run_code tool for an agent
   * This tool allows running arbitrary Playwright code including mouse operations
   */
  private async findRunCodeTool(agentId: string): Promise<string | null> {
    return this.findToolName(agentId, (toolName) =>
      toolName.includes("browser_run_code"),
    );
  }

  /**
   * Click on an element using element ref from snapshot OR coordinates
   * For coordinates, uses browser_run_code to perform Playwright mouse.click()
   * @param agentId - Agent ID
   * @param conversationId - Conversation ID
   * @param userContext - User context for MCP authentication
   * @param element - Element reference (e.g., "e123") or selector
   * @param x - X coordinate for click (optional)
   * @param y - Y coordinate for click (optional)
   */
  async click(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
    element?: string,
    x?: number,
    y?: number,
  ): Promise<ClickResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    if (x !== undefined && y !== undefined) {
      // Use browser_run_code for native Playwright mouse click
      const runCodeTool = await this.findRunCodeTool(agentId);
      if (runCodeTool) {
        logger.info(
          { agentId, conversationId, x, y },
          "Clicking at coordinates via browser_run_code (Playwright mouse.click)",
        );

        // Native Playwright mouse click - async function with page argument
        const code = `async (page) => { await page.mouse.click(${Math.round(
          x,
        )}, ${Math.round(y)}); }`;

        try {
          const result = await client.callTool({
            name: runCodeTool,
            arguments: { code },
          });

          if (!result.isError) {
            return { success: true };
          }

          const errorText = this.extractTextContent(result.content);
          logger.warn(
            { agentId, error: errorText },
            "browser_run_code click failed",
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          let errorDetails = "";
          if (error && typeof error === "object") {
            try {
              errorDetails = JSON.stringify(error);
            } catch {
              errorDetails = String(error);
            }
          }
          logger.warn(
            { agentId, error, errorMessage, errorDetails },
            "browser_run_code threw exception",
          );
        }
      }

      // No tool available or failed
      throw new ApiError(400, "browser_run_code failed for coordinate clicks");
    } else if (element) {
      // Element ref-based click using browser_click
      const toolName = await this.findClickTool(agentId);
      if (!toolName) {
        throw new ApiError(
          400,
          "No browser click tool available for this agent",
        );
      }

      logger.info(
        { agentId, conversationId, element },
        "Clicking element via MCP",
      );

      const result = await client.callTool({
        name: toolName,
        arguments: { element, ref: element },
      });

      if (result.isError) {
        const errorText = this.extractTextContent(result.content);
        throw new ApiError(500, errorText || "Click failed");
      }

      return { success: true };
    } else {
      throw new ApiError(400, "Either element ref or coordinates required");
    }
  }

  /**
   * Type text into the currently focused element or specified element
   * @param agentId - Agent ID
   * @param conversationId - Conversation ID
   * @param userContext - User context for MCP authentication
   * @param text - Text to type
   * @param element - Optional element reference to focus first
   */
  async type(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
    text: string,
    element?: string,
  ): Promise<TypeResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    // If no element specified, use page.keyboard.type() to type into focused element
    if (!element) {
      const runCodeTool = await this.findRunCodeTool(agentId);
      if (runCodeTool) {
        logger.info(
          { agentId, conversationId, textLength: text.length },
          "Typing text into focused element via browser_run_code",
        );

        // Escape text for JavaScript string
        const escapedText = text
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$/g, "\\$");
        // Native Playwright keyboard type - async function with page argument
        const playwrightCode = `async (page) => { await page.keyboard.type(\`${escapedText}\`); }`;

        const result = await client.callTool({
          name: runCodeTool,
          arguments: { code: playwrightCode },
        });

        if (!result.isError) {
          return { success: true };
        }

        const errorText = this.extractTextContent(result.content);
        logger.warn(
          { agentId, error: errorText },
          "browser_run_code type failed, trying browser_type",
        );
      }
    }

    // Fall back to browser_type tool (requires element ref)
    const toolName = await this.findTypeTool(agentId);
    if (!toolName) {
      throw new ApiError(400, "No browser type tool available for this agent");
    }

    logger.info(
      { agentId, conversationId, textLength: text.length, element },
      "Typing text via browser_type MCP tool",
    );

    const args: Record<string, string> = { text };
    if (element) {
      args.element = element;
      args.ref = element;
    }

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Type failed");
    }

    return { success: true };
  }

  /**
   * Press a key (for scrolling, enter, tab, etc.)
   * @param agentId - Agent ID
   * @param conversationId - Conversation ID
   * @param userContext - User context for MCP authentication
   * @param key - Key to press (e.g., "Enter", "Tab", "ArrowDown", "PageDown")
   */
  async pressKey(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
    key: string,
  ): Promise<ScrollResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const toolName = await this.findPressKeyTool(agentId);
    if (!toolName) {
      throw new ApiError(
        400,
        "No browser press key tool available for this agent",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    logger.info({ agentId, conversationId, key }, "Pressing key via MCP");

    const result = await client.callTool({
      name: toolName,
      arguments: { key },
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Key press failed");
    }

    return { success: true };
  }

  /**
   * Get accessibility snapshot of the page (shows clickable elements with refs)
   * @param agentId - Agent ID
   * @param conversationId - Conversation ID
   * @param userContext - User context for MCP authentication
   */
  async getSnapshot(
    agentId: string,
    conversationId: string,
    userContext: BrowserUserContext,
  ): Promise<SnapshotResult> {
    const tabResult = await this.selectOrCreateTab(
      agentId,
      conversationId,
      userContext,
    );
    if (!tabResult.success) {
      throw new ApiError(
        500,
        tabResult.error ?? "Failed to select browser tab",
      );
    }

    const toolName = await this.findSnapshotTool(agentId);
    if (!toolName) {
      throw new ApiError(
        400,
        "No browser snapshot tool available for this agent",
      );
    }

    const client = await getChatMcpClient(
      agentId,
      userContext.userId,
      userContext.userIsProfileAdmin,
    );
    if (!client) {
      throw new ApiError(500, "Failed to connect to MCP Gateway");
    }

    logger.info(
      { agentId, conversationId },
      "Getting browser snapshot via MCP",
    );

    const result = await client.callTool({
      name: toolName,
      arguments: {},
    });

    if (result.isError) {
      const errorText = this.extractTextContent(result.content);
      throw new ApiError(500, errorText || "Snapshot failed");
    }

    const snapshot = this.extractTextContent(result.content);
    return { snapshot };
  }
}
