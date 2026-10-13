.PHONY: start-worker execute installdeps lint format typecheck lint-workflows check start-examples execute-insurance-claims execute-cargo-release execute-code-modernization docker-build docker-run

IMAGE ?= workflow-worker
PROJECT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: demo test-demo

## Start the web server (backend + frontend) on http://127.0.0.1:8000
demo:
	uv run --project "$(PROJECT_DIR)" python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000

## Run the tests (no Mistral requests)
test-demo:
	uv run --project "$(PROJECT_DIR)" pytest "$(PROJECT_DIR)tests/test_incidents.py" -q

## Install dependencies
installdeps:
	uv sync

## Lint and format-check backend, worker and tests with ruff
lint:
	uv run ruff check backend/ worker/ tests/
	uv run ruff format --check backend/ worker/ tests/

## Auto-format backend, worker and tests and apply ruff autofixes
format:
	uv run ruff format backend/ worker/ tests/
	uv run ruff check --fix backend/ worker/ tests/

## Type-check backend and worker with mypy
typecheck:
	uv run mypy backend/ worker/ --follow-untyped-imports

## Lint workflows for determinism / I/O / structure issues (semgrep, advisory)
lint-workflows:
	uv run semgrep --config .agents/skills/workflows/scripts/linting/rules/ --quiet worker/workflows/

## Run all checks: ruff lint, mypy types, and workflow lint
check: lint typecheck lint-workflows

## Start the worker: runs worker/workflows/ and restarts on file changes
start-worker:
	uv run python -m worker.start_with_reload

## Build the worker image — the same Dockerfile Mistral Cloud builds
docker-build:
	docker build -t $(IMAGE) .

## Run the worker image locally, passing your .env values as container env vars
docker-run:
	docker run --rm --env-file .env $(IMAGE)

## Trigger a workflow execution
## Usage: make execute workflow=aiguilleur-incident-assistant input='{"messages": [{"role": "user", "content": "Bonjour"}]}'
execute:
	uv run python -m worker.run_workflow $(if $(workflow),--workflow $(workflow),) $(if $(input),--input '$(input)',)

## Start a worker that loads only the example workflows
start-examples:
	uv run python -m examples.worker

## Start a worker that loads all example workflows, including linear-weekly-summary
## Requires the Linear connector to be enabled and configured in AI Studio
start-examples-all:
	INCLUDE_LINEAR=1 uv run python -m examples.worker

## Execute the insurance-claims-triage example workflow
## Usage: make execute-insurance-claims input='{"claim_id": "CLM-001", "claimant_name": "Jane", "description": "My car was hit.", "photos": ["examples/insurance_claims/sample_data/photos/claim_low_scratch_door.jpg"]}'
execute-insurance-claims:
	uv run python -m worker.run_workflow --workflow insurance-claims-triage $(if $(input),--input '$(input)',--input '{"claim_id":"CLM-2024-001","claimant_name":"Maria Gonzalez","description":"My car was T-boned at an intersection.","photos":["examples/insurance_claims/sample_data/photos/claim_high_totaled_front.jpg","examples/insurance_claims/sample_data/photos/claim_high_totaled_side.jpg"]}')

## Execute the cargo-release-compliance example workflow
## Usage: make execute-cargo-release input='{"document_uri": "...", "shipment_id": "..."}'
execute-cargo-release:
	uv run python -m worker.run_workflow --workflow cargo-release-compliance $(if $(input),--input '$(input)',--input '{"document_uri":"examples/cargo_release/sample_data/shipping_doc_normal.png","shipment_id":"BL-2024-HAM-009371"}')

## Execute the code-modernization example workflow
## Usage: make execute-code-modernization input='{"repo_path": "...", "target": "Python 2.7 → 3.12"}'
execute-code-modernization:
	uv run python -m worker.run_workflow --workflow code-modernization $(if $(input),--input '$(input)',--input '{"repo_path":"examples/code_modernization/sample_data/legacy_repo","target":"Python 2.7 → 3.12"}')

## Execute the linear-weekly-summary example workflow
## Usage (team name): make execute-linear-summary input='{"team":"Engineering","project":"Roadmap"}'
## Usage (team ID): make execute-linear-summary input='{"team":"<team-uuid>","project":"Roadmap"}'
## Usage (all projects): make execute-linear-summary input='{"team":"Engineering","project":"*"}'
## Params: team/project are optional; omit input for interactive selection.
execute-linear-summary:
	uv run python -m worker.run_workflow --workflow linear-weekly-summary $(if $(input),--input '$(input)',--input '{}')
