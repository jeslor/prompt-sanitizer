# prompt-sanitizer

TypeScript-first PII sanitization for LLM pipelines in Node.js.

- **npm:** `prompt-sanitizer`
- **Runtime:** Node.js **>= 18**
- **Required deps:** **none** in `Mode.FAST`
- **Optional peer deps:** `@huggingface/transformers` for NER, `@faker-js/faker` for realistic synthetic replacements
- **Package format:** ESM + CJS + bundled `.d.ts` types
- **Exports:** main entrypoint plus framework integration sub-paths

## Install

### Base install (FAST mode, zero required dependencies)

```bash
npm install prompt-sanitizer
```

### Optional: NER for `Mode.SMART` / `Mode.FULL`

```bash
npm install prompt-sanitizer @huggingface/transformers
```

### Optional: realistic synthetic replacements

```bash
npm install prompt-sanitizer @faker-js/faker
```

### Optional: everything

```bash
npm install prompt-sanitizer @huggingface/transformers @faker-js/faker
```

## What it does

`prompt-sanitizer` finds sensitive values before they reach an LLM, replaces them with safe tokens or synthetic stand-ins, and can restore the originals later.

Use it to protect prompts, chat messages, retrieved context, streaming responses, and framework request bodies.

Typical detections include:

- email addresses
- phone numbers
- SSNs
- credit cards
- IBANs
- IP addresses
- URLs
- API keys and secret-like strings
- JWTs
- names, organizations, and locations in NER modes
- custom regex-based entity types

## Quick start

```ts
import { Sanitizer, Mode } from "prompt-sanitizer";

const sanitizer = new Sanitizer({ mode: Mode.FAST });

const result = await sanitizer.sanitize(
  "Contact Alice at alice@example.com or 555-123-4567"
);

console.log(result.text);
// Contact [EMAIL_1] at [EMAIL_1] or [PHONE_1]
// or realistic synthetic values if @faker-js/faker is installed

console.log(result.tokens);
// {
//   "alice@example.com": "[EMAIL_1]",
//   "555-123-4567": "[PHONE_1]"
// }

console.log(result.entities.length > 0);
// true

console.log(result.score);
// 0.0 - 1.0 aggregate risk score
```

## Why this package

- **LLM-oriented**: built for prompt, chat, retrieval, and streaming workflows
- **Bidirectional**: anonymize before the model, deanonymize after the model
- **Tiered modes**: start with regex-only FAST mode and opt into NER later
- **Zero required dependencies**: production-safe default install
- **TypeScript-first**: full type definitions for the complete public surface
- **Framework-ready**: Vercel AI, Express, Next.js, LangChain.js, and LlamaIndex.TS integrations

## Package exports

Main entrypoint:

```txt
.
```

Integration sub-paths:

```txt
./integrations/vercel-ai
./integrations/express
./integrations/nextjs
./integrations/langchain
./integrations/llamaindex
```

## Module formats

### ESM

```ts
import { Sanitizer, Mode } from "prompt-sanitizer";
```

### CommonJS

```js
const { Sanitizer, Mode } = require("prompt-sanitizer");
```

## Modes

`prompt-sanitizer` has three operating modes.

| Mode | Best for | Required extras | What runs |
| --- | --- | --- | --- |
| `Mode.FAST` | default production path | none | regex + secrets |
| `Mode.SMART` | stronger person/org/location detection | `@huggingface/transformers` | FAST + transformer NER |
| `Mode.FULL` | NER + audit-friendly flows | `@huggingface/transformers` and optionally `@faker-js/faker` | SMART + automatic audit log |

### `Mode.FAST`

Use FAST when you want a tiny install, fast startup, and zero required dependencies.

```ts
import { Sanitizer, Mode } from "prompt-sanitizer";

const sanitizer = new Sanitizer({
  mode: Mode.FAST,
  onDetect: "redact",
});

const result = await sanitizer.sanitize(
  "My card is 4111 1111 1111 1111 and my token is sk-test-123456"
);

console.log(result.text);
console.log(result.entities.map((e) => e.entityType));
```

FAST mode is the default and is the easiest place to start.

### `Mode.SMART`

Use SMART when you want regex detection **plus** transformer-backed named entity recognition.

```ts
import { Sanitizer, Mode } from "prompt-sanitizer";

const sanitizer = new Sanitizer({
  mode: Mode.SMART,
  nerSilent: true,
});

const result = await sanitizer.sanitize(
  "Alice from Acme Corp is meeting in Nairobi next Tuesday."
);

console.log(result.entities.map((e) => ({
  type: e.entityType,
  value: e.value,
  confidence: e.confidence,
})));
```

