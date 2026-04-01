"""Tests for UsageLedger — in-process token usage counter."""

from datetime import datetime, timezone

import pytest

from agentspec_langgraph.usage_ledger import UsageLedger


class TestRecord:
    def test_accumulates_tokens_for_same_model(self):
        ledger = UsageLedger()
        ledger.record("openai/gpt-4o", prompt_tokens=100, completion_tokens=50)
        ledger.record("openai/gpt-4o", prompt_tokens=200, completion_tokens=80)

        snap = ledger.snapshot(reset=False)
        assert len(snap["models"]) == 1
        m = snap["models"][0]
        assert m["modelId"] == "openai/gpt-4o"
        assert m["promptTokens"] == 300
        assert m["completionTokens"] == 130
        assert m["totalTokens"] == 430
        assert m["callCount"] == 2

    def test_tracks_multiple_models_independently(self):
        ledger = UsageLedger()
        ledger.record("openai/gpt-4o", 100, 50)
        ledger.record("anthropic/claude-sonnet-4-6", 200, 80)
        ledger.record("openai/gpt-4o", 50, 20)

        snap = ledger.snapshot(reset=False)
        assert len(snap["models"]) == 2

        by_id = {m["modelId"]: m for m in snap["models"]}
        assert by_id["openai/gpt-4o"]["totalTokens"] == 220
        assert by_id["anthropic/claude-sonnet-4-6"]["totalTokens"] == 280


class TestSnapshot:
    def test_returns_correct_aggregate_totals(self):
        ledger = UsageLedger()
        ledger.record("openai/gpt-4o", 100, 50)
        ledger.record("anthropic/claude-sonnet-4-6", 200, 80)

        snap = ledger.snapshot(reset=False)
        assert snap["totalTokens"] == 430
        assert snap["totalCalls"] == 2

    def test_resets_counters_when_reset_true(self):
        ledger = UsageLedger()
        ledger.record("openai/gpt-4o", 100, 50)

        first = ledger.snapshot(reset=True)
        assert first["totalTokens"] == 150

        second = ledger.snapshot(reset=False)
        assert second["models"] == []
        assert second["totalTokens"] == 0
        assert second["totalCalls"] == 0

    def test_does_not_reset_when_reset_false(self):
        ledger = UsageLedger()
        ledger.record("openai/gpt-4o", 100, 50)
        ledger.snapshot(reset=False)

        snap = ledger.snapshot(reset=False)
        assert snap["totalTokens"] == 150

    def test_window_started_at_resets_after_snapshot_true(self):
        ledger = UsageLedger()
        snap1 = ledger.snapshot(reset=False)
        window1 = snap1["windowStartedAt"]

        ledger.record("openai/gpt-4o", 10, 5)
        ledger.snapshot(reset=True)

        snap2 = ledger.snapshot(reset=False)
        assert datetime.fromisoformat(snap2["windowStartedAt"]) >= datetime.fromisoformat(window1)

    def test_empty_snapshot(self):
        ledger = UsageLedger()
        snap = ledger.snapshot(reset=False)
        assert snap["models"] == []
        assert snap["totalTokens"] == 0
        assert snap["totalCalls"] == 0
        assert "windowStartedAt" in snap

    def test_defaults_reset_to_true(self):
        ledger = UsageLedger()
        ledger.record("openai/gpt-4o", 100, 50)
        ledger.snapshot()  # default reset=True

        snap = ledger.snapshot(reset=False)
        assert snap["totalTokens"] == 0

    def test_window_started_at_is_valid_iso(self):
        ledger = UsageLedger()
        snap = ledger.snapshot(reset=False)
        # Should not raise
        dt = datetime.fromisoformat(snap["windowStartedAt"])
        assert dt.tzinfo is not None  # timezone-aware
