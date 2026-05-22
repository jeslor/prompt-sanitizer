# frozen_string_literal: true

module PromptSanitizer
  module Integrations
    # ActiveJob concern — sanitize job arguments before the job is enqueued.
    #
    # Prevents PII from leaking into job queues (Sidekiq, Resque, GoodJob, etc.)
    # where job arguments are serialized and often stored in plain text.
    #
    # == Usage
    #
    #   class SummarizeJob < ApplicationJob
    #     include PromptSanitizer::Integrations::ActiveJobConcern
    #     sanitize_argument :prompt
    #
    #     def perform(prompt:)
    #       # `prompt` is already sanitized here
    #       call_llm(prompt)
    #     end
    #   end
    #
    # == How it works
    #
    # +sanitize_argument+ registers an +around_perform+ callback that sanitizes
    # the named keyword argument(s) before +perform+ is called and restores them
    # in the job's return context if needed.
    #
    # The original PII never touches the queue backend — the redacted version is
    # enqueued and the job works with sanitized text.
    module ActiveJobConcern
      extend ActiveSupport::Concern

      included do
        # Class-level list of keyword argument names to sanitize.
        class_attribute :_pii_sanitized_arguments, default: []
      end

      class_methods do
        # Declare which keyword arguments should be sanitized before perform.
        #
        # @param args [Array<Symbol>] keyword argument names
        def sanitize_argument(*args)
          self._pii_sanitized_arguments = _pii_sanitized_arguments | args.map(&:to_sym)

          around_perform do |job, block|
            sanitizer = PromptSanitizer.sanitizer
            session   = sanitizer.session(session_id: job.job_id)

            # Sanitize the declared keyword arguments in job_data / arguments.
            # ActiveJob stores keyword args as the last Hash element in arguments.
            kwargs = job.arguments.last
            if kwargs.is_a?(Hash)
              _pii_sanitized_arguments.each do |key|
                str_key = key.to_s
                if kwargs[key].is_a?(String)
                  kwargs[key] = session.anonymize(kwargs[key])
                elsif kwargs[str_key].is_a?(String)
                  kwargs[str_key] = session.anonymize(kwargs[str_key])
                end
              end
            end

            block.call
          ensure
            session&.reset
          end
        end
      end

      # Manually sanitize a string using the global sanitizer.
      #
      # @param text [String]
      # @return [String] sanitized text
      def sanitize_pii(text)
        PromptSanitizer.sanitizer.sanitize(text).text
      end
    end
  end
end
