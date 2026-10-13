"""Focused demo checks; no network calls or microphone permissions required."""

import asyncio
import json
import time
from copy import deepcopy
from shutil import copyfile
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.ai_requests import MODEL, AIService, InvalidAIResponse, context_for
from backend.background_tasks import Jobs
from backend.data import DEFAULT_DATA_PATH
from backend.data.schema import KPI_KEYS, DataError, load_document
from backend.server import create_app
from backend.storage import Conflict, Store, find_call
from worker.models import WORKFLOW_NAMES

INCIDENT = "INC-2026-041"
URL = f"/api/incidents/{INCIDENT}"
DOCUMENT = load_document(DEFAULT_DATA_PATH)
KPI_LABELS = {item["key"]: item["label"] for item in DOCUMENT["kpi_definitions"]}


@pytest.fixture
def data_path(tmp_path):
    path = tmp_path / "incidents.json"
    copyfile(DEFAULT_DATA_PATH, path)
    return path


class FakeAI(AIService):
    def __init__(self):
        super().__init__("test-only")
        self.context = None

    async def extract_impact(self, incident):
        source = incident["events"][-1]["id"]
        return [
            {
                "key": key,
                "label": label,
                "value": "2 400" if key == "passengers" else "1",
                "status": "estimated",
                "source": source,
            }
            for key, label in KPI_LABELS.items()
        ]

    async def summarize_call(self, call):
        return "Bilan de l’appel : 2 400 voyageurs ; prochaine étape à confirmer."

    async def summarize_incident(self, incident, related):
        self.context = context_for(incident, related)
        return "Résumé actualisé : 2 400 voyageurs concernés."

    async def chat_incident(self, incident, related, question, history):
        self.context = context_for(incident, related)
        return "Le dernier bilan est disponible dans les communications."

    async def chat_call(self, call, question, history):
        self.context = call["transcript"]
        return "L’appel annonce 2 400 voyageurs."


def wait_ready(client, predicate):
    for _ in range(100):
        incident = client.get(URL).json()
        if predicate(incident):
            return incident
        time.sleep(0.01)
    raise AssertionError("Local workflow did not finish")


def test_data_navigation_validation_and_persistence(data_path):
    path = data_path
    with TestClient(create_app(path, FakeAI())) as client:
        incidents = client.get("/api/incidents").json()["incidents"]
        assert len(incidents) == 4
        assert all(
            incident["status"] == "En cours" and len(incident["impact"]["items"]) == 6
            for incident in incidents
        )
        assert client.get("/").status_code == 200
        assert client.get("/archives/REX-2025-184").status_code == 200
        config = client.get("/api/config").json()
        assert config["model"] == MODEL
        assert config["storage"] == "json"
        assert config["kpi_definitions"] == DOCUMENT["kpi_definitions"]
        assert "test-only" not in json.dumps(client.get("/api/config").json())
        assert (
            client.post(URL + "/messages", json={"content": "   "}).status_code == 422
        )
        assert (
            client.post(URL + "/related", json={"related_ids": [INCIDENT]}).status_code
            == 409
        )
        assert (
            client.post(URL + "/related", json={"related_ids": ["missing"]}).status_code
            == 404
        )
        assert (
            client.post(
                URL + "/related", json={"related_ids": ["INC-2026-042", "INC-2026-042"]}
            ).status_code
            == 422
        )
        assert (
            client.post(
                URL + "/related", json={"related_ids": ["INC-2026-042"]}
            ).status_code
            == 200
        )
        assert (
            client.post(
                URL + "/messages",
                json={"content": "2 400 voyageurs."},
                headers={"Origin": "https://other.example"},
            ).status_code
            == 403
        )
    with TestClient(create_app(path, FakeAI())) as client:
        assert client.get(URL).json()["related_ids"] == ["INC-2026-042"]


