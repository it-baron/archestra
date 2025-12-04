import { z } from "zod";
import type { BrowserManager } from "../browser-manager.js";
import type { ContentFormat } from "../types.js";

export const getContentSchema = z.object({
  sessionId: z.string().describe("Session ID (injected by dispatcher)"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to get content from (defaults to body)"),
  format: z
    .enum(["text", "html", "markdown"])
    .optional()
    .default("text")
    .describe("Output format: text (plain text), html, or markdown"),
});

export type GetContentArgs = z.infer<typeof getContentSchema>;

export async function getContent(
  browserManager: BrowserManager,
  args: GetContentArgs,
) {
  try {
    const page = await browserManager.getPage(args.sessionId);
    const selector = args.selector || "body";
    const format: ContentFormat = args.format || "text";

    const element = await page.$(selector);
    if (!element) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Element not found: ${selector}`,
          },
        ],
        isError: true,
      };
    }

    let content: string;

    switch (format) {
      case "html":
        content = await element.innerHTML();
        break;
      case "markdown":
        // Simple markdown conversion - get text but preserve some structure
        content = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return "";

          const convertToMarkdown = (node: Node): string => {
            if (node.nodeType === Node.TEXT_NODE) {
              return node.textContent?.trim() || "";
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
              return "";
            }

            const element = node as HTMLElement;
            const tagName = element.tagName.toLowerCase();
            const children = Array.from(element.childNodes)
              .map(convertToMarkdown)
              .join("");

            switch (tagName) {
              case "h1":
                return `# ${children}\n\n`;
              case "h2":
                return `## ${children}\n\n`;
              case "h3":
                return `### ${children}\n\n`;
              case "h4":
                return `#### ${children}\n\n`;
              case "h5":
                return `##### ${children}\n\n`;
              case "h6":
                return `###### ${children}\n\n`;
              case "p":
                return `${children}\n\n`;
              case "a":
                return `[${children}](${element.getAttribute("href") || ""})`;
              case "strong":
              case "b":
                return `**${children}**`;
              case "em":
              case "i":
                return `*${children}*`;
              case "code":
                return `\`${children}\``;
              case "pre":
                return `\`\`\`\n${children}\n\`\`\`\n\n`;
              case "ul":
              case "ol":
                return `${children}\n`;
              case "li":
                return `- ${children}\n`;
              case "br":
                return "\n";
              case "hr":
                return "\n---\n\n";
              case "img":
                return `![${element.getAttribute("alt") || ""}](${element.getAttribute("src") || ""})`;
              default:
                return children;
            }
          };

          return convertToMarkdown(el);
        }, selector);
        break;
      default:
        content = await element.innerText();
        break;
    }

    // Truncate very long content
    const maxLength = 100000;
    if (content.length > maxLength) {
      content = `${content.substring(0, maxLength)}\n... (truncated)`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: content,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Get content failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
