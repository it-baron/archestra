import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";

export const clickSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  selector: z.string().describe("CSS selector for element to click"),
  button: z
    .enum(["left", "right", "middle"])
    .optional()
    .default("left")
    .describe("Mouse button to click"),
  clickCount: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .default(1)
    .describe("Number of clicks (1 for single, 2 for double)"),
});

export type ClickArgs = z.infer<typeof clickSchema>;

export async function click(browserManager: BrowserManager, args: ClickArgs) {
  try {
    const page = await browserManager.getPage(args.sessionId);

    await page.click(args.selector, {
      button: args.button,
      clickCount: args.clickCount,
      timeout: 10000,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Clicked element: ${args.selector}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Click failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
