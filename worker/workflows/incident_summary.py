"""Résume la situation, les impacts et les actions de l’incident à la demande."""

from mistralai import workflows

from worker.model_call import complete_llm
from worker.workflow_types import WORKFLOW_NAMES, LLMRequest, LLMResult


@workflows.workflow.define(
    name=WORKFLOW_NAMES["incident_summary"],
    workflow_display_name="L’AIGUILLEUR · Résumé d’incident",
    workflow_description="Résume la situation, les impacts et les actions de l’incident à la demande.",
)
class IncidentSummaryWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, request: LLMRequest) -> LLMResult:
        return await complete_llm(request, task="incident_summary")