def test_message_trigger_manual_summary_and_full_incident_context(data_path):
    ai = FakeAI()
    with TestClient(create_app(data_path, ai)) as client:
        initial = client.get(URL).json()
        added = client.post(
            URL + "/messages", json={"content": "Nouveau bilan : 2 400 voyageurs."}
        ).json()
        assert added["revision"] == initial["revision"] + 1
        assert added["impact"]["status"] == "running"
        ready = wait_ready(
            client, lambda incident: incident["impact"]["status"] == "ready"
        )
        assert ready["impact"]["revision"] == ready["revision"]
        assert ready["impact"]["items"][0]["value"] == "2 400"
        assert ready["summary"] == initial["summary"]
        summary = client.post(URL + "/summary", json={}).json()["incident"]
        assert summary["summary_source"] == "mistral"
        assert summary["summary_revision"] == summary["revision"]
        response = client.post(
            URL + "/chat", json={"question": "Quel est le bilan ?", "history": []}
        )
        assert response.status_code == 200
        context = json.loads(ai.context)
        assert context["header"]["id"] == INCIDENT
        assert (
            context["communications"][-1]["content"]
            == "Nouveau bilan : 2 400 voyageurs."
        )
        assert any(event.get("summary") for event in context["communications"])
        assert context["related_incidents"]


def test_call_summary_then_impact_and_transcript_chat(data_path):
    ai = FakeAI()
    with TestClient(create_app(data_path, ai)) as client:
        result = client.post(
            URL + "/calls", json={"title": "Point de coordination", "synthetic": True}
        ).json()
        call = result["call"]
        call_url = URL + f"/calls/{call['id']}"
        assert call["status"] == "en_cours" and call["synthetic"]
        assert call["transcript"]
        assert (
            client.post(call_url + "/finish", json={"transcript": " "}).status_code
            == 422
        )
        transcript = (
            "00:12 — Alex : 2 400 voyageurs, 15 trains, 4 suppressions ; délai 60 min."
        )
        response = client.post(
            call_url + "/finish",
            json={"transcript": transcript, "duration_seconds": 180},
        )
        assert response.status_code == 200
        ready = wait_ready(
            client,
            lambda incident: (
                find_call(incident, call["id"])["status"] == "termine"
                and incident["impact"]["status"] == "ready"
            ),
        )
        ended = find_call(ready, call["id"])
        assert ended["summary"] and ended["transcript"] == transcript
        assert ended["duration_seconds"] == 180
        assert ready["impact"]["revision"] == ready["revision"]
        assert (
            client.post(
                call_url + "/finish", json={"transcript": transcript}
            ).status_code
            == 409
        )
        assert (
            client.post(
                call_url + "/chat", json={"question": "Quel bilan ?"}
            ).status_code
            == 200
        )
        assert ai.context == transcript
        new_call = client.post(URL + "/calls", json={"synthetic": False}).json()["call"]
        assert client.post(URL + "/calls", json={"synthetic": False}).status_code == 409
        cancelled = client.post(URL + f"/calls/{new_call['id']}/cancel", json={}).json()
        assert find_call(cancelled, new_call["id"])["status"] == "annule"


def test_ai_unavailable_keeps_data_and_recovers_interrupted_work(data_path):
    path = data_path
    with TestClient(create_app(path, AIService(""))) as client:
        assert client.get("/api/config").json()["ai_available"] is False
        client.post(URL + "/messages", json={"content": "Message conservé hors ligne."})
        failed = wait_ready(
            client, lambda incident: incident["impact"]["status"] == "error"
        )
        assert failed["events"][-1]["content"] == "Message conservé hors ligne."
        assert "MISTRAL_API_KEY" in failed["impact"]["error"]
        assert client.post(URL + "/summary", json={}).status_code == 503
        call = client.post(URL + "/calls", json={"synthetic": False}).json()["call"]
        client.post(
            URL + f"/calls/{call['id']}/finish",
            json={"transcript": "Transcription conservée."},
        )
        failed = wait_ready(
            client,
            lambda incident: find_call(incident, call["id"])["status"] == "error",
        )
        assert find_call(failed, call["id"])["transcript"] == "Transcription conservée."
        client.app.state.store.update(
            INCIDENT, lambda incident: incident["impact"].update(status="running")
        )
    with TestClient(create_app(path, FakeAI())) as client:
        assert client.get(URL).json()["impact"]["status"] == "error"
        client.post(URL + "/impact", json={})
        wait_ready(client, lambda incident: incident["impact"]["status"] == "ready")
        client.post(
            URL + f"/calls/{call['id']}/finish",
            json={"transcript": "Transcription conservée."},
        )
        wait_ready(
            client,
            lambda incident: find_call(incident, call["id"])["status"] == "termine",
        )


