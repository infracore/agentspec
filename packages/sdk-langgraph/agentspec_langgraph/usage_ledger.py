"""
UsageLedger — in-process token usage counter (Python mirror of TypeScript UsageLedger).

Framework-agnostic, zero-dependency accumulator for LLM token counts.
The agent code calls record() after each LLM call; the reporter drains
the ledger via snapshot(reset=True) on each heartbeat push.

Thread-safe: uses threading.Lock to protect concurrent record() calls
(common in LangGraph agents using ThreadPoolExecutor for tool calls).

Usage:
    ledger = UsageLedger()
    ledger.record("openai/gpt-4o", prompt_tokens=100, completion_tokens=50)
    snapshot = ledger.snapshot(reset=True)  # returns dict, resets counters
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any


# ── Private helpers ───────────────────────────────────────────────────────────


def _create_empty_entry(model_id: str) -> dict[str, Any]:
    return {
        "modelId": model_id,
        "promptTokens": 0,
        "completionTokens": 0,
        "totalTokens": 0,
        "callCount": 0,
    }


def _build_snapshot(
    counters: dict[str, dict[str, Any]],
    window_start: datetime,
) -> dict[str, Any]:
    # Shallow-copy each entry to avoid exposing mutable internal state
    models = [dict(entry) for entry in counters.values()]
    total_tokens = sum(m["totalTokens"] for m in models)
    total_calls = sum(m["callCount"] for m in models)
    return {
        "windowStartedAt": window_start.isoformat(),
        "models": models,
        "totalTokens": total_tokens,
        "totalCalls": total_calls,
    }


# ── Public class ──────────────────────────────────────────────────────────────


class UsageLedger:
    """In-process token usage accumulator.

    Thread-safe. O(1) record(), snapshot returns a dict matching the
    TypeScript UsageSnapshot shape.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, dict[str, Any]] = {}
        self._window_start = datetime.now(timezone.utc)

    def record(
        self,
        model_id: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
    ) -> None:
        """Record token usage for a single LLM call."""
        p = max(0, prompt_tokens)
        c = max(0, completion_tokens)
        with self._lock:
            entry = self._counters.get(model_id)
            if entry is None:
                entry = _create_empty_entry(model_id)
                self._counters[model_id] = entry
            entry["promptTokens"] += p
            entry["completionTokens"] += c
            entry["totalTokens"] += p + c
            entry["callCount"] += 1

    def snapshot(self, reset: bool = True) -> dict[str, Any]:
        """Return a frozen snapshot of the current usage window.

        Args:
            reset: When True (default), clears all counters and starts a new window.
        """
        with self._lock:
            snap = _build_snapshot(self._counters, self._window_start)
            if reset:
                self._counters = {}
                self._window_start = datetime.now(timezone.utc)
        return snap
