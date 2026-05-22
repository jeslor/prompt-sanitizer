# frozen_string_literal: true

require "rails/generators"

module PromptSanitizer
  module Generators
    # Generates a prompt_sanitizer initializer.
    #
    # Usage:
    #   rails g prompt_sanitizer:install
    #
    # Creates:
    #   config/initializers/prompt_sanitizer.rb
    class InstallGenerator < Rails::Generators::Base
      source_root File.expand_path("templates", __dir__)

      desc "Creates a PromptSanitizer initializer in config/initializers/."

      def create_initializer
        template "initializer.rb", "config/initializers/prompt_sanitizer.rb"
      end

      def show_instructions
        say ""
        say "✅  prompt_sanitizer initializer created.", :green
        say ""
        say "Next steps:", :bold
        say "  1. Review config/initializers/prompt_sanitizer.rb"
        say "  2. Choose a mode: :fast (default), :smart (+ NER), or :full (+ audit log)"
        say "  3. For :smart/:full mode, add to your Gemfile:"
        say '       gem "informers", ">= 1.3"   # downloads distilbert-NER (~66 MB on first run)'
        say ""
        say "  Full docs: https://github.com/jeslor/prompt-sanitizer/tree/main/packages/ruby"
        say ""
      end
    end
  end
end
