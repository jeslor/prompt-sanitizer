# frozen_string_literal: true

module PromptSanitizer
  module Integrations
    # ActionController concern — adds PII sanitization helpers to controllers.
    #
    # Include in ApplicationController or a specific controller:
    #
    #   class ApplicationController < ActionController::Base
    #     include PromptSanitizer::Integrations::ActionControllerConcern
    #   end
    #
    # Then in any action:
    #
    #   # Sanitize specific params in-place before using them:
    #   def create
    #     sanitize_params!(:message, :prompt)
    #     call_llm(params[:message])
    #   end
    #
    #   # Multi-turn session scoped to one action (vault cleared after block):
    #   def chat
    #     with_pii_session do |sess|
    #       clean    = sess.anonymize(params[:message])
    #       response = call_llm(clean)
    #       render json: { reply: sess.deanonymize(response) }
    #     end
    #   end
    module ActionControllerConcern
      # Sanitize one or more param keys in-place.
      #
      # @param keys [Array<Symbol, String>] param keys whose string values
      #   should be sanitized. Nested paths not supported (flatten first).
      # @return [void]
      def sanitize_params!(*keys)
        keys.flatten.each do |key|
          next unless params[key].is_a?(String)

          result = pii_sanitizer.sanitize(params[key])
          params[key] = result.text
        end
      end

      # Yield a Session scoped to this action's PII vault.
      # The vault is always cleared after the block, even on exception.
      #
      # @yieldparam session [PromptSanitizer::Session]
      # @return the block's return value
      def with_pii_session(session_id: nil, &block)
        id = session_id || "#{controller_name}##{action_name}"
        pii_sanitizer.session(session_id: id, &block)
      end

      # The Sanitizer instance used by this controller.
      # Defaults to the global PromptSanitizer.sanitizer.
      # Override in a controller to use a custom instance.
      #
      # @return [PromptSanitizer::Sanitizer]
      def pii_sanitizer
        PromptSanitizer.sanitizer
      end
    end
  end
end
