# BytePlus ModelArk availability check — 2026-07-26

No credential value is recorded in this file.

## Provider/API verification

- Provider: BytePlus ModelArk (global / Asia-Pacific region)
- Catalog endpoint: authenticated successfully
- China-region endpoint: rejected the credential, confirming the account belongs to the global region
- Real inference probes: every tested chat model returned HTTP 403 `AccountOverdueError`

Conclusion: the account can list the catalog, but **none of the visible free quotas can currently be used for inference until the billing/account-overdue state is resolved**.

## Quotas visible in the supplied screenshots

Values below are transcribed exactly from the panel column labelled “Free inference quota”. The panel does not make the consumed-versus-remaining semantics unambiguous in the screenshots, so they are recorded as `displayed / total`, not reinterpreted.

| Model shown | Panel activation | Displayed quota |
|---|---:|---:|
| Dola-Seed-2.1-turbo | Not activated | 500,000 / 500,000 |
| GLM-5.2 | Not activated | 500,000 / 500,000 |
| Dola-Seed-2.0-mini | Activated | 500,000 / 500,000 |
| Dola-Seed-2.0-lite | Activated | 500,000 / 500,000 |
| DeepSeek-V4-flash | Activated | 500,000 / 500,000 |
| DeepSeek-V4-pro | Activated | 500,000 / 500,000 |
| Dola-Seed-2.0-Code | Activated | 500,000 / 500,000 |
| Dola-Seed-2.0-pro | Activated | 500,000 / 500,000 |
| GLM-4.7 | Activated | 500,000 / 500,000 |
| ByteDance-Seed-1.8 | Activated | 500,000 / 500,000 |
| DeepSeek-V3.2 | Activated | 255,119 / 500,000 |
| ByteDance-Seed-Translation | Activated | 500,000 / 500,000 |
| DeepSeek-V3.1 | Activated | 500,000 / 500,000 |
| GPT-OSS-120B | Activated | 429,406 / 500,000 |
| Kimi-K2 | Activated | 500,000 / 500,000 |
| ByteDance-Seed-1.6 | Activated | 0 / 500,000 |
| ByteDance-Seed-1.6-flash | Activated | 499,891 / 500,000 |
| Skylark-vision | Activated | 500,000 / 500,000 |
| Skylark-lite | Activated | 500,000 / 500,000 |
| Skylark-pro | Activated | 500,000 / 500,000 |
| DeepSeek-V3 | Activated | 500,000 / 500,000 |
| DeepSeek-R1 | Activated | 500,000 / 500,000 |
| DeepSeek-R1-Distill-Qwen-32b | Activated | 500,000 / 500,000 |

## Live catalog status and selected terminal chain

Configured order:

1. `deepseek-v4-pro-260425` — Active; strongest activated general/reasoning option shown
2. `deepseek-v4-flash-260425` — Active; low-latency fallback
3. `seed-2-0-pro-260328` — Active; strong general fallback
4. `glm-4-7-251222` — Active
5. `deepseek-v3-2-251201` — Active
6. `gpt-oss-120b-250805` — Active
7. `seed-2-0-lite-260428` — Active; supports JSON object/schema and is the final structured-output fallback

Models intentionally excluded:

- `glm-5-2-260617`: active in the public catalog but shown as **Not activated** for the account.
- Kimi-K2, DeepSeek-V3, DeepSeek-R1 and R1-Distill: current API catalog marks the listed versions **Shutdown**.
- DeepSeek-V3.1: catalog marks it **Retiring**.
- Translation, vision and code-specialized models: not a fit for the ATLAS transactional terminal.
- Seed 1.6: screenshot shows zero displayed quota; superseded by Seed 2.0 variants.

Fallback is attempted only for retryable model/capacity/rate-limit errors. HTTP 401/403, authentication failures and account-overdue errors stop immediately to avoid seven wasted requests.
