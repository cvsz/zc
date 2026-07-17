/** Tests bounded transcript-flush probing before reusing CLI bindings. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCliBindingFlushed,
  restoreCliRunnerTestDeps,
  setCliRunnerTestDeps,
} from "./cli-runner.js";

describe("isCliBindingFlushed", () => {
  const workspaceDir = "/tmp/zaicoder-workspace";

  beforeEach(() => {
    vi.useRealTimers();
    restoreCliRunnerTestDeps();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    restoreCliRunnerTestDeps();
  });

  it("returns false when no sessionId is provided", async () => {
    const probe = vi.fn(async () => true);
    setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe });

    expect(await isCliBindingFlushed(undefined, "zaicoder-cli")).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns true when the transcript has content on the first probe", async () => {
    const probe = vi.fn(async () => true);
    setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe });

    expect(await isCliBindingFlushed("sid-fresh", "zaicoder-cli", workspaceDir)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith({ sessionId: "sid-fresh", workspaceDir });
  });

  it("retries up to three times before giving up", async () => {
    const delay = vi.fn(async () => undefined);
    const probe = vi.fn(async () => false);
    setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe, delay });

    expect(await isCliBindingFlushed("sid-cold", "zaicoder-cli", workspaceDir)).toBe(false);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenNthCalledWith(1, 50);
    expect(delay).toHaveBeenNthCalledWith(2, 150);
  });

  it("succeeds when the transcript becomes visible on a later retry", async () => {
    const delay = vi.fn(async () => undefined);
    let calls = 0;
    const probe = vi.fn(async () => {
      calls += 1;
      return calls >= 2;
    });
    setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe, delay });

    expect(await isCliBindingFlushed("sid-late", "zaicoder-cli", workspaceDir)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledExactlyOnceWith(50);
  });

  it("schedules at most 0 + 50 + 150ms of delay across the bounded retry", async () => {
    vi.useFakeTimers();
    try {
      // Fake timers enforce the retry contract without introducing wall-clock
      // sleeps into this import-heavy agent test.
      const probe = vi.fn(async () => false);
      setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe });

      const settled = vi.fn();
      const errored = vi.fn();
      isCliBindingFlushed("sid-bounded", "zaicoder-cli", workspaceDir).then(settled, errored);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(150);

      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled.mock.calls[0]?.[0]).toBe(false);
      expect(errored).not.toHaveBeenCalled();
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("returns true without probing for non-zaicoder-cli providers", async () => {
    const probe = vi.fn(async () => false);
    setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe });

    expect(await isCliBindingFlushed("sid-codex", "codex-cli")).toBe(true);
    expect(await isCliBindingFlushed("sid-anthrozaicoderc", "anthrozaicoderc")).toBe(true);
    expect(await isCliBindingFlushed("sid-openai", "openai")).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns true without probing when provider is undefined", async () => {
    const probe = vi.fn(async () => false);
    setCliRunnerTestDeps({ zaicoderCliSessionTranscriptHasContent: probe });

    expect(await isCliBindingFlushed("sid-x", undefined)).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
});