SMART mode is ideal for unstructured text where names, orgs, and locations are not easy to express as regexes.

### `Mode.FULL`

Use FULL when you want NER plus an automatically available audit log.

```ts
import { AuditLog, Mode, Sanitizer } from "prompt-sanitizer";

const audit = new AuditLog();
const sanitizer = new Sanitizer({
  mode: Mode.FULL,
  auditLog: audit,
});

const result = await sanitizer.sanitize(
  "Email ceo@example.com and send the contract to Acme Corp."
);

console.log(result.text);
console.log(audit.events());
console.log(audit.export({ format: "csv" }));
```

If `@faker-js/faker` is installed, replacements become more realistic-looking. Without it, the package falls back to deterministic placeholder-style tokens such as `[EMAIL_1]`.

## NER / `Mode.SMART`

NER is powered by `@huggingface/transformers` using the default model:

```txt
Xenova/bert-base-NER
```

Notes:

- first use downloads the model once
- download size is roughly **65 MB**
- the model is cached by Hugging Face after download
- `nerSilent: true` skips NER gracefully if transformers is not installed
- `nerSilent: false` surfaces a clear error instead of silently falling back

You can override the model:

```ts
import { Mode, Sanitizer } from "prompt-sanitizer";

const sanitizer = new Sanitizer({
  mode: Mode.SMART,
  nerModel: "Xenova/bert-base-NER",
  nerSilent: false,
});
```

If you enable NER in long-lived processes and want to free model memory later:

```ts
await sanitizer.dispose();
```

## Bidirectional sessions

Sessions are the key building block for LLM workflows.

A session keeps a stable mapping between original sensitive values and their replacements so that:

1. prompts are anonymized before the model sees them
2. model output can be deanonymized after generation
3. repeated values stay consistent across a conversation

```ts
import { Sanitizer } from "prompt-sanitizer";

const sanitizer = new Sanitizer();
const session = sanitizer.session("chat-42");

const cleanPrompt = await session.anonymize(
  "Alice's email is alice@example.com. Draft a follow-up."
);

const llmReply = `I will email ${cleanPrompt} today.`;
const finalReply = session.deanonymize(llmReply);

console.log(cleanPrompt);
console.log(finalReply);
```

Useful session members:

- `session.anonymize(text)`
- `session.anonymizeWithResult(text)`
- `session.deanonymize(text)`
- `session.reset()`
- `session.size`
- `session.mapping`
- `session.sessionId`

## Guard a function

`guard()` wraps a function and sanitizes string arguments before your function runs.

```ts
import { Mode, Sanitizer } from "prompt-sanitizer";

const sanitizer = new Sanitizer({ mode: Mode.FAST });

const safeCall = sanitizer.guard(async (prompt: string) => {
  return `Model saw: ${prompt}`;
}, "redact");

const output = await safeCall("Reach me at jane@example.com");
console.log(output);
```

`onDetect` behavior:

- `"redact"` - replace detected values
- `"warn"` - return original text plus entity metadata
- `"block"` - throw `PIIDetectedError` when anything sensitive is found

## Custom entities

You can add your own regex-based detectors.

```ts
import { Sanitizer } from "prompt-sanitizer";

const sanitizer = new Sanitizer();

sanitizer.addEntity(
  "EMPLOYEE_ID",
  /EMP-\d{6}/g,
  {
    confidence: 0.98,
    validator: (match) => match.startsWith("EMP-"),
  }
);

const result = await sanitizer.sanitize(
  "Reviewer EMP-123456 approved the request."
);

console.log(result.text);
console.log(result.entities);
```

Use custom entities for tenant IDs, case numbers, internal handles, or any domain-specific sensitive value not covered by the built-in detectors.

## Audit logging

Audit logging is useful when you need visibility into what was detected without storing raw PII.

```ts
import { AuditLog, Mode, Sanitizer } from "prompt-sanitizer";

const audit = new AuditLog();
const sanitizer = new Sanitizer({
  mode: Mode.FULL,
  auditLog: audit,
});

await sanitizer.sanitize("alice@example.com logged in from 203.0.113.10");

console.log(audit.events());
console.log(audit.export({ format: "json" }));
console.log(audit.export({ format: "csv", since: "1h" }));
```

`AuditLog` stores event metadata such as:

- timestamp
- entity type
- confidence
- detection layer (`regex`, `secrets`, `ner`)
- redaction method
- hashed value fingerprint
- optional session ID

## Streaming with Vercel AI

Import from the Vercel AI integration sub-path:

```ts
import { wrapGenerate, wrapStream } from "prompt-sanitizer/integrations/vercel-ai";
```

Full streaming example:

```ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Mode, Sanitizer } from "prompt-sanitizer";
import { wrapStream } from "prompt-sanitizer/integrations/vercel-ai";

const sanitizer = new Sanitizer({ mode: Mode.FAST });
const safeStreamText = wrapStream(sanitizer, streamText);

const result = await safeStreamText({
  model: openai("gpt-4o-mini"),
  system: "Be concise.",
  prompt: "Email Alice at alice@example.com and summarize the request.",
});

let fullText = "";
for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") {
    fullText += chunk.textDelta ?? "";
  }
}

console.log(fullText);
```

What the integration does:

- sanitizes `prompt`
- sanitizes `system`
- sanitizes `messages`
- preserves a per-call session automatically
- deanonymizes streamed `text-delta` chunks, including tokens split across chunk boundaries

For non-streaming calls, use `wrapGenerate()` the same way.

## Express.js

Import from the Express integration sub-path:

```ts
import { createExpressMiddleware } from "prompt-sanitizer/integrations/express";
```

Example:

```ts
import express from "express";
import { Mode, Sanitizer } from "prompt-sanitizer";
import { createExpressMiddleware } from "prompt-sanitizer/integrations/express";

const app = express();
const sanitizer = new Sanitizer({ mode: Mode.SMART });

app.use(express.json());
app.use(
  createExpressMiddleware(sanitizer, {
    fields: ["prompt", "message"],
    routes: ["/api/chat"],
  })
);

app.post("/api/chat", (req, res) => {
  res.json({
    ok: true,
    promptSeenByHandler: req.body.prompt,
  });
});
```

The middleware sanitizes configured request fields and restores values in JSON or string responses.

## Next.js middleware

Import from the Next.js integration sub-path:

```ts
import {
  createNextjsMiddleware,
  matcherConfig,
} from "prompt-sanitizer/integrations/nextjs";
```

Example `middleware.ts`:

```ts
import { Mode, Sanitizer } from "prompt-sanitizer";
import {
  createNextjsMiddleware,
  matcherConfig,
} from "prompt-sanitizer/integrations/nextjs";

const sanitizer = new Sanitizer({ mode: Mode.FAST });

export default createNextjsMiddleware(sanitizer, {
  routes: ["/api/chat"],
  fields: ["prompt", "message"],
});

export const config = matcherConfig(["/api/chat"]);
```

This integration is edge-compatible and uses standard `Request` / `Response` APIs.

## LangChain.js

Import from the LangChain integration sub-path:

```ts
import {
  PromptSanitizerRunnable,
  SanitizedChain,
  SanitizedLLM,
} from "prompt-sanitizer/integrations/langchain";
```

Runnable example:

```ts
import { PromptSanitizerRunnable } from "prompt-sanitizer/integrations/langchain";

const sanitizeStep = new PromptSanitizerRunnable(sanitizer);
const cleanPrompt = await sanitizeStep.invoke("My email is alice@example.com");
```

LLM wrapper example:

```ts
import { ChatOpenAI } from "@langchain/openai";
import { SanitizedLLM } from "prompt-sanitizer/integrations/langchain";

const llm = new ChatOpenAI({ model: "gpt-4o-mini" });
const safeLLM = new SanitizedLLM(llm, sanitizer);

const reply = await safeLLM.invoke("Contact alice@example.com with the summary.");
console.log(reply);
```

Chain wrapper example:

```ts
import { SanitizedChain } from "prompt-sanitizer/integrations/langchain";

const safeChain = new SanitizedChain(chain, sanitizer, ["question", "context"]);
const result = await safeChain.invoke({
  question: "Tell Alice at alice@example.com the result.",
  context: "Internal case notes...",
});
```

## LlamaIndex.TS

Import from the LlamaIndex integration sub-path:

```ts
import {
  PromptSanitizerNodePostprocessor,
  PromptSanitizerQueryTransform,
} from "prompt-sanitizer/integrations/llamaindex";
```

Query transform example:

```ts
import { PromptSanitizerQueryTransform } from "prompt-sanitizer/integrations/llamaindex";

const transform = new PromptSanitizerQueryTransform(sanitizer);
const cleanQuery = await transform.transform(
  "Find records mentioning alice@example.com"
);
```

Node postprocessor example:

```ts
import { PromptSanitizerNodePostprocessor } from "prompt-sanitizer/integrations/llamaindex";

const postprocessor = new PromptSanitizerNodePostprocessor(sanitizer, {
  preserveOriginal: true,
});

const nodes = await postprocessor.postprocessNodes([
  {
    node: { text: "Alice (alice@example.com) approved the request." },
    score: 0.92,
  },
]);

console.log(nodes[0].node.text);
console.log(nodes[0].node.metadata?.__original_text);
```

