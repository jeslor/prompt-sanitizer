# frozen_string_literal: true

# Stub — full implementation coming in Step 5
module PromptSanitizer
  class SyntheticEngine
    def generate(entity_type, _original)
      "[#{entity_type.to_s.upcase}_STUB]"
    end
  end
end
