/**
 * Server-side preset parameter validation — Issue #2081
 *
 * All stroop strings are validated as positive integers.  Structural
 * relationships (threshold ≤ signers, limits ordering) are enforced here so
 * the on-chain call never receives garbage.
 */

import type {
  VaultPresetParams,
  VaultTemplate,
  TemplateValidationResult,
} from "./vault-template.types.js";
import { VAULT_TEMPLATE_CATEGORIES } from "./vault-template.types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPositiveBigInt(value: string): boolean {
  try {
    const n = BigInt(value);
    return n > 0n;
  } catch {
    return false;
  }
}

function bigInt(value: string): bigint {
  return BigInt(value);
}

// ---------------------------------------------------------------------------
// Preset parameter validation
// ---------------------------------------------------------------------------

/**
 * Validate preset parameters in isolation (no signer count required here;
 * signer-aware checks happen in `validateInstantiationRequest`).
 */
export function validatePresetParams(
  params: VaultPresetParams,
): TemplateValidationResult {
  const errors: TemplateValidationResult["errors"] = [];

  // threshold
  if (!Number.isInteger(params.threshold) || params.threshold < 1) {
    errors.push({ field: "threshold", message: "threshold must be a positive integer" });
  }

  // maxSigners
  if (!Number.isInteger(params.maxSigners) || params.maxSigners < 1) {
    errors.push({ field: "maxSigners", message: "maxSigners must be a positive integer" });
  }

  if (
    errors.every((e) => e.field !== "threshold" && e.field !== "maxSigners") &&
    params.threshold > params.maxSigners
  ) {
    errors.push({
      field: "threshold",
      message: `threshold (${params.threshold}) cannot exceed maxSigners (${params.maxSigners})`,
    });
  }

  // Stroop fields
  const stroopFields = [
    "spendingLimit",
    "dailyLimit",
    "weeklyLimit",
    "timelockThreshold",
  ] as const;

  for (const field of stroopFields) {
    if (!isPositiveBigInt(params[field])) {
      errors.push({ field, message: `${field} must be a positive integer string (stroops)` });
    }
  }

  // timelockDelay
  if (!Number.isInteger(params.timelockDelay) || params.timelockDelay < 0) {
    errors.push({ field: "timelockDelay", message: "timelockDelay must be a non-negative integer (ledgers)" });
  }

  // Limit ordering: spendingLimit ≤ dailyLimit ≤ weeklyLimit
  if (
    isPositiveBigInt(params.spendingLimit) &&
    isPositiveBigInt(params.dailyLimit) &&
    bigInt(params.spendingLimit) > bigInt(params.dailyLimit)
  ) {
    errors.push({
      field: "spendingLimit",
      message: "spendingLimit must be ≤ dailyLimit",
    });
  }

  if (
    isPositiveBigInt(params.dailyLimit) &&
    isPositiveBigInt(params.weeklyLimit) &&
    bigInt(params.dailyLimit) > bigInt(params.weeklyLimit)
  ) {
    errors.push({
      field: "dailyLimit",
      message: "dailyLimit must be ≤ weeklyLimit",
    });
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Full template record validation
// ---------------------------------------------------------------------------

export function validateVaultTemplate(template: Partial<VaultTemplate>): TemplateValidationResult {
  const errors: TemplateValidationResult["errors"] = [];

  if (!template.id || template.id.trim().length === 0) {
    errors.push({ field: "id", message: "id is required" });
  }

  if (!template.name || template.name.trim().length === 0) {
    errors.push({ field: "name", message: "name is required" });
  } else if (template.name.length > 100) {
    errors.push({ field: "name", message: "name must be ≤ 100 characters" });
  }

  if (!template.description || template.description.trim().length === 0) {
    errors.push({ field: "description", message: "description is required" });
  }

  if (
    !template.category ||
    !VAULT_TEMPLATE_CATEGORIES.includes(template.category as any)
  ) {
    errors.push({
      field: "category",
      message: `category must be one of: ${VAULT_TEMPLATE_CATEGORIES.join(", ")}`,
    });
  }

  if (!template.preset) {
    errors.push({ field: "preset", message: "preset is required" });
  } else {
    const presetResult = validatePresetParams(template.preset);
    errors.push(...presetResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Instantiation-time validation (signer-aware)
// ---------------------------------------------------------------------------

/**
 * Validates an instantiation request: checks that:
 *   - at least one signer is supplied
 *   - threshold ≤ signer count
 *   - any overrides are individually valid
 *   - merged config is valid
 */
export function validateInstantiationRequest(
  preset: VaultPresetParams,
  signers: string[],
  overrides?: Partial<VaultPresetParams>,
): TemplateValidationResult {
  const errors: TemplateValidationResult["errors"] = [];

  if (!Array.isArray(signers) || signers.length === 0) {
    errors.push({ field: "signers", message: "at least one signer is required" });
  }

  // Merge overrides onto preset for holistic validation
  const merged: VaultPresetParams = { ...preset, ...overrides };

  const mergedResult = validatePresetParams(merged);
  errors.push(...mergedResult.errors);

  // Threshold vs actual signer count
  const effectiveThreshold = overrides?.threshold ?? preset.threshold;
  if (
    signers.length > 0 &&
    Number.isInteger(effectiveThreshold) &&
    effectiveThreshold > signers.length
  ) {
    errors.push({
      field: "threshold",
      message: `threshold (${effectiveThreshold}) cannot exceed the number of signers (${signers.length})`,
    });
  }

  return { valid: errors.length === 0, errors };
}
