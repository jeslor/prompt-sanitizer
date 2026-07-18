/**
 * Synthetic replacement engine.
 *
 * Generates realistic-looking fake values for each EntityType so that
 * redacted prompts remain semantically coherent for the LLM.
 *
 * Uses @faker-js/faker when available; falls back to [TYPE_N] placeholders.
 */
import { EntityType } from "./entities.js";

let _faker: any = null;

async function _getFaker(): Promise<any> {
  if (_faker) return _faker;
  try {
    const { faker } = await import("@faker-js/faker");
    _faker = faker;
    return faker;
  } catch {
    return null;
  }
}

/**
 * Anything that can hand out the next placeholder index for an entity type.
 * `Vault` satisfies this structurally — passing a vault into `generate()`
 * scopes counters to that vault/session instead of this engine instance,
 * which is what makes a vault's state fully self-contained and safe to
 * persist/restore independently of other sessions.
 */
export interface CounterSource {
  nextCount(entityType: string): number;
}

/** Counter per entity type within a single engine instance. */
export class SyntheticEngine {
  // Fallback counters, used only when no CounterSource (vault) is passed to
  // generate() — kept for direct/standalone callers of SyntheticEngine.
  private readonly _counters = new Map<EntityType, number>();

  private _next(type: EntityType, counters?: CounterSource): number {
    if (counters) return counters.nextCount(type);
    const n = (this._counters.get(type) ?? 0) + 1;
    this._counters.set(type, n);
    return n;
  }

  private _placeholder(type: EntityType, counters?: CounterSource): string {
    return `[${type}_${this._next(type, counters)}]`;
  }

  /** Generate a fake replacement for the given entity type. */
  async generate(type: EntityType, counters?: CounterSource): Promise<string> {
    const faker = await _getFaker();
    if (!faker) return this._placeholder(type, counters);

    const n = this._next(type, counters);
    // Store counter before async ops so we can use it in sync fallbacks
    switch (type) {
      case EntityType.EMAIL:
        return faker.internet.email();
      case EntityType.PHONE:
        return faker.phone.number({ style: "national" });
      case EntityType.SSN:
        return `${_rnd(100, 899)}-${_rnd(10, 99)}-${_rnd(1000, 9999)}`;
      case EntityType.CREDIT_CARD:
        return _fakeLuhnCard();
      case EntityType.IBAN:
        return `GB${_rnd(10, 99)}FAKE${_rnd(10000000, 99999999)}${_rnd(10000000, 99999999)}`;
      case EntityType.IP_ADDRESS:
        return `${_rnd(1, 254)}.${_rnd(0, 254)}.${_rnd(0, 254)}.${_rnd(1, 254)}`;
      case EntityType.MAC_ADDRESS:
        return Array.from({ length: 6 }, () =>
          Math.floor(Math.random() * 256)
            .toString(16)
            .padStart(2, "0")
        ).join(":");
      case EntityType.URL:
        return faker.internet.url();
      case EntityType.DATE_OF_BIRTH:
        return faker.date
          .birthdate({ min: 18, max: 90, mode: "age" })
          .toISOString()
          .slice(0, 10);
      case EntityType.PERSON_NAME:
        return faker.person.fullName();
      case EntityType.LOCATION:
        return faker.location.city();
      case EntityType.ORGANIZATION:
        return faker.company.name();
      case EntityType.API_KEY:
      case EntityType.SECRET_KEY:
      case EntityType.OAUTH_TOKEN:
        return `[REDACTED_KEY_${n}]`;
      case EntityType.JWT_TOKEN:
        return `[REDACTED_JWT_${n}]`;
      case EntityType.PRIVATE_KEY:
        return `[REDACTED_PRIVATE_KEY_${n}]`;
      case EntityType.DATABASE_URL:
        return `[REDACTED_DB_URL_${n}]`;
      case EntityType.AWS_KEY:
        return `[REDACTED_AWS_KEY_${n}]`;
      case EntityType.PASSWORD:
        return `[REDACTED_PASSWORD_${n}]`;
      case EntityType.CRYPTO_ADDRESS:
        return `[REDACTED_WALLET_${n}]`;
      default:
        return `[${type}_${n}]`;
    }
  }

  /** Synchronous fallback — always returns a placeholder token. */
  placeholder(type: EntityType): string {
    return this._placeholder(type);
  }

  reset(): void {
    this._counters.clear();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _rnd(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Generate a Luhn-valid fake Visa card number. */
function _fakeLuhnCard(): string {
  const digits = [4];
  for (let i = 0; i < 14; i++) digits.push(_rnd(0, 9));

  // Calculate Luhn check digit
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i]!;
    if ((digits.length - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  digits.push(check);

  // Format as XXXX XXXX XXXX XXXX
  return [0, 4, 8, 12]
    .map((i) => digits.slice(i, i + 4).join(""))
    .join(" ");
}
