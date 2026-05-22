# frozen_string_literal: true

module PromptSanitizer
  module Integrations
    # Rack middleware — auto-sanitizes incoming JSON request bodies.
    #
    # Intercepts POST/PUT/PATCH requests with Content-Type: application/json
    # and sanitizes the following payload keys before they reach the app:
    #
    # - +messages[*].content+  (OpenAI / Anthropic / LangChain style)
    # - +prompt+, +input+, +inputs+, +text+, +query+
    #
    # The sanitized body is written back into the Rack env so that
    # downstream controllers see clean payloads with no raw PII.
    #
    # Optionally, if +restore_response: true+, the middleware deanonymizes
    # JSON response bodies using the same session vault before sending them
    # to the client.
    #
    # == Usage (manually)
    #
    #   use PromptSanitizer::Integrations::SanitizerMiddleware,
    #       sanitizer: PromptSanitizer.sanitizer,
    #       routes:    ["/api/llm"],
    #       restore_response: false
    #
    # == Usage (via Railtie config)
    #
    #   config.prompt_sanitizer.middleware        = true
    #   config.prompt_sanitizer.middleware_routes = ["/api/llm"]
    class SanitizerMiddleware
      # Keys in a flat JSON body whose string values are sanitized.
      BODY_KEYS = %w[prompt input inputs text query message content].freeze

      # @param app              [#call]    next Rack app
      # @param sanitizer        [Sanitizer] defaults to PromptSanitizer.sanitizer
      # @param routes           [Array<String>, nil] path prefixes to match (nil = all)
      # @param restore_response [Boolean]  deanonymize JSON response? (default false)
      def initialize(app, sanitizer: nil, routes: nil, restore_response: false)
        @app     = app
        @san     = sanitizer || PromptSanitizer.sanitizer
        @routes  = routes ? Array(routes) : nil
        @restore = restore_response
      end

      def call(env)
        req = Rack::Request.new(env)

        session = nil

        if should_process?(req)
          session = _sanitize_request(req)
        end

        status, headers, body = @app.call(env)

        if session && @restore
          status, headers, body = _restore_response(status, headers, body, session)
        end

        [status, headers, body]
      end

      private

      def should_process?(req)
        return false unless %w[POST PUT PATCH].include?(req.request_method)
        return false unless req.content_type&.include?("application/json")

        return true if @routes.nil?

        @routes.any? { |r| req.path.start_with?(r) }
      end

      def _sanitize_request(req)
        raw = req.body.read
        req.body.rewind
        return nil if raw.nil? || raw.empty?

        begin
          payload = JSON.parse(raw)
        rescue JSON::ParserError
          return nil
        end

        session = @san.session
        _sanitize_payload!(payload, session)

        # Write the sanitized body back so downstream sees clean params.
        sanitized_raw = JSON.generate(payload)
        env = req.env
        env["rack.input"]      = StringIO.new(sanitized_raw)
        env["CONTENT_LENGTH"]  = sanitized_raw.bytesize.to_s
        # Invalidate any already-parsed params cache.
        env.delete("rack.request.form_hash")
        env.delete("rack.request.form_input")

        session
      rescue StandardError
        nil
      end

      def _sanitize_payload!(obj, session)
        case obj
        when Hash
          # messages array (OpenAI / LangChain style)
          if obj["messages"].is_a?(Array)
            obj["messages"].each do |msg|
              next unless msg.is_a?(Hash) && msg["content"].is_a?(String)

              msg["content"] = session.anonymize(msg["content"])
            end
          end

          BODY_KEYS.each do |key|
            obj[key] = session.anonymize(obj[key]) if obj[key].is_a?(String)
          end
        when Array
          obj.each { |item| _sanitize_payload!(item, session) }
        end
      end

      def _restore_response(status, headers, body, session)
        content_type = headers["Content-Type"] || headers["content-type"] || ""
        return [status, headers, body] unless content_type.include?("application/json")

        raw = +""
        body.each { |chunk| raw << chunk }

        begin
          obj      = JSON.parse(raw)
          restored = _restore_obj(obj, session)
          new_body = JSON.generate(restored)
          headers["Content-Length"] = new_body.bytesize.to_s
          [status, headers, [new_body]]
        rescue JSON::ParserError
          [status, headers, [raw]]
        end
      ensure
        body.close if body.respond_to?(:close)
      end

      def _restore_obj(obj, session)
        case obj
        when String then session.deanonymize(obj)
        when Hash   then obj.transform_values { |v| _restore_obj(v, session) }
        when Array  then obj.map { |v| _restore_obj(v, session) }
        else             obj
        end
      end
    end
  end
end
