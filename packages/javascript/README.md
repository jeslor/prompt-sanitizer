# prompt sanitizer

TypeScript-first PII sanitization for LLM pipelines in Node.js.

- **npm:** `prompt-sanitizer`
- **Node:** `>= 18`
- **Required deps:** none in `Mode.FAST`
- **Optional extras:** `@huggingface/transformers` for NER, `@faker-js/faker` for realistic synthetic replacements
- **Formats:** ESM + CJS + bundled `.d.ts`
- **Exports:** main entrypoint + integration sub-paths

## Install

Base install:

```bash
npm install prompt-sanitizer
```

Optional NER for `Mode.SMART` / `Mode.FULL`:

```bash
npm install prompt-sanitizer @huggingface/transformers
```

Optional realistic synthetic replacements:

```bash
npm install prompt-sanitizer @faker-js/faker
```

Everything:

```bash
npm install prompt-sanitizer @huggingface/transformers @faker-js/faker
```

## Quick start

```ts
import { Mode, Sanitizer } from "prompt-sanitizer";
const sanitizer = new Sanitizer({ mode: Mode.FAST });
const result = await sanitizer.sanitize(
  "Contact alice@example.com or 555-123-4567",
);
console.log(result.text);
console.log(result.tokens);
console.log(result.entities.length > 0); // has PII?
console.log(result.score); // 0.0 - 1.0
```

## Why this package

- **LLM-native:** sanitize before the model, restore after the model
- **Tiered modes:** FAST, SMART, FULL
- **Zero required dependencies:** safe default install path
- **TypeScript-first:** typed public API with ESM and CJS support
- **Framework-ready:** Vercel AI, Express, Next.js, LangChain.js, LlamaIndex.TS

## Export map

```txt
.
./integrations/vercel-ai
./integrations/express
./integrations/nextjs
./integrations/langchain
./integrations/llamaindex
```

## Modes

| Mode         | Use case                          | Extra install               | Detection stack              |
| ------------ | --------------------------------- | --------------------------- | ---------------------------- |
| `Mode.FAST`  | fastest path, serverless defaults | none                        | regex + secrets              |
| `Mode.SMART` | stronger unstructured detection   | `@huggingface/transformers` | FAST + NER                   |
| `Mode.FULL`  | NER + audit logging               | `@huggingface/transformers` | SMART + automatic `AuditLog` |

### `Mode.FAST`

```ts
import { Mode, Sanitizer } from "prompt-sanitizer";
const sanitizer = new Sanitizer({ mode: Mode.FAST, onDetect: "redact" });
const result = await sanitizer.sanitize(
  "Card 4111 1111 1111 1111, token sk-test-123456",
);
console.log(result.text);
console.log(result.entities.map((e) => e.entityType));
```

### `Mode.SMART`

```ts
import { Mode, Sanitizer } from "prompt-sanitizer";
const sanitizer = new Sanitizer({ mode: Mode.SMART, nerSilent: true });
const result = await sanitizer.sanitize(
  "Alice from Acme Corp is meeting in Nairobi tomorrow.",
);
console.log(result.entities);
```

### `Mode.FULL`

```ts
import { AuditLog, Mode, Sanitizer } from "prompt-sanitizer";
const audit = new AuditLog();
const sanitizer = new Sanitizer({ mode: Mode.FULL, auditLog: audit });
await sanitizer.sanitize("Email ceo@example.com and notify Acme Corp.");
console.log(audit.events());
console.log(audit.export({ format: "csv" }));
```

If `@faker-js/faker` is installed, replacements can look more realistic. Without it, the package falls back to placeholder tokens such as `[EMAIL_1]`.

## NER / `Mode.SMART`

Default model:

```txt
Xenova/bert-base-NER
```

Notes:

- first use downloads the model once (~65 MB)
- the model is cached after download
- `nerSilent: true` falls back cleanly if transformers is missing
- `nerSilent: false` throws instead of silently falling back

Override the model:

```ts
const sanitizer = new Sanitizer({
  mode: Mode.SMART,
  nerModel: "Xenova/bert-base-NER",
  nerSilent: false,
});
```

Free model memory:

```ts
await sanitizer.dispose();
```

## Sessions: anonymize now, deanonymize later

Sessions keep a stable mapping so the same PII becomes the same replacement across a conversation.

```ts
import { Sanitizer } from "prompt-sanitizer";
const sanitizer = new Sanitizer();
const session = sanitizer.session("chat-42");
const clean = await session.anonymize(
  "Alice's email is alice@example.com. Draft a reply.",
);
const llmReply = `I will contact ${clean} today.`;
const finalReply = session.deanonymize(llmReply);
console.log(clean);
console.log(finalReply);
```

Useful members: `anonymize()`, `anonymizeWithResult()`, `deanonymize()`, `reset()`, `size`, `mapping`, `sessionId`.

### Persisting sessions across restarts

By default a session's vault lives only in process memory. Pass a `VaultStore` to reattach to the same mapping later by `sessionId` — e.g. after a worker restart or serverless cold start:

