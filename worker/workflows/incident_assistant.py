"""Répond aux questions à partir de tout le contexte de l’incident."""

from mistralai import workflows

from worker.model_call import complete_llm
from worker.workflow_types import WORKFLOW_NAMES, LLMRequest, LLMResult


@workflows.workflow.define(
    name=WORKFLOW_NAMES["incident_chat"],
    workflow_display_name="L’AIGUILLEUR · Assistant incident",
    workflow_description="Répond aux questions à partir de tout le contexte de l’incident.",
)
class IncidentAssistantWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, request: LLMRequest) -> LLMResult:
        return await complete_llm(request, task="incident_chat")
