import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";

export const navigateSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  url: z.string().url().describe("URL to navigate to"),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .default("domcontentloaded")
    .describe("Wait until this event before returning"),
});

export type NavigateArgs = z.infer<typeof navigateSchema>;

export async function navigate(
  browserManager: BrowserManager,
  args: NavigateArgs,
) {
  try {
    const page = await browserManager.getPage(args.sessionId);
    await page.goto(args.url, {
      waitUntil: args.waitUntil,
      timeout: 30000,
    });

    const title = await page.title();
    const currentUrl = page.url();

    return {
      content: [
        {
          type: "text" as const,
          text: `Navigated to: ${currentUrl}\nPage title: ${title}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Navigation failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
