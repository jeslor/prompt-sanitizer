# prompt-sanitizer (Python)

Lightweight, tiered, bidirectional PII sanitizer for LLM pipelines.

## Install

```bash
pip install prompt-sanitizer          # fast mode — zero ML deps
pip install prompt-sanitizer[nlp]     # + NER (Piiranha mDeBERTa-v3)
pip install prompt-sanitizer[synthetic]  # + realistic fake replacements
pip install prompt-sanitizer[all]     # everything
```

## Quick Start

```python
from prompt_sanitizer import Sanitizer, Mode

s = Sanitizer()  # fast mode
result = s.sanitize("Email john@example.com or call 555-867-5309")
print(result.text)    # redacted text
print(result.tokens)  # {"john@example.com": "...", ...}

# Bidirectional LLM session
session = s.session()
clean   = session.anonymize(user_prompt)
reply   = call_llm(clean)
final   = session.deanonymize(reply)

# Decorator guard
@s.guard(on_detect="redact")
def call_openai(prompt: str) -> str: ...
```

See [RESEARCH.md](../../RESEARCH.md) for full design rationale and competitive analysis.
