/**
 * Regex Engine — Layer 1 detection.
 *
 * Detects structured PII using regular expressions with checksum validation
 * (Luhn for credit cards, IBAN mod-97). Runs synchronously with zero deps.
 */
import { EntityType } from "../entities.js";
import type { DetectedEntity } from "../result.js";

interface Pattern {
  entityType: EntityType;
  regex: RegExp;
  confidence: number;
  validator?: (match: string) => boolean;
}

// ── Luhn validation ───────────────────────────────────────────────────────────

function luhnValid(card: string): boolean {
  const digits = card.replace(/\D/g, "").split("").map(Number);
  if (digits.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i]!;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ── IBAN mod-97 validation ────────────────────────────────────────────────────

function ibanValid(iban: string): boolean {
  const raw = iban.replace(/[\s-]/g, "").toUpperCase();
  if (raw.length < 15 || raw.length > 34) return false;
  const rearranged = raw.slice(4) + raw.slice(0, 4);
  const numeric = rearranged
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? (c.charCodeAt(0) - 55).toString() : c))
    .join("");
  // BigInt handles the large number mod-97 safely
  return BigInt(numeric) % 97n === 1n;
}

// ── Pattern registry ──────────────────────────────────────────────────────────

const PATTERNS: Pattern[] = [
  // Email
  {
    entityType: EntityType.EMAIL,
    regex: /(?<![a-zA-Z0-9._%+\-])[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,253}\.[a-zA-Z]{2,}(?![a-zA-Z0-9._%+\-@])/gi,
    confidence: 0.99,
  },
  // US phone (many formats)
  {
    entityType: EntityType.PHONE,
    regex: /(?<!\d)(?:\+?1[\s.\-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/g,
    confidence: 0.85,
  },
  // International phone — compact E.164
  {
    entityType: EntityType.PHONE,
    regex: /(?<!\d)\+[1-9]\d{6,14}(?!\d)/g,
    confidence: 0.80,
  },
  // International phone — spaced/dashed
  {
    entityType: EntityType.PHONE,
    regex: /(?<!\d)\+[1-9]\d{0,3}(?:[\s.\-]\d{2,4}){2,4}(?!\d)/g,
    confidence: 0.78,
  },
  // US SSN
  {
    entityType: EntityType.SSN,
    regex: /(?<!\d)(?!000|666|9\d{2})\d{3}[\s\-](?!00)\d{2}[\s\-](?!0000)\d{4}(?!\d)/g,
    confidence: 0.95,
  },
  // Credit / debit card (Luhn-validated)
  {
    entityType: EntityType.CREDIT_CARD,
    regex: /(?<!\d)(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?:\d[\s\-]?\d{3})?(?!\d)/g,
    confidence: 0.95,
    validator: (m) => luhnValid(m),
  },
  // IBAN
  {
    entityType: EntityType.IBAN,
    regex: /(?<![A-Z])[A-Z]{2}\d{2}[\s]?(?:[A-Z0-9]{4}[\s]?){2,7}[A-Z0-9]{1,4}(?![A-Z0-9])/g,
    confidence: 0.90,
    validator: (m) => ibanValid(m),
  },
  // IPv4
  {
    entityType: EntityType.IP_ADDRESS,
    regex: /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?!\d)/g,
    confidence: 0.85,
    validator: (m) => !m.match(/^(\d{4})/), // reject year-like patterns
  },
  // MAC address
  {
    entityType: EntityType.MAC_ADDRESS,
    regex: /(?<![0-9a-fA-F])(?:[0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}(?![0-9a-fA-F])/gi,
    confidence: 0.90,
  },
  // URL
  {
    entityType: EntityType.URL,
    regex: /https?:\/\/(?:[-\w]+\.)+[a-zA-Z]{2,}(?::\d{1,5})?(?:\/[^\s]*)?/gi,
    confidence: 0.80,
  },
  // Ethereum address
  {
    entityType: EntityType.CRYPTO_ADDRESS,
    regex: /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g,
    confidence: 0.92,
  },
  // Bitcoin P2PKH/P2SH address
  {
    entityType: EntityType.CRYPTO_ADDRESS,
    regex: /(?<![A-Za-z0-9])[13][a-km-zA-HJ-NP-Z1-9]{25,34}(?![A-Za-z0-9])/g,
    confidence: 0.85,
  },
  // Date of birth patterns (DD/MM/YYYY or YYYY-MM-DD)
  {
    entityType: EntityType.DATE_OF_BIRTH,
    regex: /(?:DOB|Date of Birth|Born|Birthday)[:\s]+(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/gi,
    confidence: 0.85,
  },
  // Passport numbers
  {
    entityType: EntityType.PASSPORT,
    regex: /(?:passport(?:\s+(?:no|number|#))?[:\s]*)[A-Z]{1,2}\d{6,9}/gi,
    confidence: 0.80,
  },
];

// ── Engine ────────────────────────────────────────────────────────────────────

export class RegexEngine {
  private _patterns: Pattern[] = [...PATTERNS];

  /** Add a custom detection pattern. */
  addPattern(
    entityType: EntityType,
    regex: RegExp,
    confidence = 0.75,
    validator?: (match: string) => boolean
  ): void {
    this._patterns.push({ entityType, regex, confidence, validator });
  }

  /** Detect all PII entities in ``text``. */
  detect(text: string): DetectedEntity[] {
    const entities: DetectedEntity[] = [];

    for (const pattern of this._patterns) {
      // Reset lastIndex so the regex is reusable across calls
      const re = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g");
      let match: RegExpExecArray | null;

      while ((match = re.exec(text)) !== null) {
        const value = match[0]!;
        if (pattern.validator && !pattern.validator(value)) continue;

        entities.push({
          entityType: pattern.entityType,
          value,
          start: match.index,
          end: match.index + value.length,
          confidence: pattern.confidence,
          layer: "regex",
        });
      }
    }

    return entities;
  }
}
