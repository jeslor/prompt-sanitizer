# prompt-sanitizer

[![Python >=3.10](https://img.shields.io/badge/python-%E2%89%A53.10-3776AB?logo=python&logoColor=white)](packages/python/)
[![Node >=18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](packages/javascript/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](#license)
[![Tests: 255 passing](https://img.shields.io/badge/tests-255%20passing-brightgreen)](#quality--benchmarks)

Privacy-first PII sanitization for LLM pipelines — **Python and TypeScript/JavaScript from one monorepo**.

`prompt-sanitizer` runs **entirely in-process**: no cloud calls, no telemetry, no outbound dependency on third-party redaction APIs. In FAST mode it stays lean with **zero ML dependencies**. In SMART and FULL modes it adds **fully local NER** for names and organizations via Piiranha mDeBERTa-v3 on Python and Xenova BERT-NER-style models on JavaScript, plus bidirectional deanonymization, synthetic replacements, and audit logging.

---

## Why teams pick prompt-sanitizer

- 🛡️ **Local-only by design** — sanitize prompts before they leave your process
- ⚡ **Sub-millisecond FAST mode** — regex + secrets engine, zero ML deps
- 🧠 **Local NER in SMART/FULL** — Piiranha mDeBERTa-v3 (Python) / Xenova BERT-NER-style transformers (JS)
- 🔁 **Bidirectional vault** — anonymize input, send placeholders to the LLM, restore originals in the response
- 🎭 **Synthetic replacements** — realistic fake names, emails, phones, addresses via Faker instead of blunt `[REDACTED]`
- 🔐 **Secrets coverage built in** — OpenAI, Anthropic, GitHub, AWS, JWT, DB URLs, private keys, and more
- 🧾 **Tamper-evident audit logging** — hashed event records with in-memory and SQLite backends
- 🔌 **Framework integrations** — OpenAI SDK, LangChain, LlamaIndex, FastAPI, Django, Vercel AI SDK, Express, Next.js
- 🔄 **Dual runtime** — same mental model and API shape in Python and TypeScript

---

## Modes

| Mode | What runs | Best for |
|------|-----------|----------|
| **FAST** | Regex + secrets engine | High-throughput prompt filtering, edge workloads, low-latency services |
| **SMART** | FAST + local NER | User-generated input where names, orgs, and context PII matter |
| **FULL** | SMART + synthetic replacement + audit log | Production workflows, compliance, GDPR/HIPAA-sensitive systems |

### What that means in practice

- **FAST** catches structured PII and secrets with no ML model load.
- **SMART** adds local entity recognition for people, organizations, and locations.
- **FULL** is the "ship it" mode: safer replacements, auditability, and reversible vault-based workflows.

---

## Benchmark snapshot

Source: [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md)

| Tool | Regex F1 | Person recall | Latency (medium, FAST) | API key recall |
|------|----------|---------------|------------------------|----------------|
| **prompt-sanitizer FAST** | ~93% | 0% | **0.3 ms** | **100%** |
| **prompt-sanitizer SMART** | ~93% | **~88%** | 3–4 ms | **100%** |
| Presidio | ~82% | ~80% | 15 ms | 0% |
| LLM Guard | ~82% | ~85% | 150–500 ms | 0% |
| OpenRedaction (JS) | ~78% | 0% | 0.5 ms | 60% |

### Key takeaways

- **FAST mode** is built for throughput: pure in-process detection, no model downloads, sub-ms median latency.
- **SMART mode** closes the NER gap without giving up local execution.
- **Secrets detection is not bolted on** — API keys and tokens are first-class detection targets, not an afterthought.
- **No competing tool in the benchmark combines** dual runtime + local NER + bidirectional vault + synthetic replacement + audit log.

> Benchmark numbers are warmup-excluded and environment-dependent. Re-run locally for your hardware and workload.

---

## Installation

### Python

```bash
pip install ai-prompt-sanitizer              # FAST mode — zero ML deps
pip install 'ai-prompt-sanitizer[nlp]'       # + local NER for SMART/FULL
pip install 'ai-prompt-sanitizer[synthetic]' # + realistic fake replacements
pip install 'ai-prompt-sanitizer[all]'       # everything
```

### JavaScript / TypeScript

```bash
npm install prompt-sanitizer

# optional: NER support for SMART/FULL
npm install @huggingface/transformers

# optional: synthetic replacement
npm install @faker-js/faker
```

### Runtime requirements

- **Python:** `>=3.10`
- **Node.js:** `>=18`

---

## Quick start — Python

```python
from prompt_sanitizer import Mode, Sanitizer, SQLiteAuditLog

# 1) One-shot sanitize
s = Sanitizer()  # Mode.FAST by default
result = s.sanitize("Hi, I'm Alice. Email me at alice@example.com")
print(result.text)      # redacted / replaced text
print(result.entities)  # list[DetectedEntity]
print(result.tokens)    # original -> placeholder mapping

# 2) Bidirectional session (anonymize -> LLM -> deanonymize)
session = s.session()
clean = session.anonymize("Call Alice at (415) 867-5309")
reply = call_llm(clean)             # model sees placeholders, not raw PII
final = session.deanonymize(reply)  # restore originals in the model output

# 3) Guard a call site
@s.guard(on_detect="redact")
def call_openai(prompt: str) -> str:
    return prompt

# 4) SMART mode with local NER
smart = Sanitizer(mode=Mode.SMART)
result = smart.sanitize("My name is Dr. John Smith")
print([(e.entity_type, e.value) for e in result.entities])

# 5) FULL mode with persistent audit log
audit = SQLiteAuditLog("./prompt-sanitizer-audit.db")
full = Sanitizer(mode=Mode.FULL, audit_log=audit)
full.sanitize("Contact alice@example.com about claim 123-45-6789")
print(audit.export(format="json", since="1d"))
```

### Common Python integrations

- **OpenAI SDK wrapper** — sanitize `messages` before send, deanonymize responses after receive
- **LangChain** — runnable + LLM wrappers
- **LlamaIndex** — node/postprocessor integration
- **FastAPI / Starlette** — request middleware for chat endpoints
- **Django** — middleware for inbound/outbound application flows

Example import paths:

```python
from prompt_sanitizer.integrations.openai import wrap
from prompt_sanitizer.integrations.langchain import PromptSanitizerRunnable, SanitizedLLM
from prompt_sanitizer.integrations.fastapi import SanitizerMiddleware
from prompt_sanitizer.integrations.django import SanitizerMiddleware
from prompt_sanitizer.integrations.llamaindex import PromptSanitizerPostprocessor
```

---

## Quick start — JavaScript / TypeScript

```ts
import { Mode, Sanitizer, AuditLog } from "prompt-sanitizer";

// 1) One-shot sanitize
const s = new Sanitizer();
const result = await s.sanitize("Hi, I'm Alice. Email alice@example.com");
console.log(result.text);     // redacted / replaced text
console.log(result.entities); // DetectedEntity[]
console.log(result.tokens);   // original -> placeholder mapping

// 2) Bidirectional session
const session = s.session();
const clean = await session.anonymize("Call Alice at (415) 867-5309");
const reply = await callLLM(clean);
const final = session.deanonymize(reply);

// 3) Guard a function
const safeCall = s.guard(async (prompt: string) => {
  return prompt;
});

// 4) SMART mode with local NER
const smart = new Sanitizer({ mode: Mode.SMART });
const smartResult = await smart.sanitize("My name is Dr. John Smith");
console.log(smartResult.entities);

// 5) FULL mode with audit log
const audit = new AuditLog();
const full = new Sanitizer({ mode: Mode.FULL, auditLog: audit });
await full.sanitize("Email alice@example.com and JWT eyJhbGciOi...");
console.log(audit.events());
```

### Common JS/TS integrations

- **Vercel AI SDK** — wrap `generateText` and `streamText`
- **Express / Hono** — sanitize request bodies, restore placeholders in responses
- **Next.js** — middleware helpers for server-side flows
- **LangChain.js** — sanitized wrappers for LLMs and chains
- **LlamaIndex.TS** — post-process nodes before they hit your model stack

Example import paths:

```ts
import { createExpressMiddleware, createHonoMiddleware } from "prompt-sanitizer/integrations/express";
import { createNextjsMiddleware } from "prompt-sanitizer/integrations/nextjs";
import { wrapGenerate, wrapStream } from "prompt-sanitizer/integrations/vercel-ai";
import { SanitizedLLM } from "prompt-sanitizer/integrations/langchain";
import { PromptSanitizerNodePostprocessor } from "prompt-sanitizer/integrations/llamaindex";
```

### Express example

```ts
import express from "express";
import { Sanitizer, Mode } from "prompt-sanitizer";
import { createExpressMiddleware } from "prompt-sanitizer/integrations/express";

const app = express();
app.use(express.json());
app.use(createExpressMiddleware(new Sanitizer({ mode: Mode.SMART })));
```

### Vercel AI SDK example

```ts
import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { Sanitizer } from "prompt-sanitizer";
import { wrapGenerate, wrapStream } from "prompt-sanitizer/integrations/vercel-ai";

const sanitizer = new Sanitizer();
const safeGenerateText = wrapGenerate(sanitizer, generateText);
const safeStreamText = wrapStream(sanitizer, streamText);

const { text } = await safeGenerateText({
  model: openai("gpt-4o"),
  prompt: "My email is alice@example.com. Summarize this request.",
});

const result = await safeStreamText({
  model: openai("gpt-4o"),
  prompt: "Call Alice at 415-867-5309 tomorrow.",
});
```

---

## How the bidirectional vault works

The core workflow is simple:

1. **Detect** PII and secrets in the prompt
2. **Replace** values with placeholders or realistic synthetic values
3. **Store** the mapping in a session vault
4. **Send** only sanitized text to the model
5. **Restore** originals in the model output when needed

That gives you a cleaner trust boundary:

- your LLM provider never sees the original secret or identifier
- your app keeps the context needed to restore useful output
- multi-turn flows can preserve consistent replacements across a session

Example:

```text
Input:        "Email Alice at alice@example.com"
Anonymized:   "Email [PERSON_1] at [EMAIL_1]"
LLM output:   "I've drafted a reply to [PERSON_1] at [EMAIL_1]"
Deanonymized: "I've drafted a reply to Alice at alice@example.com"
```

---

## Supported PII types

The project intentionally covers both **structured identifiers** and **secrets** that should never reach an LLM. The table below uses the project-level docs names, with notes where current Python/JS enum names differ slightly in `v0.1.0`.

| Docs name | Python runtime | JS runtime | Notes |
|-----------|----------------|------------|-------|
| `EMAIL` | `EMAIL` | `EMAIL` | Email addresses |
| `PHONE` | `PHONE` | `PHONE` | Local + international patterns |
| `SSN` | `SSN` | `SSN` | US SSN formats |
| `CREDIT_CARD` | `CREDIT_CARD` | `CREDIT_CARD` | Major card formats with validation |
| `IBAN` | `IBAN` | `IBAN` | International bank account numbers |
| `IP_ADDRESS` | `IP_ADDRESS` | `IP_ADDRESS` | IPv4 + IPv6 |
| `URL` | `URL` | `URL` | URLs and common link patterns |
| `API_KEY` | `API_KEY` | `API_KEY` | Generic and provider-specific API keys |
| `JWT_TOKEN` / `JWT` | `JWT` | `JWT_TOKEN` | JSON Web Tokens |
| `PERSON_NAME` | `PERSON` | `PERSON_NAME` | NER-backed in SMART/FULL |
| `ORGANIZATION` | via NER | `ORGANIZATION` | NER-backed in SMART/FULL |
| `LOCATION` | via NER / address classes | `LOCATION` | NER-backed in SMART/FULL |
| `DATE` | `DATE` | date-like entities | Temporal values |
| `CUSTOM` | `CUSTOM` | `CUSTOM` | User-defined regex/entity hooks |
| `SECRET_KEY` | generic secret assignments | `SECRET_KEY` | `.env`-style secrets, config values |
| `AWS_KEY` | `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` | `AWS_KEY` | Access key IDs and secret keys |
| `GITHUB_TOKEN` | normalized under `API_KEY` | `OAUTH_TOKEN` | `ghp_`, `github_pat_`, related families |
| `OPENAI_KEY` | normalized under `API_KEY` | normalized under `API_KEY` | `sk-...` families |
| `ANTHROPIC_KEY` | normalized under `API_KEY` | normalized under `API_KEY` | `sk-ant-...` families |

### Also covered in the current runtime implementations

Depending on runtime, the sanitizer also exposes or detects additional entity classes such as:

- **Python:** `ADDRESS`, `ZIP_CODE`, `DATE_OF_BIRTH`, `AGE`, `BANK_ACCOUNT`, `CRYPTO_ADDRESS`, `PASSPORT`, `DRIVING_LICENSE`, `MAC_ADDRESS`, `BEARER_TOKEN`, `PRIVATE_KEY`, `DB_CONNECTION`
- **JavaScript:** `MAC_ADDRESS`, `CRYPTO_ADDRESS`, `DATE_OF_BIRTH`, `PASSPORT`, `DRIVING_LICENSE`, `AGE`, `GENDER`, `NATIONALITY`, `RELIGION`, `PASSWORD`, `PRIVATE_KEY`, `DATABASE_URL`, `OAUTH_TOKEN`

If your workload has custom identifiers — employee IDs, claim numbers, ticket numbers, tenant keys — add them with custom patterns and keep them in the same sanitize/deanonymize pipeline.

---

## What makes this different from a basic redactor?

A lot of redaction libraries stop at “find a regex, replace with `[REDACTED]`”. That is useful, but incomplete for modern LLM systems.

`prompt-sanitizer` is designed around real application flows:

- **Prompt safety** — sanitize before data leaves your process
- **Model utility** — preserve semantics with realistic synthetic replacements when needed
- **Response restoration** — deanonymize after inference so downstream UX stays natural
- **Operational visibility** — export hashed audit events without storing raw PII
- **Cross-runtime consistency** — keep the same patterns in Python backends and JS frontends/edge services

---

## Quality & benchmarks

This repo includes both correctness tests and reproducible benchmarks.

### Test status

- **Python:** `118 passed`
- **JavaScript / TypeScript:** `137 passed`
- **Total:** `255 passed`

### Benchmark assets

- [`benchmarks/corpus/`](benchmarks/corpus/) — 47 labeled PII samples
- [`benchmarks/python/`](benchmarks/python/) — Python accuracy + latency runners
- [`benchmarks/javascript/`](benchmarks/javascript/) — JS accuracy + latency runners
- [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) — published results

### Benchmark methodology highlights

- value-overlap matching instead of brittle exact-span scoring
- warmup excluded for steady-state latency
- regex-only tools expected to score `0%` on names without NER
- competitor tools benchmarked against the same corpus

Run them yourself:

```bash
# Python benchmarks
cd benchmarks/python
pip install -r requirements.txt
python run_accuracy.py
python run_latency.py

# JavaScript benchmarks
cd ../javascript
npm install
node run_accuracy.mjs
node run_latency.mjs
```

---

## Repository structure

```text
prompt-sanitizer/
├── packages/
│   ├── python/           # Python package (prompt-sanitizer on PyPI)
│   └── javascript/       # npm package (prompt-sanitizer on npm)
├── benchmarks/           # accuracy + latency benchmarks vs Presidio, LLM Guard, OpenRedaction
│   ├── corpus/           # 47 labeled PII samples
│   ├── python/
│   └── javascript/
└── docs/                 # additional docs
```

---

## When to use which mode

### Choose FAST if you need:

- maximum throughput
- zero ML dependencies
- secret/API key filtering on every request
- edge/serverless-friendly behavior

### Choose SMART if you need:

- person / org / location detection
- local NER without cloud APIs
- better coverage on free-form user input

### Choose FULL if you need:

- realistic fake replacements instead of placeholders
- audit export for review/compliance
- reversible multi-turn LLM sessions with safer defaults

---

## FAQ

### Why not just use Presidio?

Presidio is a strong project and a good fit for **Python-only** stacks that want a mature analyzer/anonymizer framework. The trade-offs are practical:

- it does **not** ship with the same built-in API key / secret coverage used here
- it does **not** provide the same bidirectional session vault workflow out of the box
- it is **Python-centric**, while prompt-sanitizer ships a matching JS/TS runtime
- its steady-state latency in the included benchmark is materially higher than FAST mode

If you already use Presidio for broader DLP workflows, prompt-sanitizer can still complement it as a fast prompt-boundary sanitizer.

### Why not just use LLM Guard?

LLM Guard is useful when you want a broader LLM policy/security layer, especially in Python. But for prompt sanitization specifically:

- it is far slower in the benchmarked setup
- secrets/API keys are not a first-class strength in the published results here
- it does not focus on reversible vault-based anonymize/deanonymize sessions
- it is not designed around a dual-runtime Python + JS developer experience

Use LLM Guard when you need its guardrail surface area. Use prompt-sanitizer when you need **fast, local, reversible PII sanitization**.

### Is FAST mode enough for production?

Often, yes — especially if your primary concern is structured PII and secrets. But FAST will not magically detect personal names in free text. If names, organizations, or locations matter, use **SMART** or **FULL**.

### Does FULL mode send anything to a third party?

No. FULL mode still runs locally. It adds local NER, synthetic replacement, and audit logging — not cloud processing.

### Does the audit log store raw PII?

No. The audit log stores **hashed event data**, not the original values. Python ships both `MemoryAuditLog` and `SQLiteAuditLog`; JS ships an in-memory `AuditLog`.

### Is this a full DLP or compliance platform?

No. It is a focused sanitizer for **LLM application boundaries**. You may still want upstream storage controls, retention policies, encryption, and provider-side data governance.

### Can I add my own entity types?

Yes. Both runtimes support custom patterns so internal identifiers can go through the same sanitize/deanonymize/audit pipeline.

---

## Design goals

- **Be fast in the default path**
- **Stay local and predictable**
- **Handle secrets as seriously as PII**
- **Preserve developer ergonomics**
- **Make Python and JS feel like the same tool**

If that matches your stack, this repo is built for you.

---

## License

MIT