def test_impact_workflow_discards_stale_revision(data_path):
    async def scenario():
        first_started, release = asyncio.Event(), asyncio.Event()

        class SlowAI(FakeAI):
            count = 0

            async def extract_impact(self, incident):
                self.count += 1
                if self.count == 1:
                    first_started.set()
                    await release.wait()
                return await super().extract_impact(incident)

        store, ai = Store(data_path), SlowAI()
        jobs = Jobs(store, ai)
        try:
            jobs.start_impact(INCIDENT)
            await first_started.wait()
            store.update(
                INCIDENT,
                lambda incident: incident.update(revision=incident["revision"] + 1),
            )
            jobs.start_impact(INCIDENT)
            release.set()
            await asyncio.gather(*jobs.tasks)
            latest = store.get(INCIDENT)
            assert latest["impact"]["revision"] == latest["revision"]
            assert ai.count == 2
        finally:
            await jobs.close()

    asyncio.run(scenario())


def test_json_is_live_backbone_and_shared_defaults(data_path):
    document = load_document(data_path)
    document["operator"]["name"] = "Opérateur de test"
    document["call_defaults"]["title"] = "Point JSON"
    document["synthetic_call"]["transcript"] = (
        "00:00 — {operator_name} : 3 000 voyageurs, confirmé par {incident_owner}."
    )
    document["kpi_definitions"][0]["label"] = "Voyageurs concernés"
    data_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with TestClient(create_app(data_path, FakeAI())) as client:
        document = load_document(data_path)
        document["incidents"][0]["title"] = "Titre modifié directement en JSON"
        document["incidents"][0]["revision"] += 1
        document["incidents"].append(
            {**deepcopy(document["incidents"][-1]), "id": "INC-2026-045"}
        )
        data_path.write_text(
            json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        assert client.get(URL).json()["title"] == "Titre modifié directement en JSON"
        assert len(client.get("/api/incidents").json()["incidents"]) == 5
        assert (
            client.get("/api/config").json()["kpi_definitions"][0]["label"]
            == "Voyageurs concernés"
        )
        result = client.post(URL + "/calls", json={"synthetic": True}).json()
        call = result["call"]
        assert call["title"] == "Point JSON"
        assert call["author"] == "Opérateur de test"
        assert "3 000 voyageurs" in call["transcript"]
        assert "Giuliana Ferrandi" in call["transcript"]
        client.post(
            URL + "/messages", json={"content": "Message conservé dans le JSON."}
        )
        ready = wait_ready(
            client, lambda incident: incident["impact"]["status"] == "ready"
        )
        saved = load_document(data_path)
        assert (
            saved["incidents"][0]["events"][-1]["content"]
            == "Message conservé dans le JSON."
        )
        assert ready["events"][-1]["author"] == "Opérateur de test"
        assert (
            find_call(saved["incidents"][0], call["id"])["transcript"]
            == call["transcript"]
        )
        assert saved["synthetic_call"] == document["synthetic_call"]


def test_json_validation_preserves_invalid_file_and_rejects_conflicts(
    data_path, tmp_path
):
    store = Store(data_path)
    previous = data_path.read_bytes()
    with pytest.raises(DataError):
        store.update(
            INCIDENT, lambda incident: incident.update(related_ids=["missing"])
        )
    assert data_path.read_bytes() == previous
    assert not list(data_path.parent.glob(".*.tmp"))

    def edit_during_update(incident):
        external = load_document(data_path)
        external["incidents"][1]["title"] = "Modification concurrente conservée"
        data_path.write_text(json.dumps(external, ensure_ascii=False), encoding="utf-8")
        incident["title"] = "Modification à refuser"

    with pytest.raises(Conflict):
        store.update(INCIDENT, edit_during_update)
    assert Store(data_path).all()[1]["title"] == "Modification concurrente conservée"
    assert store.get(INCIDENT)["title"] != "Modification à refuser"
    assert not list(data_path.parent.glob(".*.tmp"))
    with pytest.raises(DataError):
        Store(tmp_path / "missing.json")
    assert not (tmp_path / "missing.json").exists()
    data_path.write_text('{"incidents":', encoding="utf-8")
    invalid = data_path.read_bytes()
    with pytest.raises(DataError):
        store.get(INCIDENT)
    assert data_path.read_bytes() == invalid


def test_all_llm_requests_run_through_named_workflows(data_path):
    starts = []
    document = load_document(data_path)
    document["kpi_definitions"][0]["label"] = "Libellé personnalisé JSON"
    data_path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    incident = deepcopy(document["incidents"][0])
    items = [
        {"key": key, "value": "1", "status": "confirmed", "source": "EVT-041-04"}
        for key in KPI_LABELS
    ]

    results = {}
    polls = []

    class FakeExecutions:
        async def get_workflow_execution_async(self, execution_id, **kwargs):
            polls.append(execution_id)
            if polls.count(execution_id) == 1:
                return SimpleNamespace(status="RUNNING", result=None)
            return SimpleNamespace(status="COMPLETED", result=results[execution_id])

    class FakeWorkflows:
        executions = FakeExecutions()

        async def execute_workflow_async(self, **kwargs):
            starts.append(kwargs)
            content = (
                json.dumps({"items": items})
                if kwargs["workflow_identifier"] == "aiguilleur-impact-extraction"
                else "Réponse de test."
            )
            results[kwargs["execution_id"]] = {
                "task": next(
                    task
                    for task, name in WORKFLOW_NAMES.items()
                    if name == kwargs["workflow_identifier"]
                ),
                "model": MODEL,
                "content": content,
            }
            return SimpleNamespace(execution_id=kwargs["execution_id"])

    async def scenario():
        ai = AIService("test-only", deployment_name="demo-deployment")
        ai._client = SimpleNamespace(workflows=FakeWorkflows())
        ai.data_path = data_path
        await ai.summarize_incident(incident, [])
        await ai.summarize_call(incident["events"][2])
        await ai.chat_incident(incident, [], "Bilan ?", [])
        await ai.chat_call(incident["events"][2], "Actions ?", [])
        result = await ai.extract_impact(incident)
        assert len(result) == len(KPI_KEYS)
        assert result[0]["label"] == "Libellé personnalisé JSON"
        assert [start["workflow_identifier"] for start in starts] == [
            "aiguilleur-incident-summary",
            "aiguilleur-call-summary",
            "aiguilleur-incident-assistant",
            "aiguilleur-call-assistant",
            "aiguilleur-impact-extraction",
        ]
        assert all(set(start["input"]) == {"messages"} for start in starts)
        assert len({start["execution_id"] for start in starts}) == len(starts)
        assert set(polls) == set(results)
        assert all(start["deployment_name"] == "demo-deployment" for start in starts)
        extraction_context = json.loads(starts[-1]["input"]["messages"][-1]["content"])
        assert all(
            event.get("status") != "en_cours"
            for event in extraction_context["communications"]
        )
        items[0]["source"] = "invented-event"
        with pytest.raises(InvalidAIResponse):
            await ai.extract_impact(incident)

    asyncio.run(scenario())


def test_named_workflows_use_the_plugin_and_are_all_discovered(monkeypatch):
    from mistralai.workflows import WorkflowError, execute_workflow
    from mistralai.workflows.core.definition.workflow_definition import (
        get_workflow_definition,
    )
    from pydantic import ValidationError

    from worker import llm
    from worker.models import LLMRequest
    from worker.start import discover_workflows

    discovered = discover_workflows()
    by_name = {get_workflow_definition(cls).name: cls for cls in discovered}
    assert len(discovered) == 5
    assert set(by_name) == set(WORKFLOW_NAMES.values())
    seen = []
    mode = "success"

    async def fake_chat_complete(params):
        seen.append(params)
        message = SimpleNamespace(
            content=[
                SimpleNamespace(type="thinking", thinking=[]),
                SimpleNamespace(type="text", text="Résumé du workflow."),
            ]
        )
        choices = [SimpleNamespace(finish_reason="stop", message=message)]
        if mode == "empty":
            choices = []
        elif mode == "truncated":
            choices[0].finish_reason = "length"
        elif mode == "blank":
            message.content = " "
        return SimpleNamespace(model=params.model, choices=choices)

    monkeypatch.setattr(
        llm.workflows_mistralai, "mistralai_chat_complete", fake_chat_complete
    )
    messages = [
        {"role": "system", "content": "Consignes"},
        {"role": "user", "content": "Données"},
        {"role": "assistant", "content": "Réponse précédente"},
    ]
    request = LLMRequest(messages=messages)
    # Callers cannot turn an assistant into another task or change output mode.
    with pytest.raises(ValidationError):
        LLMRequest(messages=messages, task="impact", structured=True)

    async def scenario():
        nonlocal mode
        for task, name in WORKFLOW_NAMES.items():
            result = await asyncio.wait_for(
                execute_workflow(by_name[name], params=request), timeout=15
            )
            assert result.task == task
            assert result.model == MODEL and result.content == "Résumé du workflow."
            completion = seen[-1]
            assert completion.model == MODEL
            assert completion.reasoning_effort == "none"
            assert completion.max_tokens == llm.MAX_TOKENS_BY_TASK[task]
            if task == "impact":
                assert completion.response_format.type == "json_object"
            else:
                assert completion.response_format is None
            assert [type(m).__name__ for m in completion.messages] == [
                "SystemMessage",
                "UserMessage",
                "AssistantMessage",
            ]
        for failure_mode in ("empty", "truncated", "blank"):
            mode = failure_mode
            with pytest.raises(WorkflowError):
                await asyncio.wait_for(
                    execute_workflow(
                        by_name[WORKFLOW_NAMES["call_summary"]], params=request
                    ),
                    timeout=15,
                )

    asyncio.run(scenario())


def test_compact_prompts_preserve_full_context_and_chat_history():
    from backend import prompts

    incident = deepcopy(DOCUMENT["incidents"][0])
    related = [DOCUMENT["incidents"][2]]
    context = json.loads(prompts.context_for(incident, related))
    assert context["communications"] == incident["events"]
    assert context["header"]["description"] == incident["description"]
    assert context["incident_summary"] == incident["summary"]
    assert context["impact"] == incident["impact"]
    assert context["similar_past_incidents"] == incident["history"]
    assert context["related_incidents"][0]["summary"] == related[0]["summary"]
    history = [
        {"role": "user", "content": "Question précédente"},
        {"role": "assistant", "content": "Réponse précédente"},
    ]
    messages = prompts.incident_chat_messages(
        incident, related, "Et maintenant ?", history
    )
    assert messages[-3:-1] == history
    assert messages[-1]["content"] == "Et maintenant ?"
    assert "80 mots maximum" in messages[0]["content"]