## TypeScript API

### `Sanitizer`

```ts
new Sanitizer(options?: SanitizerOptions)
```

```ts
interface SanitizerOptions {
  mode?: Mode;
  locale?: string;
  entities?: EntityType[];
  onDetect?: "redact" | "warn" | "block";
  auditLog?: AuditLog | boolean;
  nerModel?: string;
  nerSilent?: boolean;
}
```

Key instance members:

- `sanitize(text: string): Promise<SanitizeResult>`
- `sanitizeBatch(texts: string[]): Promise<SanitizeResult[]>`
- `session(sessionId?: string): Session`
- `addEntity(name: string, pattern: RegExp, options?: AddEntityOptions): void`
- `guard(fn, onDetect?): wrappedFn`
- `audit: AuditLog | null`
- `ner: NerEngine | null`
- `dispose(): Promise<void>`

### `SanitizeResult`

```ts
interface SanitizeResult {
  text: string;
  original: string;
  entities: DetectedEntity[];
  tokens: Record<string, string>;
  score: number;
}
```

Use `result.entities.length > 0` when you need a simple `hasPii` check.

### `DetectedEntity`

```ts
interface DetectedEntity {
  entityType: EntityType;
  value: string;
  start: number;
  end: number;
  confidence: number;
  layer: string;
  replacement?: string;
}
```

### `Session`

```ts
class Session {
  anonymize(text: string): Promise<string>;
  anonymizeWithResult(text: string): Promise<SanitizeResult>;
  deanonymize(text: string): string;
  reset(): void;
  readonly size: number;
  readonly mapping: Record<string, string>;
  readonly sessionId?: string;
}
```

### `Vault`

The exported `Vault` is the underlying bidirectional mapping primitive used by `Session`.

```ts
class Vault {
  add(original: string, replacement: string): string;
  getReplacement(original: string): string | undefined;
  getOriginal(replacement: string): string | undefined;
  restore(text: string): string;
  clear(): void;
  readonly size: number;
  snapshot(): Record<string, string>;
}
```

### `AuditLog`

```ts
class AuditLog {
  record(event: AuditEvent): void;
  events(since?: string | Date): AuditEvent[];
  export(options?: ExportOptions): string;
  clear(): void;
  readonly size: number;
}
```

### `Mode`

```ts
enum Mode {
  FAST = "fast",
  SMART = "smart",
  FULL = "full",
}
```

### `EntityType`

Common built-in values include:

```ts
EMAIL
PHONE
SSN
CREDIT_CARD
IBAN
IP_ADDRESS
MAC_ADDRESS
URL
CRYPTO_ADDRESS
DATE_OF_BIRTH
PASSPORT
DRIVING_LICENSE
PERSON_NAME
LOCATION
ORGANIZATION
AGE
GENDER
NATIONALITY
RELIGION
API_KEY
SECRET_KEY
PASSWORD
JWT_TOKEN
PRIVATE_KEY
DATABASE_URL
AWS_KEY
OAUTH_TOKEN
CUSTOM
```

## Detection behavior

Detection is layered.

1. regex engine finds structured values
2. secrets engine finds key/token-like strings
3. optional NER finds person/org/location entities
4. overlapping spans are deduplicated
5. output is scored from `0.0` to `1.0`

This keeps the default path fast while still letting you opt into higher-recall detection when needed.

## Error handling

Useful exported errors:

- `PIIDetectedError` - thrown in `onDetect: "block"` mode
- `MissingDependencyError` - exported for dependency-related flows

Example:

```ts
import { PIIDetectedError, Sanitizer } from "prompt-sanitizer";

const sanitizer = new Sanitizer({ onDetect: "block" });

try {
  await sanitizer.sanitize("alice@example.com");
} catch (error) {
  if (error instanceof PIIDetectedError) {
    console.error(error.entities);
  }
}
```

## Operational notes

- FAST mode is the best default for serverless and latency-sensitive code paths.
- SMART and FULL lazy-load NER on first use.
- The NER model can be released with `await sanitizer.dispose()`.
- If `@faker-js/faker` is missing, sanitization still works with placeholder tokens.
- Session-based flows are the safest way to preserve meaning across model calls.

## When to use which mode

Choose **FAST** when:

- you want zero required dependencies
- you mainly care about structured identifiers and secrets
- cold start and install size matter most

Choose **SMART** when:

- user text is messy or conversational
- names, organizations, and locations matter
- you can afford the one-time model download

Choose **FULL** when:

- you want SMART mode behavior plus built-in audit logging
- you need event export for compliance or internal review
- you want the most operationally complete preset

## License

MIT
