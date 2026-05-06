/**
 * Secrets Engine — Layer 1 secrets detection.
 *
 * Detects API keys, tokens, and credentials using high-precision patterns.
 * Runs synchronously with zero dependencies.
 */
import { EntityType } from "../entities.js";
import type { DetectedEntity } from "../result.js";

interface SecretPattern {
  entityType: EntityType;
  regex: RegExp;
  confidence: number;
  /** If true, use capture group 1 to extract just the secret value. */
  useGroup?: boolean;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // JWT
  {
    entityType: EntityType.JWT_TOKEN,
    regex: /\beyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+/g,
    confidence: 0.99,
  },
  // AWS Access Key ID
  {
    entityType: EntityType.AWS_KEY,
    regex: /(?<![A-Z0-9])(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g,
    confidence: 0.99,
  },
  // AWS Secret Access Key (context-anchored)
  {
    entityType: EntityType.AWS_KEY,
    regex: /(?:aws_secret_access_key|aws_secret_key)\s*[=:]\s*["']?([A-Za-z0-9/+]{40})["']?/gi,
    confidence: 0.97,
    useGroup: true,
  },
  // OpenAI API key
  {
    entityType: EntityType.API_KEY,
    regex: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9\-_]{32,}/g,
    confidence: 0.99,
  },
  // Anthropic API key
  {
    entityType: EntityType.API_KEY,
    regex: /\bsk-ant-api\d{2}-[A-Za-z0-9\-_]{32,}/g,
    confidence: 0.99,
  },
  // GitHub token
  {
    entityType: EntityType.OAUTH_TOKEN,
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{36,}/g,
    confidence: 0.99,
  },
  // Stripe API key
  {
    entityType: EntityType.API_KEY,
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/g,
    confidence: 0.99,
  },
  // Slack token
  {
    entityType: EntityType.OAUTH_TOKEN,
    regex: /\bxox[baprs]-[A-Za-z0-9\-]{10,}/g,
    confidence: 0.98,
  },
  // Google API key
  {
    entityType: EntityType.API_KEY,
    regex: /\bAIza[A-Za-z0-9\-_]{35}/g,
    confidence: 0.99,
  },
  // HuggingFace token
  {
    entityType: EntityType.API_KEY,
    regex: /\bhf_[A-Za-z0-9]{30,}/g,
    confidence: 0.98,
  },
  // PEM private key
  {
    entityType: EntityType.PRIVATE_KEY,
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    confidence: 1.0,
  },
  // Database connection strings
  {
    entityType: EntityType.DATABASE_URL,
    regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/[^\s'"]+/gi,
    confidence: 0.95,
  },
  // Generic password assignment
  {
    entityType: EntityType.PASSWORD,
    regex: /(?:password|passwd|pwd|secret)\s*[=:]\s*["']([^"'\s]{6,})["']/gi,
    confidence: 0.80,
    useGroup: true,
  },
  // Bearer token
  {
    entityType: EntityType.OAUTH_TOKEN,
    regex: /(?:Bearer|Authorization:\s*Bearer)\s+([A-Za-z0-9\-_.~+/]{20,}={0,2})/gi,
    confidence: 0.88,
    useGroup: true,
  },
  // Generic API key assignment
  {
    entityType: EntityType.API_KEY,
    regex: /(?:api[_\-]?key|apikey|access[_\-]?token)\s*[=:]\s*["']([A-Za-z0-9\-_.]{16,})["']/gi,
    confidence: 0.75,
    useGroup: true,
  },
  // Generic secret assignment
  {
    entityType: EntityType.SECRET_KEY,
    regex: /(?:secret|private[_\-]?key)\s*[=:]\s*["']([A-Za-z0-9\-_.+/]{16,})["']/gi,
    confidence: 0.72,
    useGroup: true,
  },
  // NPM token
  {
    entityType: EntityType.API_KEY,
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
    confidence: 0.99,
  },
  // Twilio key
  {
    entityType: EntityType.API_KEY,
    regex: /\bSK[a-fA-F0-9]{32}\b/g,
    confidence: 0.92,
  },
];

export class SecretsEngine {
  detect(text: string): DetectedEntity[] {
    const entities: DetectedEntity[] = [];

    for (const pattern of SECRET_PATTERNS) {
      const re = new RegExp(
        pattern.regex.source,
        pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g"
      );
      let match: RegExpExecArray | null;

      while ((match = re.exec(text)) !== null) {
        const fullMatch = match[0]!;
        const value = pattern.useGroup && match[1] ? match[1] : fullMatch;

        // Compute adjusted start/end for captured group
        const valueStart = pattern.useGroup && match[1]
          ? match.index + fullMatch.indexOf(match[1])
          : match.index;

        entities.push({
          entityType: pattern.entityType,
          value,
          start: valueStart,
          end: valueStart + value.length,
          confidence: pattern.confidence,
          layer: "secrets",
        });
      }
    }

    return entities;
  }
}
