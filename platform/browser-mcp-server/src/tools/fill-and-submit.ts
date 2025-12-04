import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";

export const fillAndSubmitSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  fields: z
    .array(
      z.object({
        selector: z.string().describe("CSS selector for the input field"),
        value: z.string().describe("Value to fill in the field"),
      }),
    )
    .min(1)
    .describe("Array of field selectors and values to fill"),
  submitSelector: z
    .string()
    .optional()
    .describe(
      "CSS selector for submit button (if not provided, submits the form)",
    ),
  waitForNavigation: z
    .boolean()
    .optional()
    .default(true)
    .describe("Wait for navigation after submit"),
});

export type FillAndSubmitArgs = z.infer<typeof fillAndSubmitSchema>;

export async function fillAndSubmit(
  browserManager: BrowserManager,
  args: FillAndSubmitArgs,
) {
  try {
    const page = await browserManager.getPage(args.sessionId);

    // Fill all fields
    for (const field of args.fields) {
      await page.fill(field.selector, field.value, { timeout: 10000 });
    }

    // Submit
    if (args.submitSelector) {
      if (args.waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000 }).catch(() => {}),
          page.click(args.submitSelector, { timeout: 10000 }),
        ]);
      } else {
        await page.click(args.submitSelector, { timeout: 10000 });
      }
    } else {
      // Try to find and submit the form containing the first field
      const firstFieldSelector = args.fields[0].selector;
      if (args.waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000 }).catch(() => {}),
          page.evaluate((selector) => {
            const input = document.querySelector(selector);
            const form = input?.closest("form");
            if (form) {
              form.submit();
            } else if (
              input instanceof HTMLElement &&
              input.tagName === "INPUT"
            ) {
              // If no form, try pressing Enter
              input.dispatchEvent(
                new KeyboardEvent("keypress", { key: "Enter" }),
              );
            }
          }, firstFieldSelector),
        ]);
      } else {
        await page.evaluate((selector) => {
          const input = document.querySelector(selector);
          const form = input?.closest("form");
          if (form) {
            form.submit();
          }
        }, firstFieldSelector);
      }
    }

    // Short wait for any potential redirects
    await page.waitForTimeout(500);

    const title = await page.title();
    const currentUrl = page.url();

    return {
      content: [
        {
          type: "text" as const,
          text: `Form submitted. Filled ${args.fields.length} field(s).\nCurrent URL: ${currentUrl}\nPage title: ${title}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Fill and submit failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
