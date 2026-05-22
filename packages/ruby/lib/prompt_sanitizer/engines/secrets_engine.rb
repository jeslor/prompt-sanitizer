# frozen_string_literal: true

module PromptSanitizer
  module Engines
    # Secrets Engine — Layer 1 of prompt-sanitizer (secrets branch).
    #
    # Detects credentials, API keys, tokens, and connection strings that should
    # never reach an LLM. Runs alongside the RegexEngine on every sanitize() call.
    class SecretsEngine
      Pattern = Struct.new(:entity_type, :regex, :confidence, :label, keyword_init: true)

      PATTERNS = [
        # ── JWT (header.payload.signature) ────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::JWT,
          regex:       /eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/,
          confidence:  0.99,
          label:       "JWT"
        ),

        # ── Bearer token ──────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::BEARER_TOKEN,
          regex:       /(?:Authorization\s*:\s*)?Bearer\s+([a-zA-Z0-9_\-\.]{20,})/i,
          confidence:  0.92,
          label:       "Bearer token"
        ),

        # ── AWS Access Key ID ──────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::AWS_ACCESS_KEY,
          regex:       /(?<![A-Z0-9])(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/,
          confidence:  0.99,
          label:       "AWS access key ID"
        ),

        # ── AWS Secret Access Key (context-anchored) ───────────────────────────
        Pattern.new(
          entity_type: EntityType::AWS_SECRET_KEY,
          regex:       /(?:aws_secret(?:_access)?_key|secret_access_key)\s*[=:"'\s]\s*([a-zA-Z0-9+\/]{40})/i,
          confidence:  0.97,
          label:       "AWS secret access key"
        ),

        # ── OpenAI API key ─────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /sk-(?:proj-|org-)?[a-zA-Z0-9_\-T]{20,}/,
          confidence:  0.97,
          label:       "OpenAI API key"
        ),

        # ── Anthropic API key ──────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /sk-ant-(?:api\d{2}-)?[a-zA-Z0-9_\-]{20,}/,
          confidence:  0.99,
          label:       "Anthropic API key"
        ),

        # ── GitHub Personal Access Token (classic) ─────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /ghp_[a-zA-Z0-9]{36}/,
          confidence:  0.99,
          label:       "GitHub PAT (classic)"
        ),

        # ── GitHub Fine-grained PAT ────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /github_pat_[a-zA-Z0-9_]{82}/,
          confidence:  0.99,
          label:       "GitHub fine-grained PAT"
        ),

        # ── GitHub OAuth / server-to-server / refresh ──────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /(?:gho|ghs|ghr)_[a-zA-Z0-9]{36}/,
          confidence:  0.99,
          label:       "GitHub OAuth/server token"
        ),

        # ── Slack tokens ───────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /xox[baprs]-(?:[0-9a-zA-Z]{4,}-)+[0-9a-zA-Z]{4,}/,
          confidence:  0.98,
          label:       "Slack token"
        ),

        # ── Stripe secret / publishable key ───────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}/,
          confidence:  0.99,
          label:       "Stripe API key"
        ),

        # ── Twilio Account SID ─────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /AC[a-f0-9]{32}/,
          confidence:  0.90,
          label:       "Twilio Account SID"
        ),

        # ── Twilio Auth Token ──────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /(?:auth_token|TWILIO_AUTH_TOKEN)\s*[=:"'\s]\s*([a-f0-9]{32})/i,
          confidence:  0.97,
          label:       "Twilio Auth Token"
        ),

        # ── Google API key ─────────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /AIza[0-9A-Za-z_\-]{35}/,
          confidence:  0.99,
          label:       "Google API key"
        ),

        # ── SendGrid API key ───────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /SG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43}/,
          confidence:  0.99,
          label:       "SendGrid API key"
        ),

        # ── Mailchimp API key ──────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /[a-f0-9]{32}-us\d{1,2}/,
          confidence:  0.90,
          label:       "Mailchimp API key"
        ),

        # ── HuggingFace token ──────────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /hf_[a-zA-Z0-9]{34,}/,
          confidence:  0.99,
          label:       "HuggingFace token"
        ),

        # ── PEM private key header ─────────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::PRIVATE_KEY,
          regex:       /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/,
          confidence:  0.99,
          label:       "PEM private key"
        ),

        # ── Database connection strings ────────────────────────────────────────
        Pattern.new(
          entity_type: EntityType::DB_CONNECTION,
          regex:       /(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|mssql|sqlserver|oracle|clickhouse|cassandra|couchdb|neo4j):\/\/[^\s'"`<>\n]{8,}/i,
          confidence:  0.97,
          label:       "Database connection string"
        ),

        # ── Generic secret assignment (SECRET_KEY=..., api_key: '...') ─────────
        Pattern.new(
          entity_type: EntityType::API_KEY,
          regex:       /(?:secret[_\-]?key|api[_\-]?key|access[_\-]?token|auth[_\-]?token|private[_\-]?key|client[_\-]?secret)\s*[=:"'\s]+\s*([a-zA-Z0-9_\-\.+\/]{16,})/i,
          confidence:  0.80,
          label:       "Generic secret assignment"
        ),
      ].freeze

      # ── Instance ─────────────────────────────────────────────────────────────

      def initialize
        @patterns = PATTERNS.dup
      end

      # Register a custom secret pattern at runtime.
      def add_pattern(entity_type, regex, label: "custom secret", confidence: 0.85)
        @patterns << Pattern.new(
          entity_type: entity_type,
          regex:       regex,
          confidence:  confidence,
          label:       label
        )
      end

      # Scan +text+ for secrets and return an Array of DetectedEntity.
      # When the pattern has a capturing group, the captured value and its
      # offsets are used; otherwise the full match is used.
      def detect(text)
        safe_text = text.encode("UTF-8", invalid: :replace, undef: :replace, replace: "")
        entities  = []

        @patterns.each do |pat|
          safe_text.scan(pat.regex) do
            m = Regexp.last_match

            # Use capture group 1 when present (strips surrounding context)
            if m.captures.any?
              value     = m[1]
              start_pos = m.begin(1)
              end_pos   = m.end(1)
            else
              value     = m[0]
              start_pos = m.begin(0)
              end_pos   = m.end(0)
            end

            next if value.nil? || value.empty?

            entities << DetectedEntity.new(
              entity_type: pat.entity_type,
              original:    value,
              replacement: nil,
              start_pos:   start_pos,
              end_pos:     end_pos,
              confidence:  pat.confidence,
              layer:       :secrets
            )
          end
        end

        entities
      end
    end
  end
end
