# Vault Templates — Policy-as-Code (Issue #2081)

Vault templates let teams instantiate reusable treasuries from validated presets
instead of configuring every parameter from scratch.  Three official presets ship
with VaultDAO: **Startup**, **DAO Treasury**, and **Grants Program**.  Community
templates can be added through the admin API.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Schema versioning & migration](#schema-versioning--migration)
3. [Official presets](#official-presets)
4. [Server-side validation rules](#server-side-validation-rules)
5. [Instantiating a vault from a template](#instantiating-a-vault-from-a-template)
6. [Backend catalog API](#backend-catalog-api)
7. [Adding a community template](#adding-a-community-template)
8. [Running the tests](#running-the-tests)

---

## Architecture overview

```
frontend/src/utils/vaultTemplateSchema.ts   ← client-side schema & validation
frontend/src/components/VaultTemplateWizard.tsx ← step-by-step wizard UI

backend/src/modules/vault/
  vault-template.types.ts       ← shared type definitions
  vault-template.catalog.ts     ← official (immutable) preset catalog
  vault-template.validator.ts   ← server-side preset validation
  vault-template.service.ts     ← catalog CRUD + instantiation logic
  vault-template.controller.ts  ← HTTP controllers
  vault-template.service.test.ts← unit tests for all official presets
```

The service is mounted under the existing `/api/v1/vault` router, so no new
top-level route registration is needed.

---

## Schema versioning & migration

Every template carries a `schemaVersion` field (currently `1`).  The frontend
`migrateTemplate()` utility handles upgrades; the backend `TEMPLATE_SCHEMA_VERSION`
constant is the authoritative source.

### How to introduce a schema v2

1. Add the new field(s) to `VaultTemplate` in `vault-template.types.ts`.
2. Bump `TEMPLATE_SCHEMA_VERSION` to `2`.
3. Write a `migrateV1toV2(t: VaultTemplateV1): VaultTemplateV2` function.
4. Add a `case 1:` branch in `migrateTemplate()` in `vaultTemplateSchema.ts`.
5. Update the `AnyVaultTemplate` union type.
6. Write a migration test in `vaultTemplateSchema.test.ts`.

Existing community templates stored without a `schemaVersion` field are treated
as v1 by both the frontend migration guard and the server validator.

---

## Official presets

| Template id        | Category | Threshold | Max signers | Spending cap |
|--------------------|----------|-----------|-------------|--------------|
| `startup-v1`       | startup  | 2         | 3           | 500 XLM      |
| `dao-treasury-v1`  | dao      | 5         | 9           | 10 000 XLM   |
| `grants-v1`        | grants   | 3         | 5           | 3 000 XLM    |

All stroop values are stored as strings to avoid JavaScript integer precision
loss. Multiply by `10_000_000` to convert to XLM.

Official templates are **immutable at runtime** — they live in
`vault-template.catalog.ts` and cannot be overwritten via the API.

---

## Server-side validation rules

Enforced in `vault-template.validator.ts` (and mirrored client-side):

| Rule | Detail |
|------|--------|
| `threshold ≥ 1` | Must be a positive integer |
| `threshold ≤ maxSigners` | Preset structural check |
| `threshold ≤ signers.length` | Instantiation-time check |
| `spendingLimit ≤ dailyLimit` | Prevents impossible daily caps |
| `dailyLimit ≤ weeklyLimit` | Prevents impossible weekly caps |
| Stroop fields > 0 | All amount fields must be positive integer strings |
| `timelockDelay ≥ 0` | Non-negative ledger count |

Invalid presets are **rejected pre-deploy** with a `422 Unprocessable Entity`
and a structured `errors` array identifying each failing field.

---

## Instantiating a vault from a template

### Via the wizard UI

Navigate to **Dashboard → Templates → Vault Templates**, pick a preset, fill in
signers, optionally adjust the threshold or timelock delay, review, and click
**Instantiate Vault**.  The wizard validates client-side before submitting.

### Via the API

```http
POST /api/v1/vault/templates/dao-treasury-v1/instantiate
Content-Type: application/json

{
  "templateId": "dao-treasury-v1",
  "signers": ["GABC…", "GDEF…", "GHIJ…", "GKLM…", "GNOP…"],
  "overrides": {
    "timelockDelay": 60000
  },
  "label": "Marketing DAO Treasury"
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "templateId": "dao-treasury-v1",
    "resolvedConfig": {
      "signers": ["GABC…", "GDEF…", "GHIJ…", "GKLM…", "GNOP…"],
      "threshold": 5,
      "spendingLimit": "100000000000",
      "dailyLimit": "500000000000",
      "weeklyLimit": "2000000000000",
      "timelockThreshold": "50000000000",
      "timelockDelay": 60000
    },
    "eventLink": null,
    "instantiatedAt": "2026-05-01T14:00:00.000Z"
  }
}
```

`eventLink` is `null` until you broadcast the transaction and patch it via
your own bookkeeping. The `resolvedConfig` is the final merged config after
applying any overrides.

**Error `422` (invalid preset):**

```json
{
  "success": false,
  "error": {
    "message": "Instantiation validation failed",
    "code": "VALIDATION_ERROR",
    "details": [
      { "field": "threshold", "message": "threshold (6) cannot exceed the number of signers (5)" }
    ]
  }
}
```

---

## Backend catalog API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/vault/templates` | API key | List all active templates |
| `GET` | `/api/v1/vault/templates/:id` | API key | Get one template |
| `POST` | `/api/v1/vault/templates` | Admin | Create a community template |
| `POST` | `/api/v1/vault/templates/:id/instantiate` | API key | Instantiate a vault |
| `DELETE` | `/api/v1/vault/templates/:id` | Admin | Deactivate a community template |

Query params for `GET /templates`:
- `?category=dao` — filter by category
- `?officialOnly=true` — return only the built-in presets

---

## Adding a community template

Community templates are stored in memory by default (or in SQLite when you
inject a persistent `TemplateStore`).  To add one:

```http
POST /api/v1/vault/templates
X-API-Key: <admin-key>
Content-Type: application/json

{
  "id": "my-community-template",
  "name": "My Custom Treasury",
  "description": "Tailored for our working group.",
  "category": "custom",
  "icon": "🔧",
  "preset": {
    "threshold": 3,
    "maxSigners": 5,
    "spendingLimit": "15000000000",
    "dailyLimit": "50000000000",
    "weeklyLimit": "200000000000",
    "timelockThreshold": "10000000000",
    "timelockDelay": 17280
  },
  "features": [
    "3-of-5 multisig",
    "Customised for working group"
  ]
}
```

**Rules for community templates:**
- `id` must not clash with any official template id.
- Preset parameters are validated with the same rules as official presets.
- Official templates cannot be deactivated via the API.
- Inactive templates are hidden from the wizard and the list endpoint.

---

## Running the tests

**Backend** (Node test runner):

```bash
cd backend
node --import tsx --test src/modules/vault/vault-template.service.test.ts
```

**Frontend** (Vitest):

```bash
cd frontend
npx vitest run src/utils/vaultTemplateSchema.test.ts
```

All three official presets have dedicated instantiation tests covering both
the happy path and common error conditions (empty signers, threshold overflow,
limit ordering violations).
