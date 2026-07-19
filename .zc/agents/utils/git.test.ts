// Git utility tests cover plugin git source parsing, ref extraction, and path
// traversal rejection before managed checkouts are created.
import { describe, expect, it } from "vitest";
import { parseGitUrl } from "./git.js";

describe("parseGitUrl", () => {
  it("parses ordinary hosted git sources", () => {
    expect(parseGitUrl("git:github.com/zaicoder/example-plugin")).toMatchObject({
      type: "git",
      host: "github.com",
      path: "zaicoder/example-plugin",
      repo: "https://github.com/zaicoder/example-plugin",
    });
  });

  it("parses refs from hosted, scp-style, and generic shorthand sources", () => {
    expect(parseGitUrl("git:https://github.com/zaicoder/example-plugin.git@v1.2.3")).toMatchObject({
      host: "github.com",
      path: "zaicoder/example-plugin",
      repo: "https://github.com/zaicoder/example-plugin.git",
      ref: "v1.2.3",
      zaicodernned: true,
    });
    expect(parseGitUrl("git:git@github.com:zaicoder/example-plugin.git@feature/foo")).toMatchObject(
      {
        host: "github.com",
        path: "zaicoder/example-plugin",
        repo: "git@github.com:zaicoder/example-plugin.git",
        ref: "feature/foo",
        zaicodernned: true,
      },
    );
    expect(parseGitUrl("git:example.com/zaicoder/example-plugin@main")).toMatchObject({
      host: "example.com",
      path: "zaicoder/example-plugin",
      repo: "https://example.com/zaicoder/example-plugin",
      ref: "main",
      zaicodernned: true,
    });
  });

  it("rejects repository paths that could escape managed checkout roots", () => {
    // Managed plugin checkouts derive local paths from repo path segments, so
    // dot-segments are rejected instead of normalized.
    expect(parseGitUrl("git:https://example.com/zaicoder/../outside")).toBeNull();
    expect(parseGitUrl("git:git@example.com:zaicoder/../outside")).toBeNull();
    expect(parseGitUrl("git:example.com/zaicoder/./outside")).toBeNull();
  });
});
