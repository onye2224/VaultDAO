/**
 * VaultTemplateWizard — Issue #2081
 *
 * Step-by-step UI for picking a vault template, optionally overriding presets,
 * providing signers, then validating and instantiating via the backend catalog API.
 *
 * Steps:
 *   1. Pick template from catalog
 *   2. Configure signers + optional overrides
 *   3. Review & submit (validation runs before submit)
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
  Users,
  Shield,
  Zap,
  Plus,
  Trash2,
} from "lucide-react";
import {
  validatePresetParamsV1,
  stroopsToXLM,
  type VaultTemplateV1,
  type VaultPresetParamsV1,
} from "../utils/vaultTemplateSchema";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function fetchTemplates(): Promise<VaultTemplateV1[]> {
  const res = await fetch(`${API_BASE}/api/v1/vault/templates`);
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  const json = await res.json();
  return json.data as VaultTemplateV1[];
}

async function instantiateTemplate(params: {
  templateId: string;
  signers: string[];
  overrides?: Partial<VaultPresetParamsV1>;
  label?: string;
}) {
  const res = await fetch(`${API_BASE}/api/v1/vault/templates/${params.templateId}/instantiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!res.ok) {
    const details = json.error?.details ?? [];
    const msg =
      Array.isArray(details) && details.length > 0
        ? details.map((d: any) => `${d.field}: ${d.message}`).join(", ")
        : json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CategoryBadge: React.FC<{ category: string }> = ({ category }) => {
  const colours: Record<string, string> = {
    startup: "bg-blue-500/20 text-blue-400",
    dao: "bg-purple-500/20 text-purple-400",
    grants: "bg-green-500/20 text-green-400",
    payroll: "bg-yellow-500/20 text-yellow-400",
    investment: "bg-orange-500/20 text-orange-400",
    custom: "bg-gray-500/20 text-gray-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
        colours[category] ?? colours.custom
      }`}
    >
      {category}
    </span>
  );
};

// ── Step 1 — Template picker ─────────────────────────────────────────────────

const TemplatePicker: React.FC<{
  templates: VaultTemplateV1[];
  selected: VaultTemplateV1 | null;
  onSelect: (t: VaultTemplateV1) => void;
}> = ({ templates, selected, onSelect }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {templates.map((t) => (
      <button
        key={t.id}
        onClick={() => onSelect(t)}
        className={`text-left p-4 rounded-xl border transition-all ${
          selected?.id === t.id
            ? "border-purple-500 bg-purple-500/10"
            : "border-gray-700 bg-gray-800/60 hover:border-purple-500/40"
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-2xl">{t.icon}</span>
          <CategoryBadge category={t.category} />
        </div>
        <h3 className="font-semibold text-white text-sm mb-1">{t.name}</h3>
        <p className="text-xs text-gray-400 line-clamp-2 mb-3">{t.description}</p>
        <ul className="space-y-0.5">
          {t.features.slice(0, 3).map((f, i) => (
            <li key={i} className="text-xs text-gray-500 flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-3 pt-3 border-t border-gray-700/50 grid grid-cols-2 gap-2 text-xs text-gray-500">
          <div>
            <span className="text-gray-600">Threshold</span>
            <div className="text-gray-300 font-mono">{t.preset.threshold}/{t.preset.maxSigners}</div>
          </div>
          <div>
            <span className="text-gray-600">Spending cap</span>
            <div className="text-gray-300 font-mono">{stroopsToXLM(t.preset.spendingLimit)} XLM</div>
          </div>
        </div>
      </button>
    ))}
  </div>
);

// ── Step 2 — Configure ───────────────────────────────────────────────────────

interface ConfigureStepProps {
  template: VaultTemplateV1;
  signers: string[];
  onSignersChange: (signers: string[]) => void;
  label: string;
  onLabelChange: (label: string) => void;
  overrides: Partial<VaultPresetParamsV1>;
  onOverridesChange: (o: Partial<VaultPresetParamsV1>) => void;
  errors: Array<{ field: string; message: string }>;
}

const ConfigureStep: React.FC<ConfigureStepProps> = ({
  template,
  signers,
  onSignersChange,
  label,
  onLabelChange,
  overrides,
  onOverridesChange,
  errors,
}) => {
  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;

  const updateSigner = (idx: number, val: string) => {
    const next = [...signers];
    next[idx] = val;
    onSignersChange(next);
  };

  const addSigner = () => onSignersChange([...signers, ""]);
  const removeSigner = (idx: number) => onSignersChange(signers.filter((_, i) => i !== idx));

  return (
    <div className="space-y-6">
      {/* Label */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Vault label (optional)</label>
        <input
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder="e.g. Marketing DAO Treasury"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Signers */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-gray-400 flex items-center gap-1">
            <Users className="w-4 h-4" /> Signers
          </label>
          <button
            type="button"
            onClick={addSigner}
            disabled={signers.length >= template.preset.maxSigners}
            className="flex items-center gap-1 text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded"
          >
            <Plus className="w-3 h-3" /> Add signer
          </button>
        </div>
        {errorFor("signers") && (
          <p className="text-red-400 text-xs mb-2">{errorFor("signers")}</p>
        )}
        <div className="space-y-2">
          {signers.map((s, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                value={s}
                onChange={(e) => updateSigner(idx, e.target.value)}
                placeholder={`Signer ${idx + 1} address (G...)`}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-purple-500 placeholder:font-sans"
              />
              {signers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSigner(idx)}
                  className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Preset recommends {template.preset.threshold}-of-{template.preset.maxSigners} multisig.
        </p>
      </div>

      {/* Threshold override */}
      <div>
        <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
          <Shield className="w-4 h-4" />
          Threshold override <span className="text-gray-600 text-xs">(default: {template.preset.threshold})</span>
        </label>
        {errorFor("threshold") && (
          <p className="text-red-400 text-xs mb-1">{errorFor("threshold")}</p>
        )}
        <input
          type="number"
          min={1}
          max={signers.length || template.preset.maxSigners}
          value={overrides.threshold ?? template.preset.threshold}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) onOverridesChange({ ...overrides, threshold: v });
          }}
          className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Timelock delay override */}
      <div>
        <label className="block text-sm text-gray-400 mb-1 flex items-center gap-1">
          <Zap className="w-4 h-4" />
          Timelock delay (ledgers) <span className="text-gray-600 text-xs">(default: {template.preset.timelockDelay})</span>
        </label>
        {errorFor("timelockDelay") && (
          <p className="text-red-400 text-xs mb-1">{errorFor("timelockDelay")}</p>
        )}
        <input
          type="number"
          min={0}
          value={overrides.timelockDelay ?? template.preset.timelockDelay}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) onOverridesChange({ ...overrides, timelockDelay: v });
          }}
          className="w-40 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
        />
        <p className="text-xs text-gray-500 mt-1">≈ {((overrides.timelockDelay ?? template.preset.timelockDelay) * 5 / 3600).toFixed(1)} hours at 5 s/ledger</p>
      </div>
    </div>
  );
};

