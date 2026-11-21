/**
 * HTTP controller for the vault template catalog — Issue #2081
 *
 * Routes are mounted under /api/v1/vault/templates by vault.routes.ts.
 */

import type { RequestHandler } from "express";
import { z } from "zod";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { VAULT_TEMPLATE_CATEGORIES } from "./vault-template.types.js";
import type { VaultTemplateService } from "./vault-template.service.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const presetSchema = z.object({
  threshold: z.number().int().min(1),
  maxSigners: z.number().int().min(1),
  spendingLimit: z.string().regex(/^\d+$/, "must be a numeric string"),
  dailyLimit: z.string().regex(/^\d+$/, "must be a numeric string"),
  weeklyLimit: z.string().regex(/^\d+$/, "must be a numeric string"),
  timelockThreshold: z.string().regex(/^\d+$/, "must be a numeric string"),
  timelockDelay: z.number().int().min(0),
});

export const createTemplateBodySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  description: z.string().min(1),
  category: z.enum(VAULT_TEMPLATE_CATEGORIES),
  icon: z.string().optional().default("📄"),
  preset: presetSchema,
  features: z.array(z.string()).optional().default([]),
});

export const instantiateBodySchema = z.object({
  templateId: z.string().min(1),
  signers: z.array(z.string().min(1)).min(1),
  overrides: presetSchema.partial().optional(),
  label: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/** GET /api/v1/vault/templates */
export function listTemplatesController(
  service: VaultTemplateService,
): RequestHandler {
  return (_req, res) => {
    const { category, officialOnly } = _req.query as Record<string, string>;
    const templates = service.listTemplates({
      category: category ?? undefined,
      officialOnly: officialOnly === "true",
    });
    success(res, templates);
  };
}

/** GET /api/v1/vault/templates/:templateId */
export function getTemplateController(
  service: VaultTemplateService,
): RequestHandler {
  return (req, res) => {
    const { templateId } = req.params as { templateId: string };
    const template = service.getTemplate(templateId);
    if (!template) {
      error(res, {
        message: `Template "${templateId}" not found`,
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    success(res, template);
  };
}

/** POST /api/v1/vault/templates  (community templates, admin-gated) */
export function createTemplateController(
  service: VaultTemplateService,
): RequestHandler {
  return (req, res) => {
    const parsed = createTemplateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, {
        message: "Invalid template payload",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
        details: parsed.error.issues,
      });
      return;
    }

    const { result: template, validation } = service.createCommunityTemplate(parsed.data as any);
    if (!validation.valid) {
      error(res, {
        message: "Template validation failed",
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
        details: validation.errors,
      });
      return;
    }

    success(res, template, { status: 201 });
  };
}

/** POST /api/v1/vault/templates/:templateId/instantiate */
export function instantiateTemplateController(
  service: VaultTemplateService,
): RequestHandler {
  return (req, res) => {
    const parsed = instantiateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, {
        message: "Invalid instantiation payload",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
        details: parsed.error.issues,
      });
      return;
    }

    // Allow templateId from URL param to override body field for REST ergonomics
    const { templateId: paramId } = req.params as { templateId?: string };
    const request = { ...parsed.data, templateId: paramId ?? parsed.data.templateId };

    const { result, validation } = service.instantiateFromTemplate(request);
    if (!validation.valid) {
      error(res, {
        message: "Instantiation validation failed",
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
        details: validation.errors,
      });
      return;
    }

    success(res, result, { status: 201 });
  };
}

/** DELETE /api/v1/vault/templates/:templateId  (admin-gated) */
export function deactivateTemplateController(
  service: VaultTemplateService,
): RequestHandler {
  return (req, res) => {
    const { templateId } = req.params as { templateId: string };
    const ok = service.deactivateTemplate(templateId);
    if (!ok) {
      error(res, {
        message: `Template "${templateId}" not found or is an official template`,
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    success(res, { deactivated: true, templateId });
  };
}
