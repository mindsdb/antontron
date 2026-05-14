"""Selected harness registry."""

from __future__ import annotations

from .anton_provider import AntonHarnessProvider
from .config import selected_harness_id
from .hermes_provider import HermesHarnessProvider
from .nanoclaw_provider import NanoclawHarnessProvider


_ANTON = AntonHarnessProvider()
_HERMES = HermesHarnessProvider()
_NANOCLAW = NanoclawHarnessProvider()


def active_harness_id() -> str:
    return selected_harness_id()


def get_active_harness():
    return get_harness_by_id(active_harness_id())


def get_harness_by_id(harness_id: str):
    if harness_id == "hermes":
        return _HERMES
    if harness_id == "nanoclaw":
        return _NANOCLAW
    return _ANTON


def list_harnesses():
    return [_ANTON, _HERMES, _NANOCLAW]
