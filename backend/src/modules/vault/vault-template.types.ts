/**
 * Vault Template type definitions — Issue #2081
 *
 * A VaultTemplate describes a reusable, versioned treasury preset (startup,
 * DAO, grants, …).  Templates are stored in the backend catalog and validated
 * server-side before the caller is allowed to instantiate a vault from them.
 *
 * All stroop-denominated values are stored as strings to avoid precision loss
 * with JS `number` (same convention as VaultConfigResponse).
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current schema version. Bump on any breaking field change. */
export const TEMPLATE_SCHEMA_VERSION = 1 as const;
export type TemplateSchemaVersion = typeof TEMPLATE_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Preset parameter shape (mirrors on-chain VaultConfig)
// ---------------------------------------------------------------------------

export interface VaultPresetParams {
  /** M in M-of-N; must be ≥ 1 and ≤ maxSigners */
  threshold: number;
  /** Recommended maximum number of signers */
  maxSigners: number;
  /** Maximum amount per single proposal, in stroops */
  spendingLimit: string;
  /** Maximum aggregate daily outflow, in stroops */
  dailyLimit: string;
  /** Maximum aggregate weekly outflow, in stroops */
  weeklyLimit: string;
  /** Amount above which a timelock is applied, in stroops */
  timelockThreshold: string;
  /** Timelock duration in ledgers (~5 s / ledger) */
  timelockDelay: number;
}

// ---------------------------------------------------------------------------
// Template categories
// ---------------------------------------------------------------------------

export const VAULT_TEMPLATE_CATEGORIES = [
  "startup",
  "dao",
  "grants",
  "payroll",
  "investment",
  "custom",
] as const;

export type VaultTemplateCategory = (typeof VAULT_TEMPLATE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Template record
// ---------------------------------------------------------------------------

export interface VaultTemplate {
  /** Unique slug, e.g. "dao-treasury-v1" */
  id: string;
  /** Schema version for migration tracking */
  schemaVersion: TemplateSchemaVersion;
  /** Display name */
  name: string;
  /** Human-readable purpose */
  description: string;
  /** Broad category */
  category: VaultTemplateCategory;
  /** Emoji / short icon hint for the UI */
  icon: string;
  /** Validated preset parameters */
  preset: VaultPresetParams;
  /** Bullet-point feature summary shown in the UI */
  features: string[];
  /** Whether this is a built-in (official) template */
  isOfficial: boolean;
  /** Whether the template is published in the catalog */
  isActive: boolean;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Instantiation request / response
// ---------------------------------------------------------------------------

/** Payload sent by the frontend to instantiate a vault from a template. */
export interface InstantiateFromTemplateRequest {
  /** The template to use */
  templateId: string;
  /** Signer addresses provided by the caller */
  signers: string[];
  /**
   * Optional parameter overrides. Only fields explicitly listed in the
   * template's `allowOverrides` are accepted; the rest are enforced from the
   * preset.
   */
  overrides?: Partial<VaultPresetParams>;
  /** Free-form label for the resulting vault */
  label?: string;
}

/** Returned after a successful instantiation. */
export interface InstantiateFromTemplateResponse {
  /** Echo of the template used */
  templateId: string;
  /** The final, merged config that was submitted on-chain */
  resolvedConfig: VaultPresetParams & { signers: string[] };
  /** On-chain event link (ledger sequence + transaction hash) */
  eventLink: {
    ledger: number;
    txHash: string;
  } | null;
  /** ISO timestamp of the instantiation */
  instantiatedAt: string;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}
