/**
 * Official vault template catalog — Issue #2081
 *
 * These are the three built-in presets: startup, DAO treasury, and grants.
 * They are immutable at runtime; the catalog service wraps them together with
 * any community templates stored in SQLite.
 */

import type { VaultTemplate } from "./vault-template.types.js";
import { TEMPLATE_SCHEMA_VERSION } from "./vault-template.types.js";

const NOW = "2026-01-01T00:00:00Z";

export const OFFICIAL_TEMPLATES: readonly VaultTemplate[] = [
  // ── Startup ──────────────────────────────────────────────────────────────
  {
    id: "startup-v1",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: "Startup Treasury",
    description:
      "Lightweight 2-of-3 multisig for early-stage teams. Low thresholds let " +
      "the founding team move quickly while still requiring consensus.",
    category: "startup",
    icon: "🚀",
    preset: {
      threshold: 2,
      maxSigners: 3,
      spendingLimit: "5000000000",       // 500 XLM per proposal
      dailyLimit: "20000000000",          // 2 000 XLM/day
      weeklyLimit: "100000000000",        // 10 000 XLM/week
      timelockThreshold: "10000000000",   // 1 000 XLM triggers timelock
      timelockDelay: 8640,                // ~12 hours (@ 5 s/ledger)
    },
    features: [
      "2-of-3 multisig",
      "Quick 12-hour timelock",
      "Conservative weekly cap",
      "Ideal for seed-stage companies",
    ],
    isOfficial: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },

  // ── DAO Treasury ─────────────────────────────────────────────────────────
  {
    id: "dao-treasury-v1",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: "DAO Treasury",
    description:
      "High-security 5-of-9 multisig for community-governed treasuries. " +
      "Long timelocks give token-holders time to react to large transfers.",
    category: "dao",
    icon: "🏛️",
    preset: {
      threshold: 5,
      maxSigners: 9,
      spendingLimit: "100000000000",      // 10 000 XLM per proposal
      dailyLimit: "500000000000",          // 50 000 XLM/day
      weeklyLimit: "2000000000000",        // 200 000 XLM/week
      timelockThreshold: "50000000000",    // 5 000 XLM triggers timelock
      timelockDelay: 86400,               // ~5 days (@ 5 s/ledger)
    },
    features: [
      "5-of-9 multisig",
      "5-day timelock on large transfers",
      "High weekly cap for active DAOs",
      "Suitable for community treasuries",
    ],
    isOfficial: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },

  // ── Grants ───────────────────────────────────────────────────────────────
  {
    id: "grants-v1",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: "Grants Program",
    description:
      "3-of-5 multisig optimised for grant disbursements. Moderate limits " +
      "and a 2-day timelock balance operational speed with accountability.",
    category: "grants",
    icon: "🎁",
    preset: {
      threshold: 3,
      maxSigners: 5,
      spendingLimit: "30000000000",       // 3 000 XLM per grant
      dailyLimit: "150000000000",          // 15 000 XLM/day
      weeklyLimit: "500000000000",         // 50 000 XLM/week
      timelockThreshold: "20000000000",    // 2 000 XLM triggers timelock
      timelockDelay: 34560,               // ~2 days (@ 5 s/ledger)
    },
    features: [
      "3-of-5 multisig",
      "2-day timelock for large grants",
      "Per-proposal spending cap",
      "Designed for grant committees",
    ],
    isOfficial: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
] as const;
