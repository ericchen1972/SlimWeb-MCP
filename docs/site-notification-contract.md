# site.notification contract

One webhook event, filtered by required site_code, covering order creation and return requests only. Resolve names using slimweb_sites_list. Subscription does not select a global current site. Identity is authenticated actor/site/callback; duplicate renewals update the same subscription. Different chats/admins have independent callback identities.

MCP methods: server/discover, events/list, events/subscribe, events/unsubscribe. Modern per-request protocol 2026-07-28 emits resultType complete and serverInfo metadata. Existing initialized clients retain 2025-03-26 transport negotiation in the same handler.

Subscribe params follow OpenAI's webhook contract, with arguments `{site_code}`, a public HTTPS delivery URL and whsec_ key decoding to 24–64 bytes. Default lifetime 24 hours, maximum 7 days; ttlMs null is granted a finite 24-hour lifetime. CallbackEndpointError maps to -32015. No replay: cursor null and truncated false. Reconnect/expiry can miss events; accepted webhook is not proof of ChatGPT processing.

Laravel stores subscriptions and encrypted outbox bodies. Order observers record within the business transaction. Product snapshots are filled after commit before first delivery; retries preserve the finalized exact body/eventId and get fresh signature timestamps. Standard Webhooks HMAC SHA256 signing, short challenge verification, public DNS pinning, no redirects, max 256 KiB request and 64 KiB response. Secret rotation signs with both keys for 5 minutes. Retry up to 8 attempts with exponential delay; 410 deactivates subscription, 413 and other permanent client errors terminate the receipt.

The event definition and discovery instructions tell the host to display only, in the user's language, and wait for a later explicit user instruction. This is host instruction, not a server-enforced prohibition on all model tool calls. No tools are invoked by the event handler to perform business actions. No OS notification guarantee is made.

Deploy order: migrate SaaS and Standalone backends; configure SaaS private scheduler POST /internal/scheduler/notifications every minute or Standalone schedule:run cron; release Core immutable tag and install both gateways; restart/rescan plugin; verify in an actual ChatGPT Work Cloud chat. Standalone requires site_notifications_v1 and a Domain-bound OAuth session. Bridge scope is exact POST events/subscribe or events/unsubscribe with matching method label and backend_ai_assistant permission.

Acceptance: subscribe twice, create order, request return, verify chat output without tool activity; later request an order operation; cancel and verify stop. Also verify website isolation, owner revocation, expiry, callback challenge/signature and failed delivery retries. Cloud responses and UI acceptance require the deployed account and actual subscription.

Subscription refresh, cancellation and dispatch share an atomic subscription lock. Busy refresh/cancel returns SUBSCRIPTION_BUSY (503); retry shortly. Use a shared lock-capable cache across backend replicas. A cancellation cannot retract a webhook already delivered. Reopened returns receive a fresh occurrence identity even when the business request timestamp is retained.
