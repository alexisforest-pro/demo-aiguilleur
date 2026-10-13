"""Répond aux questions à partir de la transcription et du résumé d’un appel."""

from mistralai import workflows

from worker.model_call import complete_llm
from worker.workflow_types import WORKFLOW_NAMES, LLMRequest, LLMResult


@workflows.workflow.define(
    name=WORKFLOW_NAMES["call_chat"],
    workflow_display_name="L’AIGUILLEUR · Assistant appel",
    workflow_description="Répond aux questions à partir de la transcription et du résumé d’un appel.",
)
class CallAssistantWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, request: LLMRequest) -> LLMResult:
        return await complete_llm(request, task="call_chat")
