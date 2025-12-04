import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";

export const scrollSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  direction: z.enum(["up", "down"]).describe("Scroll direction"),
  amount: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .default(500)
    .describe("Amount to scroll in pixels"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to scroll within (defaults to page)"),
});

export type ScrollArgs = z.infer<typeof scrollSchema>;

export async function scroll(browserManager: BrowserManager, args: ScrollArgs) {
  try {
    const page = await browserManager.getPage(args.sessionId);
    const amount = args.direction === "down" ? args.amount : -args.amount;

    if (args.selector) {
      // Scroll within a specific element
      await page.evaluate(
        ({ selector, amount }) => {
          const element = document.querySelector(selector);
          if (element) {
            element.scrollBy({ top: amount, behavior: "smooth" });
          }
        },
        { selector: args.selector, amount },
      );
    } else {
      // Scroll the page
      await page.evaluate((amount) => {
        window.scrollBy({ top: amount, behavior: "smooth" });
      }, amount);
    }

    // Wait for scroll to complete
    await page.waitForTimeout(300);

    const scrollInfo = await page.evaluate((selector) => {
      if (selector) {
        const element = document.querySelector(selector);
        if (element) {
          return {
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          };
        }
      }
      return {
        scrollTop: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight,
      };
    }, args.selector || null);

    return {
      content: [
        {
          type: "text" as const,
          text: `Scrolled ${args.direction} ${Math.abs(amount)}px. Position: ${scrollInfo.scrollTop}/${scrollInfo.scrollHeight - scrollInfo.clientHeight}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Scroll failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
