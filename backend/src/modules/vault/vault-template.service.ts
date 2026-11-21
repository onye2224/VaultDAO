/**
 * VaultTemplateService — Issue #2081
 *
 * Catalog API: list, get, create (community), and instantiate vault templates.
 * Official templates come from the in-process catalog; community templates are
 * stored in an injected key-value store (default: in-memory Map for tests).
 *
 * Instantiation does NOT submit an on-chain transaction — it returns the
 * merged, validated config ready for the caller to sign and submit.  The
 * eventLink field is left null until the caller supplies the ledger/txHash
 * after broadcasting.
 */

import type {
  VaultTemplate,
  VaultPresetParams,
  InstantiateFromTemplateRequest,
  InstantiateFromTemplateResponse,
  TemplateValidationResult,
} from "./vault-template.types.js";
import {
  TEMPLATE_SCHEMA_VERSION,
  VAULT_TEMPLATE_CATEGORIES,
} from "./vault-template.types.js";
import { OFFICIAL_TEMPLATES } from "./vault-template.catalog.js";
import {
  validateVaultTemplate,
  validateInstantiationRequest,
} from "./vault-template.validator.js";
import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("vault-template-service");

// ---------------------------------------------------------------------------
// Storage abstraction (keeps the service testable without SQLite)
// ---------------------------------------------------------------------------

export interface TemplateStore {
  getAll(): VaultTemplate[];
  get(id: string): VaultTemplate | undefined;
  set(id: string, template: VaultTemplate): void;
  delete(id: string): boolean;
}

export class InMemoryTemplateStore implements TemplateStore {
  private readonly map = new Map<string, VaultTemplate>();

  getAll(): VaultTemplate[] {
    return Array.from(this.map.values());
  }

  get(id: string): VaultTemplate | undefined {
    return this.map.get(id);
  }

  set(id: string, template: VaultTemplate): void {
    this.map.set(id, template);
  }

  delete(id: string): boolean {
    return this.map.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VaultTemplateService {
  private readonly store: TemplateStore;

  constructor(store?: TemplateStore) {
    this.store = store ?? new InMemoryTemplateStore();
  }

  // ── Catalog queries ─────────────────────────────────────────────────────

  /** Returns all active templates: official built-ins first, then community. */
  listTemplates(filter?: { category?: string; officialOnly?: boolean }): VaultTemplate[] {
    const official = OFFICIAL_TEMPLATES.filter((t) => t.isActive);
    const community = this.store.getAll().filter((t) => t.isActive);

    let all = [...official, ...community];

    if (filter?.officialOnly) {
      all = all.filter((t) => t.isOfficial);
    }

    if (filter?.category) {
      all = all.filter((t) => t.category === filter.category);
    }

    return all;
  }

  /** Looks up one template by id (official or community). */
  getTemplate(id: string): VaultTemplate | undefined {
    const official = OFFICIAL_TEMPLATES.find((t) => t.id === id);
    if (official) return official;
    return this.store.get(id);
  }

  // ── Community template management ───────────────────────────────────────

  /** Validates and stores a new community template. */
  createCommunityTemplate(
    draft: Omit<VaultTemplate, "isOfficial" | "isActive" | "schemaVersion" | "createdAt" | "updatedAt">,
  ): { template?: VaultTemplate; validation: TemplateValidationResult } {
    const candidate: VaultTemplate = {
      ...draft,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      isOfficial: false,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const validation = validateVaultTemplate(candidate);
    if (!validation.valid) {
      return { validation };
    }

    if (OFFICIAL_TEMPLATES.some((t) => t.id === candidate.id)) {
      return {
        validation: {
          valid: false,
          errors: [{ field: "id", message: `id "${candidate.id}" conflicts with an official template` }],
        },
      };
    }

    this.store.set(candidate.id, candidate);
    logger.info("community template created", { id: candidate.id });
    return { template: candidate, validation };
  }

  /** Deactivates a community template (soft-delete). */
  deactivateTemplate(id: string): boolean {
    // Official templates cannot be deactivated via the service
    if (OFFICIAL_TEMPLATES.some((t) => t.id === id)) {
      return false;
    }
    const existing = this.store.get(id);
    if (!existing) return false;
    this.store.set(id, { ...existing, isActive: false, updatedAt: new Date().toISOString() });
    logger.info("template deactivated", { id });
    return true;
  }

  // ── Instantiation ────────────────────────────────────────────────────────

  /**
   * Resolves, validates, and returns the merged vault config ready for
   * on-chain submission.  Throws if the template is unknown or the request
   * is invalid.
   */
  instantiateFromTemplate(
    request: InstantiateFromTemplateRequest,
  ): { result?: InstantiateFromTemplateResponse; validation: TemplateValidationResult } {
    const template = this.getTemplate(request.templateId);
    if (!template) {
      return {
        validation: {
          valid: false,
          errors: [{ field: "templateId", message: `Template "${request.templateId}" not found` }],
        },
      };
    }

    if (!template.isActive) {
      return {
        validation: {
          valid: false,
          errors: [{ field: "templateId", message: `Template "${request.templateId}" is inactive` }],
        },
      };
    }

    const validation = validateInstantiationRequest(
      template.preset,
      request.signers,
      request.overrides,
    );

    if (!validation.valid) {
      return { validation };
    }

    const resolvedPreset: VaultPresetParams = { ...template.preset, ...request.overrides };

    const result: InstantiateFromTemplateResponse = {
      templateId: template.id,
      resolvedConfig: {
        ...resolvedPreset,
        signers: request.signers,
      },
      eventLink: null,
      instantiatedAt: new Date().toISOString(),
    };

    logger.info("vault instantiated from template", {
      templateId: template.id,
      signerCount: request.signers.length,
    });

    return { result, validation: { valid: true, errors: [] } };
  }
}
