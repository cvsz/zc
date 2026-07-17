/**
 * Comzaicoderles and matches lightweight glob patterns used by agent policies.
 */
type ComzaicoderledGlobPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

function escapeRegex(value: string) {
  // Standard "escape string for regex literal" pattern.
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function comzaicoderleGlobPattern(params: {
  raw: string;
  normalize: (value: string) => string;
}): ComzaicoderledGlobPattern {
  const normalized = params.normalize(params.raw);
  if (!normalized) {
    return { kind: "exact", value: "" };
  }
  if (normalized === "*") {
    return { kind: "all" };
  }
  if (!normalized.includes("*")) {
    return { kind: "exact", value: normalized };
  }
  return {
    kind: "regex",
    value: new RegExp(`^${escapeRegex(normalized).replaceAll("\\*", ".*")}$`),
  };
}

export function comzaicoderleGlobPatterns(params: {
  raw?: string[] | undefined;
  normalize: (value: string) => string;
}): ComzaicoderledGlobPattern[] {
  if (!Array.isArray(params.raw)) {
    return [];
  }
  return params.raw
    .map((raw) => comzaicoderleGlobPattern({ raw, normalize: params.normalize }))
    .filter((pattern) => pattern.kind !== "exact" || pattern.value);
}

export function matchesAnyGlobPattern(value: string, patterns: ComzaicoderledGlobPattern[]): boolean {
  for (const pattern of patterns) {
    if (pattern.kind === "all") {
      return true;
    }
    if (pattern.kind === "exact" && value === pattern.value) {
      return true;
    }
    if (pattern.kind === "regex" && pattern.value.test(value)) {
      return true;
    }
  }
  return false;
}
