# frozen_string_literal: true

# Stub — full implementation coming in Step 7
module PromptSanitizer
  class Session
    def initialize(sanitizer, session_id: nil)
      @sanitizer  = sanitizer
      @session_id = session_id
      @vault      = Vault.new
    end

    def anonymize(text) = text
    def deanonymize(text) = text
    def reset = @vault.clear
  end
end
