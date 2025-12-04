import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";

export const screenshotSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  fullPage: z
    .boolean()
    .optional()
    .default(false)
    .describe("Capture full scrollable page"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to capture specific element"),
});

export type ScreenshotArgs = z.infer<typeof screenshotSchema>;

export async function screenshot(
  browserManager: BrowserManager,
  args: ScreenshotArgs,
) {
  try {
    const page = await browserManager.getPage(args.sessionId);

    let buffer: Buffer;
    if (args.selector) {
      const element = await page.$(args.selector);
      if (!element) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Element not found: ${args.selector}`,
            },
          ],
          isError: true,
        };
      }
      buffer = await element.screenshot({ type: "png" });
    } else {
      buffer = await page.screenshot({
        type: "png",
        fullPage: args.fullPage,
      });
    }

    const base64 = buffer.toString("base64");

    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: "image/png",
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
