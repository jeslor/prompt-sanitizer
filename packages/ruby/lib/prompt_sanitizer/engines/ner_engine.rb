# frozen_string_literal: true

module PromptSanitizer
  module Engines
    # NER Engine — Layer 2 of prompt-sanitizer (SMART / FULL mode only).
    #
    # Detects context-dependent PII that regex cannot catch: person names,
    # organisations, locations, and miscellaneous named entities.
    #
    # Two backends are supported:
    #
    #   :informers — uses the `informers` gem with Xenova/distilbert-NER or
    #                Xenova/bert-base-NER (ONNX int8).  F1 92.17.  ~25–50 ms.
    #                Model auto-downloaded to ~/.cache/huggingface/ on first use.
    #                Recommended default.
    #
    #   :mitie     — uses the `mitie` gem with the MITIE C++ NER model.
    #                F1 88.10.  ~2 ms.  Requires separate model download (~600 MB).
    #                Use when sub-5 ms latency is required.
    #
    # Both backends are optional runtime dependencies.  When neither gem is
    # installed, NEREngine#available? returns false and #detect returns [].
    # The Sanitizer falls back to FAST mode silently in this case.
    #
    # Thread safety: both ONNX Runtime sessions and MITIE models are immutable
    # after loading — safe to share across Puma threads.
    class NEREngine
      # Maximum number of characters per chunk when splitting long prompts.
      # distilbert / bert-base have a 512 subword-token limit; ~300 words
      # ≈ 1,800 characters is a safe conservative ceiling.
      CHUNK_SIZE    = 1_800
      CHUNK_OVERLAP = 200  # overlap between chunks to avoid edge-case misses

      # BIO tag → EntityType mapping (CoNLL-2003 schema)
      TAG_MAP = {
        "PER"  => EntityType::PERSON,
        "ORG"  => EntityType::ORGANIZATION,
        "LOC"  => EntityType::LOCATION,
        "MISC" => EntityType::MISC,
      }.freeze

      # ── Construction ────────────────────────────────────────────────────────

      # @param backend [Symbol]  :informers (default) or :mitie
      # @param model   [String]  "distilbert" (default) or "bert-base" for
      #                          the informers backend; path to ner_model.dat
      #                          for the mitie backend.
      def initialize(backend: :informers, model: "distilbert")
        @backend = backend
        @model   = model
        @pipeline = nil
        @mutex    = Mutex.new
        _load_backend
      end

      # Returns true when the chosen backend gem is installed and the model
      # is ready to use.
      def available?
        !@pipeline.nil?
      end

      # Detect named entities in +text+ and return Array<DetectedEntity>.
      # Returns [] immediately when the backend is unavailable.
      #
      # Long texts are automatically chunked and results are merged.
      def detect(text)
        return [] unless available?

        safe_text = text.encode("UTF-8", invalid: :replace, undef: :replace, replace: "")
        return [] if safe_text.strip.empty?

        if safe_text.length > CHUNK_SIZE
          _detect_chunked(safe_text)
        else
          _detect_single(safe_text)
        end
      rescue => e
        # Never let NER failures break the sanitizer — degrade gracefully.
        warn "[PromptSanitizer] NER error (#{@backend}): #{e.message}"
        []
      end

      # ── Private ─────────────────────────────────────────────────────────────

      private

      def _load_backend
        case @backend
        when :informers then _load_informers
        when :mitie     then _load_mitie
        else
          raise ConfigurationError, "Unknown NER backend: #{@backend.inspect}. Use :informers or :mitie."
        end
      end

      # ── informers backend ────────────────────────────────────────────────────

      def _load_informers
        require "informers"

        model_id = case @model
                   when "distilbert" then "Xenova/distilbert-NER"
                   when "bert-base"  then "Xenova/bert-base-NER"
                   else @model  # allow fully-qualified HuggingFace model IDs
                   end

        # Load once and memoize — thread-safe after initialization.
        @pipeline     = Informers.pipeline("ner", model_id, dtype: "int8")
        @backend_type = :informers
      rescue LoadError
        # informers gem not installed — NER silently unavailable.
        @pipeline = nil
      rescue => e
        warn "[PromptSanitizer] Failed to load informers NER model: #{e.message}"
        @pipeline = nil
      end

      # ── mitie backend ────────────────────────────────────────────────────────

      def _load_mitie
        require "mitie"

        model_path = @model == "distilbert" || @model == "bert-base" ? nil : @model
        model_path ||= ENV.fetch("MITIE_MODEL_PATH", "ner_model.dat")

        unless File.exist?(model_path)
          warn "[PromptSanitizer] MITIE model not found at #{model_path}. " \
               "Download from https://github.com/mit-nlp/MITIE/releases"
          @pipeline = nil
          return
        end

        @pipeline     = Mitie::NER.new(model_path)
        @backend_type = :mitie
      rescue LoadError
        @pipeline = nil
      rescue => e
        warn "[PromptSanitizer] Failed to load MITIE NER model: #{e.message}"
        @pipeline = nil
      end

      # ── Detection ────────────────────────────────────────────────────────────

      def _detect_single(text)
        case @backend_type
        when :informers then _informers_detect(text, offset: 0)
        when :mitie     then _mitie_detect(text, offset: 0)
        else []
        end
      end

      # Split long text into overlapping chunks, detect in each, then merge.
      # Entities whose start_pos falls in the overlap zone of a later chunk
      # are deduplicated by (original, start_pos) pair.
      def _detect_chunked(text)
        entities = []
        seen     = {}
        pos      = 0

        while pos < text.length
          chunk      = text[pos, CHUNK_SIZE]
          chunk_hits = _detect_single(chunk).map do |e|
            DetectedEntity.new(
              entity_type: e.entity_type,
              original:    e.original,
              replacement: nil,
              start_pos:   e.start_pos + pos,
              end_pos:     e.end_pos   + pos,
              confidence:  e.confidence,
              layer:       :ner
            )
          end

          chunk_hits.each do |e|
            key = "#{e.original}:#{e.start_pos}"
            next if seen[key]

            seen[key] = true
            entities << e
          end

          pos += CHUNK_SIZE - CHUNK_OVERLAP
        end

        entities
      end

      # ── informers result parsing ─────────────────────────────────────────────

      # informers returns BIO-tagged word pieces; merge consecutive I- tags
      # back into a single span.
      def _informers_detect(text, offset:)
        raw = @pipeline.(text)
        return [] if raw.nil? || raw.empty?

        entities  = []
        current   = nil

        Array(raw).each do |token|
          tag_raw = token[:entity] || token["entity"] || ""
          word    = token[:word]   || token["word"]   || ""
          score   = (token[:score] || token["score"] || 0.0).to_f
          t_start = (token[:start] || token["start"] || 0).to_i
          t_end   = (token[:end]   || token["end"]   || 0).to_i

          # Parse BIO prefix and base tag
          bio, tag = tag_raw.split("-", 2)
          entity_type = TAG_MAP[tag]
          next if entity_type.nil?

          if bio == "B" || (bio == "I" && current.nil?)
            # Flush previous entity
            entities << _build_entity(current, text) if current
            current = { type: entity_type, start: t_start, end: t_end, score: score, tokens: [word] }

          elsif bio == "I" && current && current[:type] == entity_type
            # Continue current entity — extend span
            current[:end]    = t_end
            current[:score]  = [current[:score], score].min  # conservative: use lowest
            current[:tokens] << word

          else
            # Tag changed mid-sequence — flush and start fresh
            entities << _build_entity(current, text) if current
            current = nil
          end
        end

        entities << _build_entity(current, text) if current
        entities.compact
      end

      def _build_entity(data, text)
        return nil if data.nil?

        raw_value = text[data[:start]...data[:end]]
        return nil if raw_value.nil? || raw_value.strip.empty?

        DetectedEntity.new(
          entity_type: data[:type],
          original:    raw_value.strip,
          replacement: nil,
          start_pos:   data[:start],
          end_pos:     data[:end],
          confidence:  data[:score],
          layer:       :ner
        )
      end

      # ── MITIE result parsing ─────────────────────────────────────────────────

      def _mitie_detect(text, offset:)
        doc = @pipeline.doc(text)
        doc.entities.filter_map do |entity|
          tag         = entity[:tag]&.upcase
          entity_type = TAG_MAP[tag]
          next unless entity_type

          value = entity[:text]
          next if value.nil? || value.strip.empty?

          # MITIE provides character offset via :offset
          char_start = entity[:offset] || text.index(value) || 0
          char_end   = char_start + value.length

          DetectedEntity.new(
            entity_type: entity_type,
            original:    value.strip,
            replacement: nil,
            start_pos:   char_start,
            end_pos:     char_end,
            confidence:  (entity[:score] || 0.80).to_f.clamp(0.0, 1.0),
            layer:       :ner
          )
        end
      end
    end
  end
end
