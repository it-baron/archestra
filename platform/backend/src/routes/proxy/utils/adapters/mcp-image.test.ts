import { describe, expect, test } from "@/test";
import { hasImageContent, isMcpImageBlock } from "./mcp-image";

/**
 * Tests that the re-exports from ../mcp-image work correctly.
 * Main tests are in ../mcp-image.test.ts
 */
describe("adapters/mcp-image re-exports", () => {
  test("re-exports isMcpImageBlock", () => {
    expect(typeof isMcpImageBlock).toBe("function");
    expect(isMcpImageBlock({ type: "image", data: "abc" })).toBe(true);
  });

  test("re-exports hasImageContent", () => {
    expect(typeof hasImageContent).toBe("function");
    expect(
      hasImageContent([{ type: "image", data: "abc", mimeType: "image/png" }]),
    ).toBe(true);
  });
});
