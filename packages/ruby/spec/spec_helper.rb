# frozen_string_literal: true

require "bundler/setup"
require "prompt_sanitizer"

RSpec.configure do |config|
  config.expect_with :rspec do |c|
    c.syntax = :expect
  end

  # Reset global PromptSanitizer state between tests
  config.before(:each) { PromptSanitizer.reset! }
end
