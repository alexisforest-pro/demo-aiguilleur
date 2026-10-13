"""Extrait les six KPI de l’incident au format JSON à partir des communications."""

from mistralai import workflows

from worker.model_call import complete_llm
from worker.workflow_types import WORKFLOW_NAMES, LLMRequest, LLMResult


@workflows.workflow.define(
    name=WORKFLOW_NAMES["impact"],
    workflow_display_name="L’AIGUILLEUR · Extraction des impacts",
    workflow_description="Extrait les six KPI de l’incident au format JSON à partir des communications.",
)
class ImpactExtractionWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, request: LLMRequest) -> LLMResult:
        return await complete_llm(request, task="impact", structured=True)
