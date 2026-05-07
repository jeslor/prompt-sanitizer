# prompt-sanitizer

PII and secret sanitization for Python LLM pipelines.

`prompt-sanitizer` provides a typed API for detecting, redacting, anonymizing, and restoring sensitive values before they reach a model, tool, middleware layer, log sink, or SDK wrapper. FAST mode has zero required dependencies. SMART and FULL add optional NLP, synthetic replacement, and audit logging.

## Install

Python 3.10+.

```bash
pip install prompt-sanitizer
pip install "prompt-sanitizer[nlp]"
pip install "prompt-sanitizer[synthetic]"
pip install "prompt-sanitizer[integrations]"
pip install "prompt-sanitizer[all]"
```

### Optional extras

| Extra | Adds | Typical use |
| --- | --- | --- |
| `nlp` | `transformers` + `torch` | NER in SMART/FULL mode |
| `synthetic` | `faker` | realistic fake replacements |
| `integrations` | framework / SDK adapters | LangChain, LlamaIndex, OpenAI, FastAPI, Django |
| `all` | all extras | full feature set |

## Quick start

```python
from prompt_sanitizer import Sanitizer, Mode

s = Sanitizer(mode=Mode.FAST)
result = s.sanitize("Contact Jane Doe at jane@example.com or 415-555-0112.")

print(result.text)
print(result.has_pii)
print(result.risk_score)
print(result.tokens)
for entity in result.entities:
    print(entity.entity_type, entity.value, entity.replacement)
```

## Modes

| Mode | Pipeline | Dependencies | Notes |
| --- | --- | --- | --- |
| `Mode.FAST` | regex + secret detectors | none | sub-ms, stdlib only |
| `Mode.SMART` | FAST + Piiranha NER | `prompt-sanitizer[nlp]` | lazy-loads on first call |
| `Mode.FULL` | SMART + synthetic replacement + audit log | usually `nlp` + `synthetic` | best for compliance-oriented flows |

### FAST mode

```python
from prompt_sanitizer import Sanitizer, Mode

s = Sanitizer(mode=Mode.FAST)
text = "SSN 078-05-1120, card 4111 1111 1111 1111, token sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"
result = s.sanitize(text)

print(result.text)
print(result.entities)
print(result.tokens)
```

Use FAST for prompt pre-processing, log scrubbing, middleware guards, CI checks, and zero-dependency CLI tooling.

### SMART mode

```python
from prompt_sanitizer import Sanitizer, Mode

s = Sanitizer(mode=Mode.SMART)
result = s.sanitize(
    "Alice from Acme Corp met us in Berlin on 2025-02-14. Email alice@acme.example."
)

print(result.text)
for entity in result.entities:
    print(entity.entity_type, entity.value, entity.confidence)
```

Use SMART when prompts contain free-form prose with names, organizations, dates, or locations that regexes alone may miss.

### FULL mode

```python
from prompt_sanitizer import Sanitizer, Mode, SQLiteAuditLog

audit = SQLiteAuditLog("prompt_sanitizer_audit.db")
s = Sanitizer(mode=Mode.FULL, locale="en_US", on_detect="redact", audit_log=audit)

result = s.sanitize("Customer Jane Doe uses jane@example.com and 415-555-0112.")
print(result.text)
print(result.tokens)
print(s.audit.export(format="json"))
```

Use FULL when you want synthetic replacement plus an audit trail.

## Public API

### `Sanitizer`

```python
Sanitizer(
    mode: Mode = Mode.FAST,
    locale: str = "en_US",
    entities: list[EntityType] | None = None,
    on_detect: str = "redact",
    audit_log: BaseAuditLog | None = None,
)
```

#### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `mode` | `Mode` | detection pipeline |
| `locale` | `str` | locale for synthetic replacement generation |
| `entities` | `list[EntityType] \| None` | optional allowlist of entity types |
| `on_detect` | `str` | `"redact"`, `"warn"`, or `"block"` |
| `audit_log` | `BaseAuditLog \| None` | optional audit backend |

#### Methods

| Method | Signature | Description |
| --- | --- | --- |
| `sanitize` | `sanitize(text: str, session_id: str | None = None) -> SanitizeResult` | sanitize one string |
| `sanitize_batch` | `sanitize_batch(texts: list[str]) -> list[SanitizeResult]` | sanitize multiple inputs |
| `session` | `session(session_id: str | None = None) -> Session` | create a reusable anonymization session |
| `add_entity` | `add_entity(name: str, pattern: str, confidence: float = 0.85) -> None` | register a custom entity |
| `stream` | `stream(source: AsyncIterable, session: Session | None) -> AsyncGenerator[str, None]` | restore streamed chunks |
| `guard` | `guard(on_detect: str) -> decorator` | decorate a function with sanitization logic |
| `audit` | `.audit -> BaseAuditLog | None` | access the configured audit log |

