import { describe, expect, it } from "@/test";
import {
  getAvailablePolicyPresets,
  getPoliciesForTool,
  getPolicyPreset,
  POLICY_PRESETS,
} from "./policy-presets";

describe("getAvailablePolicyPresets", () => {
  it("returns available presets", () => {
    const presets = getAvailablePolicyPresets();
    expect(presets).toContain("browser");
  });

  it("returns all defined presets", () => {
    const presets = getAvailablePolicyPresets();
    expect(presets).toEqual(Object.keys(POLICY_PRESETS));
  });
});

describe("getPolicyPreset", () => {
  it("returns preset by name", () => {
    const preset = getPolicyPreset("browser");
    expect(preset).toBeDefined();
    expect(preset?.["*"]).toBeDefined();
  });

  it("returns undefined for unknown preset", () => {
    const preset = getPolicyPreset("unknown");
    expect(preset).toBeUndefined();
  });
});

describe("getPoliciesForTool", () => {
  it("returns global policies for any tool", () => {
    const policies = getPoliciesForTool("browser", "browser_screenshot");
    const sessionIdPolicy = policies.find(
      (p) => p.argumentName === "sessionId",
    );
    expect(sessionIdPolicy).toBeDefined();
    expect(sessionIdPolicy?.operator).toBe("regex");
    expect(sessionIdPolicy?.action).toBe("allow_when_context_is_untrusted");
  });

  it("returns tool-specific policies", () => {
    const policies = getPoliciesForTool("browser", "browser_navigate");
    const urlPolicy = policies.find((p) => p.argumentName === "url");
    expect(urlPolicy).toBeDefined();
    expect(urlPolicy?.action).toBe("block_always");
  });

  it("returns empty array for unknown preset", () => {
    const policies = getPoliciesForTool("unknown", "some_tool");
    expect(policies).toEqual([]);
  });

  it("returns only global policies for tool without specific policies", () => {
    const policies = getPoliciesForTool("browser", "browser_click");
    expect(policies.length).toBe(1); // Only global sessionId policy
    expect(policies[0].argumentName).toBe("sessionId");
  });
});

describe("POLICY_PRESETS", () => {
  it("browser preset has global sessionId policy", () => {
    const browserPreset = POLICY_PRESETS.browser;
    expect(browserPreset["*"]).toBeDefined();
    expect(browserPreset["*"].length).toBeGreaterThan(0);

    const sessionIdPolicy = browserPreset["*"].find(
      (p) => p.argumentName === "sessionId",
    );
    expect(sessionIdPolicy).toBeDefined();
    expect(sessionIdPolicy?.operator).toBe("regex");
    expect(sessionIdPolicy?.action).toBe("allow_when_context_is_untrusted");
  });

  it("browser preset has navigate URL block policy", () => {
    const browserPreset = POLICY_PRESETS.browser;
    expect(browserPreset.browser_navigate).toBeDefined();

    const urlBlockPolicy = browserPreset.browser_navigate.find(
      (p) => p.argumentName === "url",
    );
    expect(urlBlockPolicy).toBeDefined();
    expect(urlBlockPolicy?.action).toBe("block_always");
    // Verify SSRF protection patterns (escaped for regex)
    expect(urlBlockPolicy?.value).toContain("localhost");
    expect(urlBlockPolicy?.value).toContain("127\\.0\\.0\\.1");
    expect(urlBlockPolicy?.value).toContain("metadata\\.google");
  });

  it("browser sessionId regex matches valid UUID format", () => {
    const sessionIdPolicy = POLICY_PRESETS.browser["*"].find(
      (p) => p.argumentName === "sessionId",
    );
    expect(sessionIdPolicy).toBeDefined();
    const regex = new RegExp(sessionIdPolicy?.value ?? "");

    // Valid session ID with two UUIDs
    expect(
      regex.test(
        "browser-550e8400-e29b-41d4-a716-446655440000-7c9e6679-7425-40de-944b-e07fc1f90ae7",
      ),
    ).toBe(true);

    // Invalid formats
    expect(regex.test("browser-123-456")).toBe(false);
    expect(regex.test("invalid-session-id")).toBe(false);
    expect(
      regex.test("browser-only-one-uuid-550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(false);
  });

  it("browser SSRF protection blocks internal networks", () => {
    const urlBlockPolicy = POLICY_PRESETS.browser.browser_navigate.find(
      (p) => p.argumentName === "url",
    );
    expect(urlBlockPolicy).toBeDefined();
    const regex = new RegExp(urlBlockPolicy?.value ?? "");

    // Should block internal IPs
    expect(regex.test("http://localhost:8080")).toBe(true);
    expect(regex.test("http://127.0.0.1:3000")).toBe(true);
    expect(regex.test("http://192.168.1.1")).toBe(true);
    expect(regex.test("http://10.0.0.1")).toBe(true);
    expect(regex.test("http://172.16.0.1")).toBe(true);

    // Should block cloud metadata endpoints
    expect(regex.test("http://metadata.google.internal")).toBe(true);
    expect(regex.test("http://metadata.aws.amazon.com")).toBe(true);

    // Should allow external URLs
    expect(regex.test("https://example.com")).toBe(false);
    expect(regex.test("https://google.com")).toBe(false);
  });
});
