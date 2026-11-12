# Deployment runtime preservation

The workflow deploys only the newly built image digest; it does not reset environment variables, Secret Manager bindings, runtime settings or IAM. An existing configured service is required. Missing required authentication settings (including assertion issuer/public keys and the human approval Google client ID) stop deployment; only setting names are reported.

Each run uses its own revision suffix and candidate tag. The candidate image and complete environment must match the intended digest and preserved runtime. Candidate readiness and the externally reachable `/readyz` endpoint must return HTTP success and JSON `ok: true`, `status: ready`, `service: slimweb-mcp` before SaaS traffic moves to that exact immutable revision. Standalone stays candidate-only. Successful promotion removes only that run’s candidate tag, preserving other tags. No workflow uses a moving latest-revision traffic target. A failed candidate remains at zero traffic for investigation; existing traffic is retained. Workflow concurrency prevents overlapping deployment runs. These checks validate readiness, not business transactions.

Bootstrap or runtime configuration changes are separate authorized operations. Secrets must not be copied into workflow files or logs. Required secret references are checked for presence; successful container startup/health validates that Cloud Run can resolve them.

The deployment probe intentionally uses `/readyz` only. Google’s external edge can return an HTML 404 for `/healthz` even when the local application route exists. A non-success response or invalid readiness JSON still blocks promotion.
