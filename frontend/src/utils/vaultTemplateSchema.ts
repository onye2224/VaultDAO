/**
 * Vault template schema & validation — Issue #2081 (frontend)
 *
 * Schema versioning, preset parameter validation, and migration helpers
 * mirroring the server-side rules so invalid presets are caught before the
 * API round-trip.
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const VAULT_TEMPLATE_SCHEMA_VERSION = 1 as const;
export type VaultTemplateSchemaVersion = typeof VAULT_TEMPLATE_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const VAULT_TEMPLATE_CATEGORIES_V1 = [
  "startup",
  "dao",
  "grants",
  "payroll",
  "investment",
  "custom",
] as const;

export type VaultTemplateCategoryV1 = (typeof VAULT_TEMPLATE_CATEGORIES_V1)[number];

// ---------------------------------------------------------------------------
// Preset parameter type
// ---------------------------------------------------------------------------

export interface VaultPresetParamsV1 {
  threshold: number;
  maxSigners: number;
  /** Maximum per-proposal amount in stroops */
  spendingLimit: string;
  /** Maximum aggregate daily outflow in stroops */
  dailyLimit: string;
  /** Maximum aggregate weekly outflow in stroops */
  weeklyLimit: string;
  /** Amount above which a timelock is applied, in stroops */
  timelockThreshold: string;
  /** Timelock duration in ledgers (~5 s / ledger) */
  timelockDelay: number;
}

// ---------------------------------------------------------------------------
// Versioned template record
// ---------------------------------------------------------------------------

export interface VaultTemplateV1 {
  id: string;
  schemaVersion: VaultTemplateSchemaVersion;
  name: string;
  description: string;
  category: VaultTemplateCategoryV1;
  icon: string;
  preset: VaultPresetParamsV1;
  features: string[];
  isOfficial: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Union of all versioned template shapes (extend here when v2 ships). */
export type AnyVaultTemplate = VaultTemplateV1;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TemplateValidationError {
  field: string;
  message: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: TemplateValidationError[];
}

function isPositiveBigInt(value: string): boolean {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

/** Validates preset parameters with the same rules as the server. */
export function validatePresetParamsV1(params: VaultPresetParamsV1): TemplateValidationResult {
  const errors: TemplateValidationError[] = [];

  if (!Number.isInteger(params.threshold) || params.threshold < 1) {
    errors.push({ field: "threshold", message: "Threshold must be a positive integer." });
  }
  if (!Number.isInteger(params.maxSigners) || params.maxSigners < 1) {
    errors.push({ field: "maxSigners", message: "maxSigners must be a positive integer." });
  }
  if (
    errors.every((e) => e.field !== "threshold" && e.field !== "maxSigners") &&
    params.threshold > params.maxSigners
  ) {
    errors.push({
      field: "threshold",
      message: `Threshold (${params.threshold}) cannot exceed maxSigners (${params.maxSigners}).`,
    });
  }

  for (const field of ["spendingLimit", "dailyLimit", "weeklyLimit", "timelockThreshold"] as const) {
    if (!isPositiveBigInt(params[field])) {
      errors.push({ field, message: `${field} must be a positive integer string (stroops).` });
    }
  }

  if (!Number.isInteger(params.timelockDelay) || params.timelockDelay < 0) {
    errors.push({ field: "timelockDelay", message: "timelockDelay must be a non-negative integer." });
  }

  if (
    isPositiveBigInt(params.spendingLimit) &&
    isPositiveBigInt(params.dailyLimit) &&
    BigInt(params.spendingLimit) > BigInt(params.dailyLimit)
  ) {
    errors.push({ field: "spendingLimit", message: "spendingLimit must be ≤ dailyLimit." });
  }

  if (
    isPositiveBigInt(params.dailyLimit) &&
    isPositiveBigInt(params.weeklyLimit) &&
    BigInt(params.dailyLimit) > BigInt(params.weeklyLimit)
  ) {
    errors.push({ field: "dailyLimit", message: "dailyLimit must be ≤ weeklyLimit." });
  }

  return { valid: errors.length === 0, errors };
}

/** Full template record validation. */
export function validateVaultTemplateV1(template: Partial<VaultTemplateV1>): TemplateValidationResult {
  const errors: TemplateValidationError[] = [];

  if (!template.id?.trim()) errors.push({ field: "id", message: "id is required." });
  if (!template.name?.trim()) errors.push({ field: "name", message: "Name is required." });
  else if (template.name.length > 100) errors.push({ field: "name", message: "Name must be ≤ 100 characters." });
  if (!template.description?.trim()) errors.push({ field: "description", message: "Description is required." });
  if (!template.category || !(VAULT_TEMPLATE_CATEGORIES_V1 as readonly string[]).includes(template.category)) {
    errors.push({
      field: "category",
      message: `Category must be one of: ${VAULT_TEMPLATE_CATEGORIES_V1.join(", ")}.`,
    });
  }

  if (!template.preset) {
    errors.push({ field: "preset", message: "Preset parameters are required." });
  } else {
    const presetResult = validatePresetParamsV1(template.preset);
    errors.push(...presetResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Migration path
// ---------------------------------------------------------------------------

/**
 * Migrate a template from any schema version to the latest (v1).
 *
 * When v2 is introduced:
 *   1. Add `VaultTemplateV2` to this file.
 *   2. Add `migrateV1toV2(t: VaultTemplateV1): VaultTemplateV2` below.
 *   3. Update the union type `AnyVaultTemplate`.
 *   4. Add a case to `migrateTemplate`.
 */
export function migrateTemplate(raw: { schemaVersion?: number; [key: string]: unknown }): VaultTemplateV1 {
  const version = raw.schemaVersion ?? 1;

  if (version === VAULT_TEMPLATE_SCHEMA_VERSION) {
    // Already current
    return raw as unknown as VaultTemplateV1;
  }

  throw new Error(
    `Cannot migrate template from schema version ${version}. ` +
    `Current version is ${VAULT_TEMPLATE_SCHEMA_VERSION}. ` +
    `See docs/guides/VAULT_TEMPLATES.md for the migration guide.`,
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Converts stroops to XLM for display, with locale formatting. */
export function stroopsToXLM(stroops: string): string {
  try {
    return (Number(BigInt(stroops)) / 10_000_000).toLocaleString();
  } catch {
    return "?";
  }
}
