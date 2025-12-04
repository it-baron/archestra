import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";
import { click } from "./click.js";
import { fillAndSubmit } from "./fill-and-submit.js";
import { getContent } from "./get-content.js";
import { navigate } from "./navigate.js";
import { screenshot } from "./screenshot.js";
import { scroll } from "./scroll.js";
import { type as typeFunc } from "./type.js";

/**
 * Register all browser tools with the MCP server
 */
export function registerTools(
  server: McpServer,
  browserManager: BrowserManager,
): void {
  // browser_navigate
  server.tool(
    "browser_navigate",
    "Navigate to a URL in the browser",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      url: z.string().describe("URL to navigate to"),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle"])
        .optional()
        .describe("Wait until this event before returning"),
    },
    async ({ sessionId, url, waitUntil }) => {
      const result = await navigate(browserManager, {
        sessionId,
        url,
        waitUntil: waitUntil || "domcontentloaded",
      });
      return result;
    },
  );

  // browser_screenshot
  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current page",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      fullPage: z.boolean().optional().describe("Capture full scrollable page"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to capture specific element"),
    },
    async ({ sessionId, fullPage, selector }) => {
      const result = await screenshot(browserManager, {
        sessionId,
        fullPage: fullPage ?? false,
        selector,
      });
      return result;
    },
  );

  // browser_click
  server.tool(
    "browser_click",
    "Click an element on the page",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      selector: z.string().describe("CSS selector for element to click"),
      button: z
        .enum(["left", "right", "middle"])
        .optional()
        .describe("Mouse button to click"),
      clickCount: z
        .number()
        .optional()
        .describe("Number of clicks (1 for single, 2 for double)"),
    },
    async ({ sessionId, selector, button, clickCount }) => {
      const result = await click(browserManager, {
        sessionId,
        selector,
        button: button || "left",
        clickCount: clickCount ?? 1,
      });
      return result;
    },
  );

  // browser_type
  server.tool(
    "browser_type",
    "Type text into an input element",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      selector: z.string().describe("CSS selector for input element"),
      text: z.string().describe("Text to type into the element"),
      delay: z
        .number()
        .optional()
        .describe("Delay between key presses in milliseconds"),
      clearFirst: z
        .boolean()
        .optional()
        .describe("Clear existing text before typing"),
    },
    async ({ sessionId, selector, text, delay, clearFirst }) => {
      const result = await typeFunc(browserManager, {
        sessionId,
        selector,
        text,
        delay: delay ?? 0,
        clearFirst: clearFirst ?? false,
      });
      return result;
    },
  );

  // browser_get_content
  server.tool(
    "browser_get_content",
    "Get page content (text, HTML, or markdown)",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to get content from (defaults to body)"),
      format: z
        .enum(["text", "html", "markdown"])
        .optional()
        .describe("Output format: text, html, or markdown"),
    },
    async ({ sessionId, selector, format }) => {
      const result = await getContent(browserManager, {
        sessionId,
        selector,
        format: format || "text",
      });
      return result;
    },
  );

  // browser_scroll
  server.tool(
    "browser_scroll",
    "Scroll the page up or down",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      direction: z.enum(["up", "down"]).describe("Scroll direction"),
      amount: z
        .number()
        .optional()
        .describe("Amount to scroll in pixels (default 500)"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to scroll within (defaults to page)"),
    },
    async ({ sessionId, direction, amount, selector }) => {
      const result = await scroll(browserManager, {
        sessionId,
        direction,
        amount: amount ?? 500,
        selector,
      });
      return result;
    },
  );

  // browser_fill_and_submit
  server.tool(
    "browser_fill_and_submit",
    "Fill form fields and submit",
    {
      sessionId: z.string().describe("Session ID (injected by dispatcher)"),
      fields: z
        .array(
          z.object({
            selector: z.string().describe("CSS selector for the input field"),
            value: z.string().describe("Value to fill in the field"),
          }),
        )
        .describe("Array of field selectors and values to fill"),
      submitSelector: z
        .string()
        .optional()
        .describe("CSS selector for submit button"),
      waitForNavigation: z
        .boolean()
        .optional()
        .describe("Wait for navigation after submit"),
    },
    async ({ sessionId, fields, submitSelector, waitForNavigation }) => {
      const result = await fillAndSubmit(browserManager, {
        sessionId,
        fields,
        submitSelector,
        waitForNavigation: waitForNavigation ?? true,
      });
      return result;
    },
  );
}

export {
  navigate,
  screenshot,
  click,
  typeFunc as type,
  getContent,
  scroll,
  fillAndSubmit,
};
