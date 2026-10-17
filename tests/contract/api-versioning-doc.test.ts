import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANONICAL_V1_ROUTES } from "../../src/api/routes/registry.js";

/**
 * Keeps docs/api-versioning.md in sync with the canonical route registry.
 */

const DOC_PATH = "docs/api-versioning.md";

function readDoc(): string {
  return readFileSync(resolve(process.cwd(), DOC_PATH), "utf8");
}

describe("api-versioning docs", () => {
  it("documents every canonical /v1 route", () => {
    const doc = readDoc();
    for (const { method, path } of CANONICAL_V1_ROUTES) {
      expect(doc.includes(path), `${method} ${path}`).toBe(true);
    }
  });

  it("documents every legacy alias from the registry", () => {
    const doc = readDoc();
    for (const { method, path, legacyAliases } of CANONICAL_V1_ROUTES) {
      for (const alias of legacyAliases ?? []) {
        expect(doc.includes(alias), `${method} ${path} -> ${alias}`).toBe(
          true
        );
      }
    }
  });
});
