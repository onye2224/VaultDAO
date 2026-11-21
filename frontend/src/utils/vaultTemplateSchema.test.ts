/**
 * Tests for vaultTemplateSchema — Issue #2081
 *
 * Validates preset rules, full-template validation, and the migration guard.
 */

import { describe, it, expect } from "vitest";
import {
  validatePresetParamsV1,
  validateVaultTemplateV1,
  migrateTemplate,
  VAULT_TEMPLATE_SCHEMA_VERSION,
  type VaultPresetParamsV1,
  type VaultTemplateV1,
} from "./vaultTemplateSchema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validPreset: VaultPresetParamsV1 = {
  threshold: 2,
  maxSigners: 3,
  spendingLimit: "5000000000",
  dailyLimit: "20000000000",
  weeklyLimit: "100000000000",
  timelockThreshold: "10000000000",
  timelockDelay: 8640,
};

function makeTemplate(overrides: Partial<VaultTemplateV1> = {}): Partial<VaultTemplateV1> {
  return {
    id: "test-template",
    schemaVersion: VAULT_TEMPLATE_SCHEMA_VERSION,
    name: "Test Template",
    description: "A test",
    category: "startup",
    icon: "🚀",
    preset: { ...validPreset },
    features: [],
    isOfficial: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Preset validation — happy paths
// ---------------------------------------------------------------------------

describe("validatePresetParamsV1 — valid cases", () => {
  it("accepts a well-formed startup preset", () => {
    const { valid } = validatePresetParamsV1(validPreset);
    expect(valid).toBe(true);
  });

  it("accepts threshold equal to maxSigners", () => {
    const { valid } = validatePresetParamsV1({ ...validPreset, threshold: 3, maxSigners: 3 });
    expect(valid).toBe(true);
  });

  it("accepts timelockDelay of 0", () => {
    const { valid } = validatePresetParamsV1({ ...validPreset, timelockDelay: 0 });
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preset validation — error cases
// ---------------------------------------------------------------------------

describe("validatePresetParamsV1 — invalid cases", () => {
  it("rejects threshold < 1", () => {
    const { valid, errors } = validatePresetParamsV1({ ...validPreset, threshold: 0 });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "threshold")).toBe(true);
  });

  it("rejects threshold > maxSigners", () => {
    const { valid, errors } = validatePresetParamsV1({ ...validPreset, threshold: 5, maxSigners: 3 });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "threshold")).toBe(true);
  });

  it("rejects non-numeric spendingLimit", () => {
    const { valid, errors } = validatePresetParamsV1({ ...validPreset, spendingLimit: "abc" });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "spendingLimit")).toBe(true);
  });

  it("rejects spendingLimit > dailyLimit", () => {
    const { valid, errors } = validatePresetParamsV1({
      ...validPreset,
      spendingLimit: "99999999999",
      dailyLimit: "1000000000",
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "spendingLimit")).toBe(true);
  });

  it("rejects dailyLimit > weeklyLimit", () => {
    const { valid, errors } = validatePresetParamsV1({
      ...validPreset,
      dailyLimit: "999999999999",
      weeklyLimit: "1000000000",
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "dailyLimit")).toBe(true);
  });

  it("rejects negative timelockDelay", () => {
    const { valid, errors } = validatePresetParamsV1({ ...validPreset, timelockDelay: -1 });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "timelockDelay")).toBe(true);
  });

  it("rejects zero spendingLimit", () => {
    const { valid, errors } = validatePresetParamsV1({ ...validPreset, spendingLimit: "0" });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "spendingLimit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full template validation
// ---------------------------------------------------------------------------

describe("validateVaultTemplateV1", () => {
  it("accepts a valid template", () => {
    const { valid } = validateVaultTemplateV1(makeTemplate());
    expect(valid).toBe(true);
  });

  it("rejects missing name", () => {
    const { valid, errors } = validateVaultTemplateV1(makeTemplate({ name: "" }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects invalid category", () => {
    const { valid, errors } = validateVaultTemplateV1(makeTemplate({ category: "invalid" as any }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "category")).toBe(true);
  });

  it("rejects missing preset", () => {
    const { valid, errors } = validateVaultTemplateV1(makeTemplate({ preset: undefined }));
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "preset")).toBe(true);
  });

  it("surfaces preset errors within template validation", () => {
    const { valid, errors } = validateVaultTemplateV1(
      makeTemplate({ preset: { ...validPreset, threshold: 99, maxSigners: 1 } }),
    );
    expect(valid).toBe(false);
    expect(errors.some((e) => e.field === "threshold")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe("migrateTemplate", () => {
  it("passes through a current-version template unchanged", () => {
    const tpl = makeTemplate() as VaultTemplateV1;
    const result = migrateTemplate(tpl);
    expect(result).toEqual(tpl);
  });

  it("throws for an unknown future schema version", () => {
    expect(() => migrateTemplate({ schemaVersion: 99 })).toThrow(/Cannot migrate/);
  });

  it("treats missing schemaVersion as v1", () => {
    const tpl = { ...makeTemplate() };
    delete (tpl as any).schemaVersion;
    // Should not throw
    expect(() => migrateTemplate(tpl)).not.toThrow();
  });
});
