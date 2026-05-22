# frozen_string_literal: true

# These specs test the Rack middleware and integration concerns WITHOUT
# requiring a full Rails stack. We stub the minimal interfaces needed.

require "rack"
require "rack/mock"
require "stringio"
require "json"

# Load integrations directly (they only need Rack/stdlib, not Rails).
require_relative "../../lib/prompt_sanitizer/integrations/middleware"
require_relative "../../lib/prompt_sanitizer/integrations/action_controller"

RSpec.describe PromptSanitizer::Integrations::SanitizerMiddleware do
  let(:sanitizer) { PromptSanitizer::Sanitizer.new(mode: :fast) }

  # A minimal Rack app that echoes whatever body it receives.
  let(:echo_app) do
    lambda do |env|
      body = env["rack.input"]&.read || ""
      [200, { "Content-Type" => "application/json" }, [body.empty? ? "{}" : body]]
    end
  end

  def build_middleware(**opts)
    described_class.new(echo_app, sanitizer: sanitizer, **opts)
  end

  def json_request(path: "/chat", method: "POST", body:)
    Rack::MockRequest.env_for(
      path,
      method: method,
      "CONTENT_TYPE" => "application/json",
      input: StringIO.new(JSON.generate(body))
    )
  end

  # ── Basic sanitization ──────────────────────────────────────────────────────

  describe "POST with JSON body" do
    it "sanitizes the 'prompt' key" do
      mw  = build_middleware
      env = json_request(body: { prompt: "Email john@acme.com back" })
      status, _headers, body_parts = mw.call(env)
      parsed = JSON.parse(body_parts.join)
      expect(status).to eq(200)
      expect(parsed["prompt"]).not_to include("john@acme.com")
    end

    it "sanitizes messages[].content (OpenAI style)" do
      mw  = build_middleware
      env = json_request(body: { messages: [{ role: "user", content: "Call 555-867-5309 now" }] })
      _, _, body_parts = mw.call(env)
      parsed = JSON.parse(body_parts.join)
      expect(parsed["messages"][0]["content"]).not_to include("555-867-5309")
    end

    it "sanitizes the 'text' key" do
      original_key = "sk-" + ("a".."z").to_a.cycle.first(48).join
      mw  = build_middleware
      env = json_request(body: { text: "API key: #{original_key}" })
      _, _, body_parts = mw.call(env)
      parsed = JSON.parse(body_parts.join)
      expect(parsed["text"]).not_to include(original_key)
    end

    it "leaves non-PII content untouched" do
      mw  = build_middleware
      env = json_request(body: { prompt: "What is 2 + 2?" })
      _, _, body_parts = mw.call(env)
      parsed = JSON.parse(body_parts.join)
      expect(parsed["prompt"]).to eq("What is 2 + 2?")
    end
  end

  # ── Non-matching requests pass through unchanged ────────────────────────────

  it "passes GET requests through without modification" do
    mw  = build_middleware
    env = Rack::MockRequest.env_for("/chat", method: "GET")
    status, _, _ = mw.call(env)
    expect(status).to eq(200)
  end

  it "passes non-JSON content types through" do
    mw  = build_middleware
    env = Rack::MockRequest.env_for(
      "/chat",
      method: "POST",
      "CONTENT_TYPE" => "text/plain",
      input: StringIO.new("john@acme.com")
    )
    status, _, body_parts = mw.call(env)
    expect(status).to eq(200)
    expect(body_parts.join).to include("john@acme.com")
  end

  it "passes malformed JSON through without error" do
    mw  = build_middleware
    env = Rack::MockRequest.env_for(
      "/chat",
      method: "POST",
      "CONTENT_TYPE" => "application/json",
      input: StringIO.new("not-json{{{")
    )
    expect { mw.call(env) }.not_to raise_error
  end

  # ── Route filtering ──────────────────────────────────────────────────────────

  describe "routes: filtering" do
    it "only sanitizes requests whose path starts with the configured prefix" do
      mw  = build_middleware(routes: ["/api/llm"])
      env = json_request(path: "/other", body: { prompt: "john@acme.com" })
      _, _, body_parts = mw.call(env)
      parsed = JSON.parse(body_parts.join)
      # /other not in routes → passes through unchanged
      expect(parsed["prompt"]).to include("john@acme.com")
    end

    it "sanitizes requests that match the route prefix" do
      mw  = build_middleware(routes: ["/api/llm"])
      env = json_request(path: "/api/llm/chat", body: { prompt: "john@acme.com" })
      _, _, body_parts = mw.call(env)
      parsed = JSON.parse(body_parts.join)
      expect(parsed["prompt"]).not_to include("john@acme.com")
    end
  end

  # ── restore_response ─────────────────────────────────────────────────────────

  describe "restore_response: true" do
    it "deanonymizes string values in JSON response bodies" do
      # App that echoes the sanitized prompt back in the response.
      restore_app = lambda do |env|
        body = env["rack.input"].read
        [200, { "Content-Type" => "application/json" }, [body]]
      end

      mw  = described_class.new(restore_app, sanitizer: sanitizer, restore_response: true)
      env = json_request(body: { prompt: "john@acme.com" })
      _, _, body_parts = mw.call(env)
      restored = JSON.parse(body_parts.join)
      # After restore, the original email should be back in the response.
      expect(restored["prompt"]).to include("john@acme.com")
    end
  end
end

# ── ActionController concern (stubbed) ───────────────────────────────────────

RSpec.describe PromptSanitizer::Integrations::ActionControllerConcern do
  # Minimal stub controller that includes the concern.
  let(:controller_class) do
    Class.new do
      include PromptSanitizer::Integrations::ActionControllerConcern

      attr_accessor :params

      def controller_name = "chat"
      def action_name     = "create"

      def initialize
        @params = {}
      end
    end
  end

  subject(:ctrl) { controller_class.new }

  before do
    ctrl.params = { "message" => "Email john@acme.com for details", "name" => "Alice" }
  end

  describe "#sanitize_params!" do
    it "sanitizes the named param in-place" do
      ctrl.sanitize_params!("message")
      expect(ctrl.params["message"]).not_to include("john@acme.com")
    end

    it "leaves non-named params untouched" do
      ctrl.sanitize_params!("message")
      expect(ctrl.params["name"]).to eq("Alice")
    end

    it "is a no-op for params that are not strings" do
      ctrl.params["count"] = 42
      expect { ctrl.sanitize_params!("count") }.not_to raise_error
    end
  end

  describe "#with_pii_session" do
    it "yields a Session" do
      yielded = nil
      ctrl.with_pii_session { |s| yielded = s }
      expect(yielded).to be_a(PromptSanitizer::Session)
    end

    it "clears the vault after the block" do
      sess_ref = nil
      ctrl.with_pii_session do |s|
        sess_ref = s
        s.anonymize("john@acme.com")
        expect(s.size).to be >= 1
      end
      expect(sess_ref.size).to eq(0)
    end
  end

  describe "#pii_sanitizer" do
    it "returns the global sanitizer by default" do
      expect(ctrl.pii_sanitizer).to be_a(PromptSanitizer::Sanitizer)
    end
  end
end
