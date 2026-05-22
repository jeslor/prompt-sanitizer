# frozen_string_literal: true

# Stub — full implementation coming in Step 7
module PromptSanitizer
  class Sanitizer
    def initialize(**_opts); end

    def sanitize(text)
      SanitizeResult.new(text: text, original: text, entities: [])
    end

    def session(session_id: nil)
      Session.new(self, session_id: session_id)
    end
  end
end
