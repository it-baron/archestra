import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";

export const typeSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  selector: z.string().describe("CSS selector for input element"),
  text: z.string().describe("Text to type into the element"),
  delay: z
    .number()
    .int()
    .min(0)
    .max(500)
    .optional()
    .default(0)
    .describe("Delay between key presses in milliseconds"),
  clearFirst: z
    .boolean()
    .optional()
    .default(false)
    .describe("Clear existing text before typing"),
});

export type TypeArgs = z.infer<typeof typeSchema>;

export async function type(browserManager: BrowserManager, args: TypeArgs) {
  try {
    const page = await browserManager.getPage(args.sessionId);

    if (args.clearFirst) {
      await page.fill(args.selector, "");
    }

    await page.type(args.selector, args.text, {
      delay: args.delay,
      timeout: 10000,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Typed "${args.text.length > 50 ? `${args.text.substring(0, 50)}...` : args.text}" into ${args.selector}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Type failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
