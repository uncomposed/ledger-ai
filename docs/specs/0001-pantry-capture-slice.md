# Spec 0001: Pantry capture slice

Status: draft, revised 2026-10-26. Nothing is implemented yet.

Notation: "(read)" means I read it in code. "(inferred)" means I concluded it and did not verify it.

## 1. Goal, architecture and non-goals

Goal: a photo of a pantry shelf, from any source, becomes a per-item proposed inventory change. A human accepts, rejects or edits each line, applies, and inventory updates. Outside agents can propose through MCP but can never apply.

Architecture (decided by Cole):
1. Ledger is a server plus a human app for reviewing and managing. Tracks can come from any source: Capture Quick, iOS Shortcuts or photo apps, agents, and custom sensors such as a fridge camera that shoots on every door open.
2. Capture Quick (a separate Expo app, at Documents/GitHub/Capture_Quick) stays separate. It is the first client of the public ingest contract in section 6. This spec defines the contract and what its "Ledger destination" must do, not its code. It already has a generic webhook delivery service (inferred from Cole's description; I did not read that repo).
3. The Ledger phone app (apps/mobile) is the review, approve and manage client. It can also capture, but is not required to.

Non-goals: offline sync, recurrence and chores, assets, meal planning, web UI, policy-editing UI.

## 2. User journey

1. A source sends a photo of a shelf: Capture Quick, a Shortcut, or a sensor. It names a Location, or leaves it for a human.
2. The server stores the Track. A capture with no Location waits in the inbox until Cole assigns one.
3. When the ChangeSet exists, it appears in the approval queue in the Ledger app.
4. Cole sees one card per line: add, adjust, or mark gone, with confidence and evidence text.
5. He accepts, rejects or edits each line, then taps Apply. The app shows which lines were applied.

Every step traces to a Task: the lens creates it, the ChangeSet hangs off it, and the apply event carries its id.

Ledger app needs: Clerk sign-in; Locations; inbox, approval queue and per-line review; decisions sent with the proposal hash; build number and git sha shown. Capturing is optional and uses the ingest contract.

## 3. Acceptance journeys

Journey A, automated, fake LLM:
1. Seed an entity, an admin, a Pantry Location, two InventoryItems, and a Source with an ingest token.
2. With the token, POST one multipart request to /v1/tracks/upload with an Idempotency-Key and the location.
3. Run the worker once. Expect one LensRun succeeded, one Task, one ChangeSet pending_approval with three lines.
4. As the admin, apply with line 0 accepted, line 1 edited to quantity 4, line 2 rejected.
5. Expect two InventoryMutation rows, item versions bumped, the third item unchanged, events in the outbox then the event log, and the policy version recorded on the approval.
6. Repeat the apply call. Expect 200 and no new rows. Repeat the upload with the same key. Expect the same Track and no second LensRun.

Journey B, stale proposal: create a ChangeSet with an adjust line, change that InventoryItem through another path, then apply. Expect 409 listing the stale line, and no mutations.

Journey C, agent and policy:
1. Mint a propose-scoped token for an agent Source and one location.
2. Call propose_change. Expect a pending ChangeSet proposed by the agent Actor.
3. Try a call outside the location. Expect a denial.
4. Call apply with the agent token. Expect 403, even if the creator is admin.
5. Approve as admin under the default policy. Expect the approval to name the policy version.

Journey C2, an agent cannot loosen policy for itself:
1. The agent proposes a policy adding auto_apply for its own Source. Expect a pending policy ChangeSet.
2. Approve it with that token, then with a second agent token. Expect 403 both times, the active version unchanged, nothing auto-applied.
3. A human admin approves. Expect a new active version, the old one still readable.

Journey D, real device, one identifiable build:
1. Make one Ledger app build and one Capture Quick build with the Ledger destination. Record build numbers and git shas.
2. On Cole's iPhone, with a real Clerk account and the API reachable, send a real shelf photo from Capture Quick and review it in the Ledger app.
3. Write the build ids, Track id, ChangeSet id and result into the verification log.
4. Cole compares the shelf to the inventory list. Only he can mark this human_validated.

Journey E, failures at the door: bad token, revoked Source, unrouted capture, over-budget capture (section 10).

## 4. Data model: what exists and what is missing

What the schema already gives us (read):
1. Track plus TrackAttachment with storageKey, LensRun with a unique key per (track, lens), Task, ChangeSet with a version, InventoryItem with a version counter, and InventoryMutation unique on (changeSetId, opIndex). That last one is what makes replay safe.
2. Actor has types human, ai, system. AuthIdentity maps outside identities to Actors.

Gaps:
1. No per-line decisions or partial apply. ChangeSet.patch is one JSON blob, and state is whole-set only.
2. inventory.delta.v1 takes resource_id and a delta only, so it cannot express the lines.
3. The apply route takes only expected_version (read). No proposal hash or row-version check.
4. Track has no location, source, device timestamps or idempotency key. Location lives in free-form context JSON, which POST /tracks does not accept (read).
5. POST /tracks hard-codes the image lens to image_stub_v1 (read). UploadsProvider cannot read bytes back.
6. can() takes a role, not an actor type (read). Nothing stops an ai Actor with admin from changeset:apply (inferred).
7. No GET /locations or GET /changesets/:id. No source or token model, and ActorType has no app or sensor value.
8. ChangeSet has one approvedByActorId (read), so "N approvers" needs a table.
9. No policy storage, value field, LensRun cost fields, or deferred state (LensRunStatus is queued, running, succeeded, failed; read).
10. InventoryItem.quantity is a nullable Decimal(18,6) and unit a nullable string (read). Nullable quantity already fits presence, but there is no quantityKind column.

Proposed migration (one, additive; nothing dropped or renamed):
1. ActorType gets app and sensor (agent stays ai).
2. Source: id, entityId, actorId, name, kind, allowedLocationIds, monthlyBudgetCents, perCaptureMaxCents, createdByActorId, revokedAt.
3. SourceToken: id, sourceId, tokenHash, scopes (ingest, read, propose; never apply), expiresAt, revokedAt, lastUsedAt, createdByActorId.
4. Track gets sourceId, idempotencyKey, capturedAt, receivedAt, deviceMeta (JSON), locationId, locationHint, routingState (routed, unrouted). Unique on (sourceId, idempotencyKey).
5. ChangeSetLine: changeSetId, lineIndex, op, resource id or key plus name, inventoryItemId, baseVersion, baseQuantity, proposedQuantity, quantityKind, unit, confidence, evidence, estimatedCents, decision (pending, accepted, rejected, edited), editedQuantity, decidedByActorId, decidedAt. Unique on (changeSetId, lineIndex).
6. ChangeSet gets locationId, proposalHash, approvedHash, approvedPatch, origin (lens or agent), sourceId, estimatedCents, policyVersionId.
7. ChangeSetApproval: changeSetId, approverActorId, role, policyVersionId, createdAt. Needed for N approvers.
8. ApprovalPolicy: entityId, version, rules (JSON), isActive, createdByActorId, createdAt. Versions are immutable. A partial unique index allows one active row per entity.
9. LensRun gets modelId, inputTokens, outputTokens, estimatedCostCents, and status deferred_budget.
10. InventoryItem gets quantityKind, default count. Quantity and unit stay as they are.
11. Patch handler inventory.reconcile.v1. Per ADR 0003, inventory.delta.v1 stays untouched. Lines are absolute: add creates at q, adjust sets to q, gone sets to 0, presence uses 1 and 0. The handler writes a delta mutation equal to the difference, with opIndex = lineIndex.
12. Patch handler policy.replace.v1 (section 5).

Decisions reach the handler this way: apply stores them on the lines, builds approvedPatch from accepted and edited lines, and applyChangeSet passes approvedPatch (falling back to patch). Some lines accepted gives applied. All rejected gives rejected. No new ChangeSetState value.

## 5. Approval policy as versioned data

An ApprovalPolicy belongs to one entity. Each version is immutable. One version is active. Rules are an ordered list. The first match wins. The last rule is the default.

Match conditions (all optional, all must hold): change type or patch type, source id or source kind, proposer actor type, location, line count, and estimated value in cents.

Effects: require one approver with role X; require a specific actor (or one of a list); require N approvers; auto_apply.

Default shipped in this slice: every ChangeSet needs one admin approval. No auto_apply. This matches today's can.ts, where changeset:apply is admin only (read).

Honest limit: pantry lines have no money value yet. Value rules only match once estimated cost exists on a Resource or a line. Until then estimatedCents is null and such a rule never matches (inferred; null is not zero).

Authoring format, loaded by a script in this slice (UI editing and agent editing come later):

```yaml
rules:
  - name: small pantry fixes from named members
    match: { patch_type: inventory.reconcile.v1, max_value_cents: 10000 }
    effect: { require_actor_in: [cole, household_member_2] }
  - name: fridge camera limited to one actor
    match: { source_id: fridge-cam }
    effect: { require_actor: cole }
  - name: default
    match: {}
    effect: { require_role: admin, approvers: 1 }
```

The first rule reads "under $100 is OK for these members". The second limits that Source's changes to a single actor.

Safety rules:
1. A change to the policy is itself a ChangeSet (patch type policy.replace.v1). Only a human admin can approve it. It is never auto-applied, whatever the rules say.
2. An agent or any Source can propose a policy change but cannot approve one.
3. Each approval records the policy version that allowed it (ChangeSetApproval.policyVersionId).
4. can() needs the actor type as an input so rules 1 and 2 hold in code, not only in policy data (today it cannot).
5. The load script creates a policy ChangeSet. It never writes the active row directly.

## 6. Open ingest and Sources

A Source is an Actor with a name, kind, entity and allowed locations. Sensor and app Sources need the new ActorType values from section 4.

SourceToken rules:
1. Shown once, stored as a hash.
2. Scopes: ingest, read, propose. Never apply.
3. Effective power is the lower of the token scopes and the creating user's current role. Never above contributor.
4. Revoked automatically if the creator loses membership (checked on each use).

The /v1 ingest contract (breaking changes go to /v2):
1. Presigned flow, as today (read): POST /v1/uploads/presign, PUT bytes, POST /v1/tracks.
2. Single-request flow for simple sensors and Shortcuts: POST /v1/tracks/upload, multipart, one image plus JSON metadata.
3. Idempotency-Key is required on both. Same key from the same Source returns the same Track.
4. Provenance on every Track: source id, captured_at (device clock) and received_at (server clock), optional device metadata, and optional location_id or location_hint.
5. Limits: jpeg, png, heic or webp images, 25 MB each and 5 per Track (today's caps, read), configurable.
6. Rate limit per token: 60 per minute and 600 per day by default, set per Source. Over the limit returns 429 with Retry-After.
7. Unrouted captures (no location, or a hint matching nothing) create the Track with routingState unrouted and no LensRun. It appears in the inbox. Assigning a Location queues the lens. The request never fails.

Capture Quick's Ledger destination must: hold a SourceToken; send a stable Idempotency-Key per capture and reuse it on retry; send captured_at and its own capture id as device metadata; treat 401 as stop and tell the user, 429 as retry later; keep the local capture until it gets a 2xx.

Inbox: unrouted Tracks and Tracks with deferred analysis. Cole assigns a Location or discards.

## 7. Quantity model

Lines and inventory carry quantityKind (count, mass, volume, presence) plus unit. Amount is nullable for presence. The schema stays flexible. Which kinds the UI shows is decided after user testing.

Conflict with existing code: InventoryItem already has nullable quantity and unit (read), so presence fits. The new quantityKind column defaults to count, so current rows are unchanged. Kinds do not convert: a line whose kind differs from the live row is flagged as a conflict in review (inferred behavior).

## 8. Worker and Lens: pantry_photo_v1

Flow, following the existing lens pattern (read): claim LensRun, create a Task with id = lensRun id, build the ChangeSet with id = lensRun id, so a retry returns the existing rows.

Config: LENS_VISION_MODEL (default claude-sonnet-5-5), ANTHROPIC_API_KEY, LENS_TIMEOUT_MS (60000), LENS_MAX_RETRIES (2). Model id, tokens and estimated cost go on the LensRun.

Lease: the default is 30 seconds and the loop is serial (read). Use 120 seconds for this lens, with the LLM call outside any open transaction. A long call also delays outbox publishing (inferred); a known risk.

Budget, in one sentence: every analysis is a paid model call, and a fridge camera that fires on every door open could run up a real bill. Each Source has a monthly budget and a per-capture max. There is also an entity-wide monthly cap. Before the model call the worker checks this month's spend plus the estimate for this call. If over, the capture is stored, the LensRun becomes deferred_budget, and the owner is told (inbox item and a Question). Deferred runs resume when the owner raises the budget or the month rolls over.

Prompt inputs: the images; the Location name and kind; current inventory there (item id, resource key, name, quantity kind, quantity, unit, version), capped at 300 rows; rules: only report what is visible, never guess a quantity, prefer matching an existing item, use presence when counting is not possible, give plain-word evidence.

Output JSON schema, enforced with a tool call and re-validated by the worker:

```json
{ "required": ["image_quality", "lines"],
  "image_quality": ["good", "poor", "not_a_pantry"],
  "notes": "string",
  "lines": [ { "max": 100,
    "op": ["add", "adjust", "gone"],
    "inventory_item_id": "string or null",
    "name": "string",
    "quantity_kind": ["count", "mass", "volume", "presence"],
    "quantity": "number >= 0, or null",
    "unit": "string or null",
    "confidence": "0 to 1",
    "evidence": "string, max 300" } ] }
```

Shorthand; the real file is full JSON Schema.

Worker checks: quantity is null for presence and a number otherwise. Drop any inventory_item_id not at this Location, and adjust lines that change nothing. Lines under 0.4 confidence are kept but default to rejected. The worker fills baseVersion from the live row and computes proposalHash.

## 9. API and MCP

API changes:
1. The /v1 ingest routes from section 6. Today's /tracks and /uploads/presign (read) stay for human sessions.
2. Token auth beside Clerk auth (apps/api/src/auth/, read), resolving to an Actor, entity and scopes.
3. Source management (create, revoke, mint token, budgets): a script first.
4. GET /locations. GET /changesets/:id with lines, hashes, Location, Task id and policy version. GET /inbox and POST /inbox/:trackId/assign.
5. POST /changesets/:id/apply takes expected_version, proposal_hash and decisions[]. It checks the hash and each accepted line's baseVersion, evaluates the active policy, records the approval, then applies in one transaction. A replay with the same approved hash returns 200 with the stored result (today it would 409; read).
6. POST /changesets/:id/reject.
7. ai Actors and token-authenticated Sources can never get changeset:apply or approve a policy change.
8. A policy script: load YAML, validate, create the policy ChangeSet.

MCP: a separate app, apps/mcp, with its own rate limits and token auth. No apply code path. It calls the packages/db command layer, never raw Prisma.

Tools:
1. list_locations, search_inventory, get_changeset (own proposals only). Scope read. 60 per minute.
2. propose_change. Input: location_id, idempotency_key, rationale, lines (up to 50, Lens line shape). Scope propose. 5 per hour per token, at most 20 pending.
3. propose_policy_change. Same limits. Creates a policy ChangeSet only.
4. ingest_track, if it fits cleanly: text or an image URL, idempotency_key, optional location_id. The server fetches the URL (size and type limits, no private addresses) and uses the /v1 path. Scope ingest. If URL fetching gets messy, keep text only.

There is no apply tool and no decision tool.

## 10. Failure modes

1. Bad token or revoked Source: 401 with no detail, logged for the owner. Creator lost membership: token stops on next use.
2. Over budget: capture stored, LensRun deferred_budget, owner told. Never dropped.
3. Unrouted capture: lands in the inbox. Rate limit: 429 with Retry-After.
4. Bad photo: no ChangeSet. A Question "Retake this photo" is created (same pattern as today, read).
5. LLM timeout or error: retry up to the limit, then LensRun and Track become failed. Retake is a new Track.
6. Duplicates: same Idempotency-Key returns the same Track. A double tap on Apply gets the stored result. The same photo sent twice makes two Tracks (no sha256 dedupe), so near-duplicates from a fridge camera are limited by budget caps only.
7. Stale proposal: 409 with stale line indexes, nothing applied.
8. Cross-location or cross-entity input: rejected. A Source outside its allowed locations gets 403.
9. Policy load error: the script refuses and the active version stays.

## 11. The hash

proposalHash is sha256 over canonical JSON (sorted keys, numbers as strings) of: location id, each line's op, resource key, quantity kind, unit and proposed quantity, and each affected InventoryItem's id and version (null for add). Editing a quantity in review produces an approvedHash stored with the decisions. Apply recomputes both from live rows inside the transaction. The idea comes from the Kept project; no code is borrowed.

## 12. Verification plan

Statuses: implemented, then verified (I ran the checks), then human_validated (only Cole grants it).

1. Migration on a fresh database and on a copy of current data. Existing InventoryItems default to count.
2. Unit tests: hash determinism, reconcile idempotency (ADR 0003), policy first-match order and YAML validation, token hashing and scope capping, denial for ai Actors and Sources.
3. Integration tests for Journeys A, B, C, C2 and E with a fake LLM, including replayed Idempotency-Key, revoked token, removed creator, unrouted then assigned, and budget exceeded then raised.
4. One recorded run against the real model on three saved shelf photos, with tokens, cost and latency.
5. Journey D on one named build of each app.

## 13. Open questions

1. Should an accountable member be able to approve by default? Today only admins can (read). Policy makes it a data change.
2. Retry and rerun: LensRun is unique per (track, lens), so a rerun needs a new Track or a versioned lens key. Which?
3. Should review also create a Question and Answer (domain doc), or is the line decision record enough? I assumed the second.
4. Where Sources and tokens get minted for now: a script or a minimal admin screen?
5. Estimated cost: on Resource (price per unit) or on each line? Value rules wait on this.
6. Who builds Capture Quick's Ledger destination, and does it block Journey D?
7. Privacy: every analysed photo goes to a third-party model provider. Is that acceptable for always-on sensors like a fridge camera, and should a Source be able to opt out of cloud analysis?

## 15. Build order

This spec is larger than one sitting. Earlier Ledger attempts stalled when scope grew, so build it in three steps, each ending in something Cole can try:

1. Step 1, the core loop: Source and SourceToken, the /v1 single-request upload, ChangeSetLine with per-line apply, the hash check, inventory.reconcile.v1, the pantry Lens, and the review screen. The default policy is a seeded data row with no YAML loader. Budget is one hard per-entity monthly cap. Ends with Journeys A, B and D.
2. Step 2, the agent door: apps/mcp with read tools and propose_change, the actor-type check in can(), Journey C.
3. Step 3, configurable rules: the YAML loader, policy.replace.v1, ChangeSetApproval for N approvers, per-Source budgets and deferred_budget, Journeys C2 and E.

Do not start a step until the one before has passed its journeys.

## 14. What would show this design is wrong

1. On real shelves, most lines get edited or rejected. Then the Lens is the problem, not the flow.
2. Reviewing lines takes longer than typing the list. Then batch accept must be primary.
3. Absolute-quantity lines cause constant stale conflicts. Then we need delta lines.
4. Reviewers cannot tell similar items apart. Then evidence needs a crop or box.
5. The LLM call starves outbox publishing. Then split the Lens worker.
6. Agents need to apply in practice. That is a product change and needs a new decision.
7. Open ingest: the inbox fills with junk or near-duplicate sensor shots, or budget caps trigger weekly. Then sources need on-device filtering or a cheap first-pass check.
8. Policy: Cole never edits the YAML, or every change needs an exception. Then the format is too rich and one fixed approver setting would do. Also wrong if any path lets a token approve a policy change.