// ── Step 3 — Review ──────────────────────────────────────────────────────────

const ReviewStep: React.FC<{
  template: VaultTemplateV1;
  signers: string[];
  label: string;
  overrides: Partial<VaultPresetParamsV1>;
}> = ({ template, signers, label, overrides }) => {
  const resolved = { ...template.preset, ...overrides };

  const row = (label: string, value: string) => (
    <div className="flex justify-between py-1.5 border-b border-gray-800 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-white font-mono text-right max-w-xs truncate">{value}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {label && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-2">
          <p className="text-purple-300 text-sm font-medium">{label}</p>
        </div>
      )}

      <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">{template.icon}</span>
          <div>
            <h4 className="font-semibold text-white text-sm">{template.name}</h4>
            <CategoryBadge category={template.category} />
          </div>
        </div>
        {row("Threshold", `${resolved.threshold} of ${signers.length} signers`)}
        {row("Spending limit", `${stroopsToXLM(resolved.spendingLimit)} XLM / proposal`)}
        {row("Daily limit", `${stroopsToXLM(resolved.dailyLimit)} XLM`)}
        {row("Weekly limit", `${stroopsToXLM(resolved.weeklyLimit)} XLM`)}
        {row("Timelock threshold", `${stroopsToXLM(resolved.timelockThreshold)} XLM`)}
        {row("Timelock delay", `${resolved.timelockDelay} ledgers`)}
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-2">Signers ({signers.length})</p>
        <div className="space-y-1">
          {signers.map((s, i) => (
            <div key={i} className="text-xs font-mono text-gray-300 bg-gray-800 px-3 py-1.5 rounded-lg truncate">
              {s || <span className="text-gray-600 italic">empty</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export interface VaultTemplateWizardProps {
  onSuccess?: (result: unknown) => void;
  onCancel?: () => void;
}

const STEPS = ["Choose Template", "Configure", "Review & Submit"] as const;

export const VaultTemplateWizard: React.FC<VaultTemplateWizardProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<VaultTemplateV1[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<VaultTemplateV1 | null>(null);
  const [signers, setSigners] = useState<string[]>([""]);
  const [label, setLabel] = useState("");
  const [overrides, setOverrides] = useState<Partial<VaultPresetParamsV1>>({});
  const [validationErrors, setValidationErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<unknown>(null);

  useEffect(() => {
    fetchTemplates()
      .then(setTemplates)
      .catch((e) => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const validate = useCallback((): boolean => {
    if (!selected) return false;
    const merged = { ...selected.preset, ...overrides };
    const { errors } = validatePresetParamsV1(merged);
    const allErrors: Array<{ field: string; message: string }> = [...errors];

    const nonEmptySigners = signers.filter((s) => s.trim().length > 0);
    if (nonEmptySigners.length === 0) {
      allErrors.push({ field: "signers", message: "At least one signer is required." });
    }
    const effectiveThreshold = overrides.threshold ?? selected.preset.threshold;
    if (effectiveThreshold > nonEmptySigners.length) {
      allErrors.push({
        field: "threshold",
        message: `Threshold (${effectiveThreshold}) cannot exceed the number of signers (${nonEmptySigners.length}).`,
      });
    }

    setValidationErrors(allErrors);
    return allErrors.length === 0;
  }, [selected, overrides, signers]);

  const handleNext = () => {
    if (step === 1 && !validate()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setValidationErrors([]);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    if (!selected || !validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await instantiateTemplate({
        templateId: selected.id,
        signers: signers.filter((s) => s.trim().length > 0),
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        label: label || undefined,
      });
      setSubmitSuccess(result);
      onSuccess?.(result);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Instantiation failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (submitSuccess) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle className="w-14 h-14 text-green-400" />
        <h2 className="text-2xl font-bold text-white">Vault instantiated!</h2>
        <p className="text-gray-400 max-w-sm">
          Your vault configuration has been prepared. Sign and broadcast the transaction to go live.
        </p>
        <button
          onClick={() => onSuccess?.(submitSuccess)}
          className="mt-2 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((name, i) => (
          <React.Fragment key={name}>
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  i < step
                    ? "bg-green-500 text-white"
                    : i === step
                    ? "bg-purple-600 text-white"
                    : "bg-gray-700 text-gray-500"
                }`}
              >
                {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={`text-sm font-medium ${
                  i === step ? "text-white" : "text-gray-500"
                }`}
              >
                {name}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[300px]">
        {loading && (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          </div>
        )}

        {fetchError && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {fetchError}
          </div>
        )}

        {!loading && !fetchError && (
          <>
            {step === 0 && (
              <TemplatePicker
                templates={templates}
                selected={selected}
                onSelect={(t) => {
                  setSelected(t);
                  setSigners([""]);
                  setOverrides({});
                }}
              />
            )}
            {step === 1 && selected && (
              <ConfigureStep
                template={selected}
                signers={signers}
                onSignersChange={setSigners}
                label={label}
                onLabelChange={setLabel}
                overrides={overrides}
                onOverridesChange={setOverrides}
                errors={validationErrors}
              />
            )}
            {step === 2 && selected && (
              <ReviewStep
                template={selected}
                signers={signers.filter((s) => s.trim().length > 0)}
                label={label}
                overrides={overrides}
              />
            )}
          </>
        )}
      </div>

      {/* Errors */}
      {validationErrors.length > 0 && (
        <div className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <ul className="space-y-0.5">
            {validationErrors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {submitError && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {submitError}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        {onCancel && step === 0 && (
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
          >
            Cancel
          </button>
        )}
        {step > 0 && (
          <button
            onClick={handleBack}
            className="flex items-center gap-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        )}
        <div className="flex-1" />
        {step < STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            disabled={step === 0 && !selected}
            className="flex items-center gap-1 px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Instantiate Vault
          </button>
        )}
      </div>
    </div>
  );
};

export default VaultTemplateWizard;
