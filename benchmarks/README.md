# Benchmarks

Structured accuracy and latency benchmarks comparing **prompt-sanitizer** against:

| Tool | Runtime | Approach |
|------|---------|----------|
| [Presidio](https://github.com/microsoft/presidio) | Python | spaCy NER + regex |
| [LLM Guard](https://github.com/protectai/llm-guard) | Python | DeBERTa ML models |
| [OpenRedaction](https://github.com/openredaction/openredaction) | JavaScript | regex only |

---

## Directory layout

```
benchmarks/
├── corpus/
│   └── pii_samples.json     ← 47 labeled samples across 9 PII categories
├── python/
│   ├── run_accuracy.py      ← accuracy: precision / recall / F1 per category
│   ├── run_latency.py       ← latency: median / p95 / p99 / rps per mode + text size
│   └── requirements.txt     ← pip deps for competitor tools
├── javascript/
│   ├── run_accuracy.mjs     ← accuracy: same corpus, JS runtime
│   ├── run_latency.mjs      ← latency: FAST / SMART vs OpenRedaction
│   └── package.json
└── RESULTS.md               ← published results (filled after running)
```

---

## Running Python benchmarks

```bash
cd benchmarks/python

# install benchmark-only deps (prompt-sanitizer itself uses its own venv)
pip install -r requirements.txt

# accuracy (all tools)
python run_accuracy.py

# accuracy (skip tools you haven't installed)
python run_accuracy.py --skip-presidio
python run_accuracy.py --skip-llmguard

# latency
python run_latency.py
```

> **Note:** Presidio's first call takes 1–3 s for spaCy model load. LLM Guard's first
> call takes 5–30 s for DeBERTa download. These one-time costs are excluded from the
> latency numbers (warmup iterations are run first).

---

## Running JavaScript benchmarks

```bash
cd benchmarks/javascript
npm install          # installs openredaction

# accuracy
node run_accuracy.mjs

# latency
node run_latency.mjs
```

> The JS benchmarks import prompt-sanitizer directly from
> `packages/javascript/dist/` (built) or `packages/javascript/src/` (via tsx).
> Run `npm run build` in `packages/javascript/` first.

---

## Corpus

`corpus/pii_samples.json` — 47 labeled samples:

| Category | Count | Notes |
|----------|------:|-------|
| email | 5 | plain, display-name, subdomain |
| phone | 5 | US local, US intl, UK, French |
| ssn | 5 | US SSN variants |
| credit_card | 5 | Visa, Mastercard, Amex, Discover |
| iban | 3 | GB, DE, FR |
| ip_address | 4 | IPv4 private, public, IPv6 |
| url | 3 | http, https, bare domain |
| api_key | 4 | OpenAI, GitHub, generic, AWS |
| person | 5 | full names (NER required) |
| multi | 3 | multiple PII types in one sentence |
| clean | 5 | no PII — tests false-positive rate |

### Entity schema

```json
{
  "id": "email-001",
  "category": "email",
  "text": "Contact alice@example.com for details.",
  "entities": [
    { "type": "EMAIL", "value": "alice@example.com" }
  ]
}
```

---

## Methodology

- **Matching:** value-overlap — a detection is a TP if the detected value contains
  or is contained by the expected value (case-insensitive). Exact span match is not
  required since tools tokenise differently.
- **PERSON / multi category:** regex-only tools (OpenRedaction, prompt-sanitizer FAST)
  are expected to score 0% recall here. This illustrates the NER gap that
  `Mode.SMART` fills.
- **LLM Guard** does not return entity values — TP is inferred from whether the
  expected value is absent in the sanitized output.
- **Latency:** median / p95 / p99 over 300–500 warmup-excluded iterations.
  Competitor first-call load times are excluded.

---

## Key expected findings

| Tool | Regex F1 | Person recall | Latency (medium, median) |
|------|----------|---------------|--------------------------|
| prompt-sanitizer FAST | ~95% | 0% | < 1 ms |
| prompt-sanitizer SMART | ~95% | ~85% | 30–120 ms (first call only) |
| Presidio | ~88% | ~80% | 5–15 ms |
| LLM Guard | ~82% | ~90% | 150–500 ms |
| OpenRedaction | ~78% | 0% | < 0.5 ms |

> Actual numbers will vary by environment. Run the benchmarks to get your local results.