### `sanitize()`

```python
result = s.sanitize("Reach me at dev@example.com", session_id="req-001")
print(result.text)
```

### `sanitize_batch()`

```python
results = s.sanitize_batch([
    "Email a@example.com",
    "No sensitive data here",
    "Call +1 415 555 0112",
])
```

### `session()`

Use sessions for reversible anonymization across multiple turns.

```python
session = s.session(session_id="chat-42")
clean = session.anonymize("My email is ops@example.com")
restored = session.deanonymize("Reply to [EMAIL_1]")
```

### `add_entity()`

```python
s.add_entity(name="customer_id", pattern=r"\bCUS-\d{8}\b", confidence=0.92)
s.add_entity(name="ticket_ref", pattern=r"\bINC-[A-Z0-9]{10}\b", confidence=0.88)
```

### `stream()`

```python
import asyncio
from prompt_sanitizer import Sanitizer

s = Sanitizer()
session = s.session()
clean = session.anonymize("Email me at ops@example.com")

async def source():
    for part in clean.split():
        yield part + " "
        await asyncio.sleep(0)

async def main() -> None:
    async for chunk in s.stream(source(), session=session):
        print(chunk, end="")

asyncio.run(main())
```

### `guard()`

```python
from prompt_sanitizer import Sanitizer

s = Sanitizer()

@s.guard(on_detect="redact")
def call_model(prompt: str) -> str:
    return f"sent: {prompt}"

print(call_model("Customer email is hello@example.com"))
```

`guard()` works for sync and async functions. Use `on_detect="block"` when the wrapped function must never receive sensitive input.

## Detection policy

### `on_detect="redact"`

```python
s = Sanitizer(on_detect="redact")
print(s.sanitize("My email is user@example.com").text)
```

### `on_detect="warn"`

```python
s = Sanitizer(on_detect="warn")
result = s.sanitize("My IP is 10.0.0.42")
print(result.text)
print(result.entities)
```

### `on_detect="block"`

```python
from prompt_sanitizer import Sanitizer
from prompt_sanitizer.exceptions import PIIDetectedError

s = Sanitizer(on_detect="block")
try:
    s.sanitize("Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
except PIIDetectedError as exc:
    print(exc)
```

## `Mode`

| Enum value | Meaning |
| --- | --- |
| `Mode.FAST` | regex + secrets, zero deps, sub-ms |
| `Mode.SMART` | FAST + Piiranha NER, lazy loads on first call |
| `Mode.FULL` | SMART + synthetic replacement + audit log |

## `SanitizeResult`

| Attribute | Type | Description |
| --- | --- | --- |
| `text` | `str` | sanitized text |
| `entities` | `list[DetectedEntity]` | detected spans |
| `tokens` | `dict[str, str]` | `{original_value: replacement}` map |
| `risk_score` | `float` | composite score from `0.0` to `1.0` |
| `has_pii` | `bool` | whether sensitive data was found |

```python
result = s.sanitize("Contact me at sam@example.com")
assert result.has_pii is True
assert isinstance(result.tokens, dict)
assert 0.0 <= result.risk_score <= 1.0
```

## `DetectedEntity`

| Attribute | Type | Description |
| --- | --- | --- |
| `entity_type` | `EntityType` | entity classification |
| `value` | `str` | original matched value |
| `start` | `int` | inclusive start offset |
| `end` | `int` | exclusive end offset |
| `confidence` | `float` | detection confidence |
| `replacement` | `str \| None` | replacement value, if generated |

```python
for entity in result.entities:
    print(entity.entity_type)
    print(entity.value)
    print(entity.start, entity.end)
    print(entity.confidence)
    print(entity.replacement)
```

## Sessions and vaults

Use sessions when the model should never see raw values, but the final response should restore them.

```python
from prompt_sanitizer import Sanitizer

s = Sanitizer()
session = s.session(session_id="support-chat-001")
clean_prompt = session.anonymize("My name is Elena Ruiz and my email is elena@company.com")
llm_reply = "Confirmed. I will email [EMAIL_1] shortly."
final_reply = session.deanonymize(llm_reply)

print(clean_prompt)
print(final_reply)
```

### `Session`

| API | Description |
| --- | --- |
| `session.anonymize(text: str) -> str` | replace PII with vault tokens |
| `session.deanonymize(text: str) -> str` | restore originals from the vault |
| `session.vault: Vault` | access the underlying vault |

### `Vault`

| API | Description |
| --- | --- |
| `vault.store(value: str, replacement: str) -> None` | store a mapping |
| `vault.lookup(replacement: str) -> str \| None` | resolve token to original |
| `vault.reverse(value: str) -> str \| None` | resolve original to replacement |
| `vault.clear() -> None` | clear all mappings |

