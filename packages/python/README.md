# prompt-sanitizer

PII and secret sanitization for Python LLM pipelines.

`prompt-sanitizer` is a typed package for detecting, redacting, anonymizing, and restoring sensitive values before they reach an LLM, a tool wrapper, a log sink, or an external SDK. It supports zero-dependency fast paths, optional NER, session-scoped vaults, streaming restoration, and optional audit logging.

## Install

Python 3.10+.

```bash
# FAST mode: zero required dependencies
pip install prompt-sanitizer

# SMART / FULL mode NER support
pip install "prompt-sanitizer[nlp]"

# Synthetic replacements
pip install "prompt-sanitizer[synthetic]"

# SDK and framework integrations
pip install "prompt-sanitizer[integrations]"

# Everything
pip install "prompt-sanitizer[all]"
```

### Extras

| Extra | Adds | Use when |
| --- | --- | --- |
| `nlp` | `transformers` + `torch` | You want context-aware NER in SMART/FULL mode |
| `synthetic` | `faker` | You want realistic fake replacements |
| `integrations` | framework / SDK adapters | You want drop-in wrappers for common LLM stacks |
| `all` | all optional extras | You want the full package surface |

## Why this package

- Zero required dependencies for `Mode.FAST`.
- One-shot sanitization for prompts, logs, traces, and tool payloads.
- Reversible anonymization for multi-turn LLM sessions.
- `warn`, `redact`, and `block` enforcement modes.
- Streaming support for async chunked responses.
- Optional audit backends for compliance-oriented workflows.

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
| `Mode.SMART` | FAST + Piiranha NER | `prompt-sanitizer[nlp]` | lazy-loads model on first call |
| `Mode.FULL` | SMART + synthetic replacement + audit log | usually `nlp` + `synthetic` | best for compliance-oriented workflows |

### FAST mode

Use FAST for lightweight, always-on sanitization.

```python
from prompt_sanitizer import Sanitizer, Mode

s = Sanitizer(mode=Mode.FAST)
text = "SSN 078-05-1120, card 4111 1111 1111 1111, token sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"
result = s.sanitize(text)

print(result.text)
print(result.entities)
print(result.tokens)
```

Typical fits:

- prompt pre-processing
- log scrubbing
- middleware guards
- CI checks
- zero-dependency CLI tools

### SMART mode

SMART adds context-aware entity detection. This is the mode to use when prompts contain free-form prose with names, organizations, dates, or locations that regexes alone may miss.

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

### FULL mode

FULL adds synthetic replacement and audit logging on top of SMART.

```python
from prompt_sanitizer import Sanitizer, Mode, SQLiteAuditLog

audit = SQLiteAuditLog("prompt_sanitizer_audit.db")
s = Sanitizer(mode=Mode.FULL, locale="en_US", on_detect="redact", audit_log=audit)

result = s.sanitize("Customer Jane Doe uses jane@example.com and 415-555-0112.")
print(result.text)
print(result.tokens)
print(s.audit.export(format="json"))
```

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
| `mode` | `Mode` | Detection pipeline to run |
| `locale` | `str` | Locale used for synthetic replacement generation |
| `entities` | `list[EntityType] \| None` | Optional allowlist of entity types |
| `on_detect` | `str` | `"redact"`, `"warn"`, or `"block"` |
| `audit_log` | `BaseAuditLog \| None` | Optional audit backend |

#### Methods

| Method | Signature | Description |
| --- | --- | --- |
| `sanitize` | `sanitize(text: str, session_id: str | None = None) -> SanitizeResult` | Sanitize one string |
| `sanitize_batch` | `sanitize_batch(texts: list[str]) -> list[SanitizeResult]` | Sanitize a list of strings |
| `session` | `session(session_id: str | None = None) -> Session` | Create a reusable anonymization session |
| `add_entity` | `add_entity(name: str, pattern: str, confidence: float = 0.85) -> None` | Register a custom regex-backed entity |
| `stream` | `stream(source: AsyncIterable, session: Session | None) -> AsyncGenerator[str, None]` | Restore streamed chunks using a session vault |
| `guard` | `guard(on_detect: str) -> decorator` | Decorate a function with sanitization logic |
| `audit` | `.audit -> BaseAuditLog | None` | Access the configured audit backend |

### `sanitize()`

Use `sanitize()` for one-shot rewriting or inspection.

```python
result = s.sanitize("Reach me at dev@example.com", session_id="req-001")
print(result.text)
```

### `sanitize_batch()`

Use `sanitize_batch()` when you have independent inputs and do not need a shared vault.

```python
results = s.sanitize_batch([
    "Email a@example.com",
    "No sensitive data here",
    "Call +1 415 555 0112",
])
```

### `session()`

Use `session()` for reversible anonymization across multiple calls.

```python
session = s.session(session_id="chat-42")
clean = session.anonymize("My email is ops@example.com")
restored = session.deanonymize(f"Reply to {list(session.vault.tokens.values())[0]}")
```

