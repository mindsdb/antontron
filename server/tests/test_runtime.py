from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from anton_api import projects_store
from runtime.conversations import CoworkConversationStore
from runtime.events import (
    cowork_event_to_legacy_sse,
    iter_sse_payloads,
    normalize_legacy_payload,
)
from runtime.schemas import (
    CoworkMessage,
    HarnessReadiness,
    HarnessTurnRequest,
    ProjectContext,
    ResolvedInferenceProfile,
)


class RuntimeSchemaTests(unittest.TestCase):
    def test_legacy_delta_event_round_trips_to_responses_sse(self) -> None:
        event = normalize_legacy_payload(
            {"type": "response.output_text.delta", "delta": "hello", "sequence_number": 1},
            "turn_1",
        )

        self.assertEqual(event.type, "response.delta")
        self.assertEqual(event.payload["delta"], "hello")

        emitted = cowork_event_to_legacy_sse(event)
        payloads = iter_sse_payloads(emitted)
        self.assertEqual(payloads[0][0], "response.output_text.delta")
        self.assertEqual(payloads[0][1]["delta"], "hello")

    def test_request_and_readiness_models_serialize(self) -> None:
        profile = ResolvedInferenceProfile(
            provider_type="minds-cloud",
            provider_label="MindsHub",
            planning_model="_reason_",
            coding_model="_code_",
        )
        request = HarnessTurnRequest(
            conversation_id="conv_1",
            turn_id="turn_1",
            messages=[CoworkMessage(role="user", content="Hi")],
            user_input="Hi",
            project_context=ProjectContext(id="general", name="general", path="/tmp/general"),
            inference=profile,
            artifact_root="/tmp/general/artifacts",
        )
        ready = HarnessReadiness.ok()

        self.assertTrue(ready.model_dump()["ready"])
        self.assertEqual(request.model_dump()["inference"]["planning_model"], "_reason_")

    def test_tool_and_artifact_progress_normalize(self) -> None:
        tool = normalize_legacy_payload(
            {
                "type": "response.in_progress",
                "phase": "tool",
                "progress_status": "completed",
                "tool_name": "browser_navigate",
                "message": "browser_navigate complete",
            },
            "turn_1",
        )
        artifact = normalize_legacy_payload(
            {
                "type": "response.in_progress",
                "phase": "artifact",
                "progress_status": "completed",
                "artifact": {"title": "Deck", "path": "/tmp/deck.pptx"},
            },
            "turn_1",
        )

        self.assertEqual(tool.type, "tool.completed")
        self.assertEqual(tool.payload["tool_name"], "browser_navigate")
        self.assertEqual(artifact.type, "artifact.created")
        self.assertEqual(artifact.payload["artifact"]["title"], "Deck")


class CoworkConversationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_projects_dir = os.environ.get("ANTON_PROJECTS_DIR")
        os.environ["ANTON_PROJECTS_DIR"] = str(Path(self.tmp.name) / "projects")
        projects_store.ensure_general_project()

    def tearDown(self) -> None:
        if self.old_projects_dir is None:
            os.environ.pop("ANTON_PROJECTS_DIR", None)
        else:
            os.environ["ANTON_PROJECTS_DIR"] = self.old_projects_dir
        self.tmp.cleanup()

    def test_store_reloads_messages_and_events_from_cowork_state(self) -> None:
        store = CoworkConversationStore()
        profile = ResolvedInferenceProfile(
            provider_type="minds-cloud",
            provider_label="MindsHub",
            planning_model="_reason_",
            coding_model="_code_",
        )
        conv = store.create(project="general", harness="hermes", inference=profile, title="Hello")
        conv = store.append_message(conv, CoworkMessage(role="user", content="Hello"))
        user_message = conv.messages[-1]
        conv, turn, _assistant = store.start_turn(conv, user_message.id)
        event = normalize_legacy_payload(
            {"type": "response.output_text.delta", "delta": "Hi there"},
            turn.id,
        )
        store.append_event(conv, turn.id, event)
        store.finish_turn(conv, turn.id, "completed")

        reloaded = store.get(conv.id)
        self.assertIsNotNone(reloaded)
        messages = store.display_messages(reloaded)
        self.assertEqual(messages[-1]["role"], "assistant")
        self.assertEqual(messages[-1]["content"], "Hi there")
        self.assertEqual(reloaded.harness, "hermes")


if __name__ == "__main__":
    unittest.main()