```python
vault = session.vault
vault.store("alice@example.com", "[EMAIL_1]")
print(vault.lookup("[EMAIL_1]"))
print(vault.reverse("alice@example.com"))
vault.clear()
```

## Custom entities

Use `add_entity()` for internal identifiers, tenant-specific secrets, or domain-specific formats.

```python
from prompt_sanitizer import Sanitizer

s = Sanitizer()
s.add_entity(name="customer_id", pattern=r"\bCUS-\d{8}\b", confidence=0.90)
s.add_entity(name="invoice_no", pattern=r"\bINV-\d{6}-[A-Z]{2}\b", confidence=0.88)

result = s.sanitize("Customer CUS-12345678 opened invoice INV-882211-US")
print(result.text)
print(result.entities)
```

## Filtering by entity type

```python
from prompt_sanitizer import Sanitizer, EntityType

s = Sanitizer(entities=[EntityType.EMAIL, EntityType.API_KEY])
result = s.sanitize("Email a@b.com and SSN 123-45-6789")
print(result.text)
```

## Audit logging

Audit backends are optional. Use them when you want structured records of detections.

### `MemoryAuditLog`

```python
from prompt_sanitizer import MemoryAuditLog, Mode, Sanitizer

audit = MemoryAuditLog()
s = Sanitizer(mode=Mode.FULL, audit_log=audit)
s.sanitize("Email finance@example.com")

print(audit.events())
print(audit.export(format="json"))
```

### `SQLiteAuditLog`

```python
from prompt_sanitizer import SQLiteAuditLog, Mode, Sanitizer

audit = SQLiteAuditLog("audit.db")
s = Sanitizer(mode=Mode.FULL, audit_log=audit)
s.sanitize("Call +1 415 555 0112", session_id="request-17")

print(audit.events())
print(audit.export(format="csv"))
```

### Audit API

| API | Description |
| --- | --- |
| `MemoryAuditLog()` | in-memory list of `AuditEvent` |
| `SQLiteAuditLog(path: str)` | SQLite-backed persisted log |
| `.events() -> list[AuditEvent]` | return recorded events |
| `.export(format: "json" \| "csv") -> str` | export audit records |

## Integrations

Install integration dependencies first:

```bash
pip install "prompt-sanitizer[integrations]"
```

### LangChain

```python
from prompt_sanitizer import Sanitizer
from prompt_sanitizer.integrations.langchain import PromptSanitizerTransformer

s = Sanitizer()
chain = PromptSanitizerTransformer(sanitizer=s) | llm | OutputParser()
result = chain.invoke("My email is dev@example.com")
```

### LlamaIndex

```python
from prompt_sanitizer import Sanitizer
from prompt_sanitizer.integrations.llamaindex import SanitizerQueryTransform

s = Sanitizer()
transform = SanitizerQueryTransform(sanitizer=s)
query_engine = index.as_query_engine(query_transform=transform)
response = query_engine.query("Summarize the contract for jane@example.com")
```

### OpenAI SDK wrapper

```python
import openai
from prompt_sanitizer import Sanitizer
from prompt_sanitizer.integrations.openai_wrapper import wrap_openai

s = Sanitizer()
client = wrap_openai(openai.OpenAI(), sanitizer=s)
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "My card is 4111 1111 1111 1111"}],
)
```

### FastAPI middleware

```python
from fastapi import FastAPI
from prompt_sanitizer import Sanitizer
from prompt_sanitizer.integrations.fastapi_middleware import SanitizerMiddleware

s = Sanitizer()
app = FastAPI()
app.add_middleware(SanitizerMiddleware, sanitizer=s, fields=["prompt", "message"])
```

### Django middleware

```python
MIDDLEWARE = ["prompt_sanitizer.integrations.django_middleware.SanitizerMiddleware"]
```

```python
from prompt_sanitizer import Sanitizer

PROMPT_SANITIZER = {
    "sanitizer": Sanitizer(),
    "fields": ["prompt", "message"],
}
```

## Entity types

Supported values:

- `EMAIL`
- `PHONE`
- `SSN`
- `CREDIT_CARD`
- `IBAN`
- `IP_ADDRESS`
- `URL`
- `API_KEY`
- `JWT_TOKEN`
- `PERSON_NAME`
- `ORGANIZATION`
- `LOCATION`
- `DATE`
- `CUSTOM`
- `SECRET_KEY`
- `AWS_KEY`
- `GITHUB_TOKEN`
- `OPENAI_KEY`
- `ANTHROPIC_KEY`

## Operational notes

- FAST mode is stdlib-only.
- SMART lazy-loads NER on first use.
- FULL is the best fit for synthetic replacement plus audit.
- `sanitize()` is for one-shot calls.
- `session()` is for reversible multi-turn workflows.
- `sanitize_batch()` treats each input independently.

## License

MIT.