### `add_entity()`

Register application-specific identifiers or secrets.

```python
s.add_entity(name="customer_id", pattern=r"\bCUS-\d{8}\b", confidence=0.92)
s.add_entity(name="ticket_ref", pattern=r"\bINC-[A-Z0-9]{10}\b", confidence=0.88)
```

### `stream()`

Use `stream()` to restore originals while consuming an async source.

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

Use `guard()` when you want to protect existing functions without changing their call sites.

```python
from prompt_sanitizer import Sanitizer

s = Sanitizer()

@s.guard(on_detect="redact")
def call_model(prompt: str) -> str:
    return f"sent: {prompt}"

print(call_model("Customer email is hello@example.com"))
```

`guard()` works for sync and async functions. Use `on_detect="block"` when the wrapped function must never receive sensitive text.

## Detection policy

### `on_detect="redact"`

Default mode. Returned text is rewritten.

```python
s = Sanitizer(on_detect="redact")
print(s.sanitize("My email is user@example.com").text)
```

### `on_detect="warn"`

Inspection mode. Original text is preserved, but metadata is still returned.

```python
s = Sanitizer(on_detect="warn")
result = s.sanitize("My IP is 10.0.0.42")
print(result.text)
print(result.entities)
```

### `on_detect="block"`

Hard-stop mode.

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
| `text` | `str` | Sanitized text |
| `entities` | `list[DetectedEntity]` | Detected entity spans |
| `tokens` | `dict[str, str]` | `{original_value: replacement}` map |
| `risk_score` | `float` | Composite risk score from `0.0` to `1.0` |
| `has_pii` | `bool` | Whether the input contained sensitive data |

```python
result = s.sanitize("Contact me at sam@example.com")
assert result.has_pii is True
assert isinstance(result.tokens, dict)
assert 0.0 <= result.risk_score <= 1.0
```

## `DetectedEntity`

| Attribute | Type | Description |
| --- | --- | --- |
| `entity_type` | `EntityType` | Entity classification |
| `value` | `str` | Original matched value |
| `start` | `int` | Inclusive start offset |
| `end` | `int` | Exclusive end offset |
| `confidence` | `float` | Detection confidence |
| `replacement` | `str \| None` | Replacement value, if generated |

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

# send clean_prompt to the model, then restore before returning to the user
llm_reply = "Confirmed. I will email [EMAIL_1] shortly."
final_reply = session.deanonymize(llm_reply)

print(clean_prompt)
print(final_reply)
```

### `Session`

| API | Description |
| --- | --- |
| `session.anonymize(text: str) -> str` | Replace PII with vault tokens |
| `session.deanonymize(text: str) -> str` | Restore originals from the vault |
| `session.vault: Vault` | Access the underlying vault |

### `Vault`

| API | Description |
| --- | --- |
| `vault.store(value: str, replacement: str) -> None` | Store a mapping |
| `vault.lookup(replacement: str) -> str \| None` | Resolve token to original |
| `vault.reverse(value: str) -> str \| None` | Resolve original to replacement |
| `vault.clear() -> None` | Clear all mappings |

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

Use `entities=` to restrict the detector to specific types.

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
| `MemoryAuditLog()` | In-memory list of `AuditEvent` |
| `SQLiteAuditLog(path: str)` | SQLite-backed persisted log |
| `.events() -> list[AuditEvent]` | Return recorded events |
| `.export(format: "json" \| "csv") -> str` | Export audit records |

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

Use this when you want sanitization at the front of an LCEL chain and restoration after the model or parser stage.

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

The wrapper sanitizes outgoing content automatically and restores originals in the returned response when vault tokens appear.

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

Supported entity values:

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

## Common patterns

### Sanitize before calling a model

```python
s = Sanitizer()
prompt = "Jane Doe <jane@example.com> needs a refund"
clean = s.sanitize(prompt).text
response = llm.invoke(clean)
```

### Reversible chat session

```python
session = Sanitizer().session()
clean_user_text = session.anonymize("Call me at 415-555-0112")
raw_reply = llm.invoke(clean_user_text)
final_reply = session.deanonymize(raw_reply)
```

### Block sensitive content entirely

```python
s = Sanitizer(on_detect="block")
s.sanitize("Bearer abcdefghijklmnopqrstuvwxyz123456")
```

## Operational notes

- FAST mode is stdlib-only.
- SMART lazy-loads NER on first use.
- FULL is the best fit for synthetic replacement plus audit.
- `sanitize()` is for one-shot calls.
- `session()` is for reversible multi-turn workflows.
- `sanitize_batch()` treats each input independently.

## Minimal import surface

```python
from prompt_sanitizer import (
    Sanitizer,
    Mode,
    EntityType,
    SanitizeResult,
    DetectedEntity,
    Session,
    Vault,
    MemoryAuditLog,
    SQLiteAuditLog,
)
```

## License

MIT.