```ts
import { FileVaultStore } from "prompt-sanitizer";

const store = new FileVaultStore("./vault-data");
const session = await sanitizer.session("chat-42", { store }); // async: loads any existing snapshot first
const clean = await session.anonymize("Alice's email is alice@example.com");
await session.persist();

// ...later, possibly in a new process:
const resumed = await sanitizer.session("chat-42", { store });
const finalReply = resumed.deanonymize(llmReply);
```

`InMemoryVaultStore` is the zero-dependency, same-process reference store; `FileVaultStore` persists to disk (Node builtins only). Pass `{ store, autoPersist: true }` to persist automatically after every `anonymize()` call instead of calling `persist()` yourself. No store is active unless you pass one.

## `guard()`

Wrap a function so all string arguments are sanitized before invocation.

```ts
import { Sanitizer } from "prompt-sanitizer";
const sanitizer = new Sanitizer();
const safeCall = sanitizer.guard(
  async (prompt: string) => `Model saw: ${prompt}`,
  "redact",
);
console.log(await safeCall("Reach me at jane@example.com"));
```

`onDetect` values: `"redact"`, `"warn"`, `"block"`.

## Custom entities

Use `addEntity()` for domain-specific identifiers.

```ts
import { Sanitizer } from "prompt-sanitizer";
const sanitizer = new Sanitizer();
sanitizer.addEntity("EMPLOYEE_ID", /EMP-\d{6}/g, {
  confidence: 0.98,
  validator: (match) => match.startsWith("EMP-"),
});
const result = await sanitizer.sanitize(
  "Reviewer EMP-123456 approved the request.",
);
console.log(result.text);
console.log(result.entities);
```

## Audit logging

`AuditLog` records detection events without storing raw PII.

```ts
import { AuditLog, Mode, Sanitizer } from "prompt-sanitizer";
const audit = new AuditLog();
const sanitizer = new Sanitizer({ mode: Mode.FULL, auditLog: audit });
await sanitizer.sanitize("alice@example.com logged in from 203.0.113.10");
console.log(audit.events());
console.log(audit.export({ format: "json" }));
console.log(audit.export({ format: "csv", since: "1h" }));
```

Recorded fields include timestamp, entity type, confidence, detection layer, redaction method, hashed value fingerprint, and optional session ID.

## Streaming with Vercel AI

```ts
import {
  wrapGenerate,
  wrapStream,
} from "prompt-sanitizer/integrations/vercel-ai";
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
  if (chunk.type === "text-delta") fullText += chunk.textDelta ?? "";
}
console.log(fullText);
```

The wrapper sanitizes `prompt`, `system`, and `messages`, then deanonymizes streamed `text-delta` chunks, including tokens split across chunk boundaries.

## Express.js

```ts
import express from "express";
import { Mode, Sanitizer } from "prompt-sanitizer";
import { createExpressMiddleware } from "prompt-sanitizer/integrations/express";
const app = express();
const sanitizer = new Sanitizer({ mode: Mode.SMART });
app.use(express.json());
app.use(
  createExpressMiddleware(sanitizer, {
    routes: ["/api/chat"],
    fields: ["prompt", "message"],
  }),
);
```

The middleware sanitizes configured request fields and restores values in JSON or string responses.

## Next.js middleware

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

```ts
import {
  PromptSanitizerRunnable,
  SanitizedChain,
  SanitizedLLM,
} from "prompt-sanitizer/integrations/langchain";
```

Runnable example:

```ts
const sanitizeStep = new PromptSanitizerRunnable(sanitizer);
const cleanPrompt = await sanitizeStep.invoke("My email is alice@example.com");
```

LLM wrapper example:

```ts
import { ChatOpenAI } from "@langchain/openai";
import { SanitizedLLM } from "prompt-sanitizer/integrations/langchain";
const llm = new ChatOpenAI({ model: "gpt-4o-mini" });
const safeLLM = new SanitizedLLM(llm, sanitizer);
const reply = await safeLLM.invoke(
  "Contact alice@example.com with the summary.",
);
console.log(reply);
```

## LlamaIndex.TS

```ts
import {
  PromptSanitizerNodePostprocessor,
  PromptSanitizerQueryTransform,
} from "prompt-sanitizer/integrations/llamaindex";
const transform = new PromptSanitizerQueryTransform(sanitizer);
const cleanQuery = await transform.transform(
  "Find records mentioning alice@example.com",
);
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

Key members:

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

Use `result.entities.length > 0` as your `hasPii` check.

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

Common built-in values:

```ts
EMAIL;
PHONE;
SSN;
CREDIT_CARD;
IBAN;
IP_ADDRESS;
MAC_ADDRESS;
URL;
CRYPTO_ADDRESS;
DATE_OF_BIRTH;
PASSPORT;
DRIVING_LICENSE;
PERSON_NAME;
LOCATION;
ORGANIZATION;
AGE;
GENDER;
NATIONALITY;
RELIGION;
API_KEY;
SECRET_KEY;
PASSWORD;
JWT_TOKEN;
PRIVATE_KEY;
DATABASE_URL;
AWS_KEY;
OAUTH_TOKEN;
CUSTOM;
```

## Notes

- FAST is the best default for latency-sensitive paths
- SMART and FULL lazy-load NER on first use
- `await sanitizer.dispose()` releases NER model memory
- missing `@faker-js/faker` does not break sanitization
- session-based flows are the safest way to preserve meaning across model calls

## License

MIT
