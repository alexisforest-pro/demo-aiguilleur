"""Résume les faits, décisions et actions d’un appel terminé."""

from mistralai import workflows

from worker.llm import complete_llm
from worker.models import WORKFLOW_NAMES, LLMRequest, LLMResult


@workflows.workflow.define(
    name=WORKFLOW_NAMES["call_summary"],
    workflow_display_name="L’AIGUILLEUR · Résumé d’appel",
    workflow_description="Résume les faits, décisions et actions d’un appel terminé.",
)
class CallSummaryWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, request: LLMRequest) -> LLMResult:
        return await complete_llm(request, task="call_summary")
