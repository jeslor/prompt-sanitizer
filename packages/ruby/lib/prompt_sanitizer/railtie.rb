# frozen_string_literal: true

module PromptSanitizer
  # Rails::Railtie — hooks prompt-sanitizer into the Rails boot process.
  #
  # Loaded automatically when Rails is present (detected in prompt_sanitizer.rb).
  # Exposes a configuration namespace under +config.prompt_sanitizer+
  # so Rails apps can tune the gem from an initializer without monkey-patching.
  #
  # Generated initializer (from +rails g prompt_sanitizer:install+)::
  #
  #   PromptSanitizer.configure do |c|
  #     c.mode        = :smart
  #     c.locale      = "en"
  #     c.audit_log   = :memory
  #   end
  #
  # Middleware (optional)::
  #
  #   config.prompt_sanitizer.middleware = true          # all routes
  #   config.prompt_sanitizer.middleware_routes = ["/api/llm", "/chat"]
  #   config.prompt_sanitizer.restore_response  = false
  class Railtie < Rails::Railtie
    # Expose a config object on the Rails::Application config.
    config.prompt_sanitizer = ActiveSupport::OrderedOptions.new
    config.prompt_sanitizer.middleware        = false
    config.prompt_sanitizer.middleware_routes = nil
    config.prompt_sanitizer.restore_response  = false

    # After all initializers run, insert middleware if requested.
    initializer "prompt_sanitizer.insert_middleware", after: :load_config_initializers do |app|
      cfg = app.config.prompt_sanitizer
      if cfg.middleware
        require_relative "integrations/middleware"
        app.middleware.use(
          PromptSanitizer::Integrations::SanitizerMiddleware,
          sanitizer:        PromptSanitizer.sanitizer,
          routes:           cfg.middleware_routes,
          restore_response: cfg.restore_response
        )
      end
    end
  end
end
