/**
 * Tests for VaultTemplateService — Issue #2081
 *
 * Covers: catalog listing, preset validation, instantiation (happy + error
 * paths) for each of the three official presets.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { VaultTemplateService, InMemoryTemplateStore } from "./vault-template.service.js";
import { OFFICIAL_TEMPLATES } from "./vault-template.catalog.js";
import type { VaultPresetParams, VaultTemplate } from "./vault-template.types.js";
import { TEMPLATE_SCHEMA_VERSION } from "./vault-template.types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(seedCommunity: VaultTemplate[] = []): VaultTemplateService {
  const store = new InMemoryTemplateStore();
  for (const t of seedCommunity) store.set(t.id, t);
  return new VaultTemplateService(store);
}

function validSigners(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `SIGNER${i + 1}`.padEnd(56, "X"));
}

// ---------------------------------------------------------------------------
// Catalog listing
// ---------------------------------------------------------------------------

test("VaultTemplateService: lists all three official templates", () => {
  const svc = makeService();
  const templates = svc.listTemplates();
  const officialIds = templates.filter((t) => t.isOfficial).map((t) => t.id);
  assert.ok(officialIds.includes("startup-v1"), "startup-v1 present");
  assert.ok(officialIds.includes("dao-treasury-v1"), "dao-treasury-v1 present");
  assert.ok(officialIds.includes("grants-v1"), "grants-v1 present");
  assert.strictEqual(templates.length, OFFICIAL_TEMPLATES.length);
});

test("VaultTemplateService: listTemplates filters by category", () => {
  const svc = makeService();
  const daoOnly = svc.listTemplates({ category: "dao" });
  assert.strictEqual(daoOnly.length, 1);
  assert.strictEqual(daoOnly[0]!.id, "dao-treasury-v1");
});

test("VaultTemplateService: listTemplates officialOnly excludes community templates", () => {
  const communityTpl: VaultTemplate = {
    id: "community-tpl-1",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: "My Community Template",
    description: "A test community template",
    category: "custom",
    icon: "🔧",
    preset: {
      threshold: 2,
      maxSigners: 3,
      spendingLimit: "1000000000",
      dailyLimit: "5000000000",
      weeklyLimit: "20000000000",
      timelockThreshold: "500000000",
      timelockDelay: 1000,
    },
    features: [],
    isOfficial: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const svc = makeService([communityTpl]);
  const officialOnly = svc.listTemplates({ officialOnly: true });
  assert.ok(officialOnly.every((t) => t.isOfficial));
  assert.ok(!officialOnly.some((t) => t.id === "community-tpl-1"));
});

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

test("VaultTemplateService: getTemplate returns official template by id", () => {
  const svc = makeService();
  const tpl = svc.getTemplate("grants-v1");
  assert.ok(tpl);
  assert.strictEqual(tpl.name, "Grants Program");
});

test("VaultTemplateService: getTemplate returns undefined for unknown id", () => {
  const svc = makeService();
  assert.strictEqual(svc.getTemplate("does-not-exist"), undefined);
});

// ---------------------------------------------------------------------------
// Instantiation — startup preset
// ---------------------------------------------------------------------------

test("VaultTemplateService: instantiates startup-v1 successfully", () => {
  const svc = makeService();
  const signers = validSigners(3);
  const { result, validation } = svc.instantiateFromTemplate({
    templateId: "startup-v1",
    signers,
  });
  assert.ok(validation.valid, `expected valid; errors: ${JSON.stringify(validation.errors)}`);
  assert.ok(result);
  assert.strictEqual(result.templateId, "startup-v1");
  assert.deepEqual(result.resolvedConfig.signers, signers);
  assert.strictEqual(result.resolvedConfig.threshold, 2);
  assert.strictEqual(result.eventLink, null);
});

test("VaultTemplateService: startup-v1 rejects threshold override > signer count", () => {
  const svc = makeService();
  const { validation } = svc.instantiateFromTemplate({
    templateId: "startup-v1",
    signers: validSigners(2),
    overrides: { threshold: 3 },
  });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.field === "threshold"));
});

// ---------------------------------------------------------------------------
// Instantiation — DAO treasury preset
// ---------------------------------------------------------------------------

test("VaultTemplateService: instantiates dao-treasury-v1 successfully with 7 signers", () => {
  const svc = makeService();
  const { result, validation } = svc.instantiateFromTemplate({
    templateId: "dao-treasury-v1",
    signers: validSigners(7),
  });
  assert.ok(validation.valid, JSON.stringify(validation.errors));
  assert.ok(result);
  assert.strictEqual(result.resolvedConfig.threshold, 5);
  assert.strictEqual(result.resolvedConfig.signers.length, 7);
});

test("VaultTemplateService: dao-treasury-v1 rejects empty signers", () => {
  const svc = makeService();
  const { validation } = svc.instantiateFromTemplate({
    templateId: "dao-treasury-v1",
    signers: [],
  });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.field === "signers"));
});

// ---------------------------------------------------------------------------
// Instantiation — grants preset
// ---------------------------------------------------------------------------

test("VaultTemplateService: instantiates grants-v1 successfully", () => {
  const svc = makeService();
  const { result, validation } = svc.instantiateFromTemplate({
    templateId: "grants-v1",
    signers: validSigners(5),
  });
  assert.ok(validation.valid, JSON.stringify(validation.errors));
  assert.ok(result);
  assert.strictEqual(result.resolvedConfig.threshold, 3);
});

test("VaultTemplateService: grants-v1 applies valid override", () => {
  const svc = makeService();
  const { result, validation } = svc.instantiateFromTemplate({
    templateId: "grants-v1",
    signers: validSigners(5),
    overrides: { timelockDelay: 10000 },
  });
  assert.ok(validation.valid, JSON.stringify(validation.errors));
  assert.strictEqual(result?.resolvedConfig.timelockDelay, 10000);
});

test("VaultTemplateService: instantiation fails for unknown template", () => {
  const svc = makeService();
  const { validation } = svc.instantiateFromTemplate({
    templateId: "nonexistent",
    signers: validSigners(3),
  });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.field === "templateId"));
});

// ---------------------------------------------------------------------------
// Invalid preset rejection
// ---------------------------------------------------------------------------

test("VaultTemplateService: createCommunityTemplate rejects invalid preset (spendingLimit > dailyLimit)", () => {
  const svc = makeService();
  const { validation } = svc.createCommunityTemplate({
    id: "bad-preset",
    name: "Bad Preset",
    description: "Should fail",
    category: "custom",
    icon: "❌",
    preset: {
      threshold: 1,
      maxSigners: 3,
      spendingLimit: "9999999999",   // > dailyLimit
      dailyLimit: "1000000000",
      weeklyLimit: "5000000000",
      timelockThreshold: "500000000",
      timelockDelay: 100,
    },
    features: [],
  });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.field === "spendingLimit"));
});

test("VaultTemplateService: createCommunityTemplate rejects id conflicting with official template", () => {
  const svc = makeService();
  const { validation } = svc.createCommunityTemplate({
    id: "startup-v1",          // conflicts with official
    name: "Hijack Attempt",
    description: "Trying to overwrite an official template",
    category: "custom",
    icon: "🚨",
    preset: {
      threshold: 1,
      maxSigners: 1,
      spendingLimit: "1000000",
      dailyLimit: "5000000",
      weeklyLimit: "10000000",
      timelockThreshold: "100000",
      timelockDelay: 100,
    },
    features: [],
  });
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.field === "id"));
});

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

test("VaultTemplateService: deactivates a community template", () => {
  const tpl: VaultTemplate = {
    id: "my-tpl",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: "My Template",
    description: "To be deactivated",
    category: "custom",
    icon: "🔧",
    preset: {
      threshold: 1,
      maxSigners: 2,
      spendingLimit: "1000000",
      dailyLimit: "5000000",
      weeklyLimit: "10000000",
      timelockThreshold: "100000",
      timelockDelay: 0,
    },
    features: [],
    isOfficial: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const svc = makeService([tpl]);
  assert.ok(svc.deactivateTemplate("my-tpl"));
  const all = svc.listTemplates();
  assert.ok(!all.some((t) => t.id === "my-tpl"), "deactivated template not in list");
});

test("VaultTemplateService: cannot deactivate an official template", () => {
  const svc = makeService();
  assert.strictEqual(svc.deactivateTemplate("dao-treasury-v1"), false);
});
