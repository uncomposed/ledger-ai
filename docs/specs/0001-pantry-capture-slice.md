# Spec 0001: Pantry capture slice

Status: draft. Date: 2026-10-26. Nothing is implemented yet.

Notation: "(read)" means I read it in code. "(inferred)" means I concluded it and did not verify it.

## 1. Goal and non-goals

Goal: photograph a pantry shelf on the phone, get a per-item proposed inventory change, accept, reject or edit each line, apply, and see inventory update. An outside agent can propose changes through MCP but can never apply them.

Non-goals: offline sync, recurrence and chores, assets, meal planning, web UI.

## 2. User journey

1. Cole opens the phone app, taps Pantry capture, and takes a photo.
2. The app asks which Location. It preselects the last used one and Cole confirms.
3. The app uploads the photo, creates the Track, and shows "Analyzing".
4. When the ChangeSet exists, it appears in the approval queue.
5. Cole opens it and sees one card per line: add, adjust quantity, or mark gone. Each card shows confidence and the evidence text.
6. He accepts, rejects or edits the quantity on each line, then taps Apply.
7. Inventory updates and the app shows which lines were applied.

Every step traces to a Task: the lens creates a Task, the ChangeSet hangs off it, and the apply event carries its id.

Mobile client requirements, independent of which codebase hosts the app (see open question 1): sign in with Clerk and call the API with a bearer token; take or pick a photo and resize it; compute sha256, presign, upload, create the Track; list Locations; show the approval queue and a per-line review screen with accept, reject and edit; send decisions with the proposal hash; show the build number and git sha.

## 3. Acceptance journeys

Journey A, automated, fake LLM:
1. Seed an entity, an admin, a Pantry Location, and two InventoryItems.
2. POST /uploads/presign, PUT the bytes, POST /tracks with the location.
3. Run the worker once. Expect one LensRun succeeded, one Task, one ChangeSet pending_approval with three lines.
4. POST apply with line 0 accepted, line 1 edited to quantity 4, line 2 rejected.
5. Expect two InventoryMutation rows, the item versions bumped, the third item unchanged, and events in the outbox then the event log.
6. Repeat the same apply call. Expect 200 and no new rows.

Journey B, stale proposal:
1. Create a ChangeSet with an adjust line.
2. Change that InventoryItem through another path.
3. Apply. Expect 409 listing the stale line, and no mutations.

Journey C, agent:
1. Mint a propose-scoped token for a location.
2. Call propose_change. Expect a pending ChangeSet whose proposer is the agent Actor.
3. Try a call outside the location. Expect a denial.
4. Call apply with the agent token. Expect 403, even if the agent's membership is admin.

Journey D, real device, one identifiable build:
1. Make one installable phone build. Record its build number and git sha. The app shows both in the settings screen.
2. On Cole's iPhone, with a real Clerk account and the API reachable, run the user journey in section 2 with a real photo of a real shelf.
3. Write the build id, the ChangeSet id, and the result into the verification log.
4. Cole then compares the shelf to the inventory list. Only he can mark this human_validated.

## 4. Data model: what exists and what is missing

What the schema already gives us (read):
1. Track plus TrackAttachment with storageKey, LensRun with a unique key per (track, lens), Task, ChangeSet with a version, InventoryItem with a version counter, and InventoryMutation unique on (changeSetId, opIndex). That last one is what makes replay safe.
2. Actor has type ai. AuthIdentity maps outside identities to Actors.

Gaps:
1. No per-line decisions. ChangeSet.patch is one JSON blob, and state is whole-set only: draft, pending_approval, applied, rejected. Nothing records "line 2 rejected".
2. No partial apply. applyChangeSet runs the whole patch.
3. inventory.delta.v1 cannot express the lines. It takes resource_id and a delta only. It cannot create a resource from a name, set an absolute quantity, or target a Location by id (it upserts a Location from a kind string).
4. The apply route takes only expected_version. There is no proposal hash and no row-version check.
5. Track has no location field. Location lives only in the free-form context JSON, and POST /tracks does not accept context.
6. POST /tracks hard-codes the image lens to image_stub_v1, which only asks a Question.
7. UploadsProvider can presign and verify but cannot read bytes back. The worker needs that.
8. Policy: changeset:apply is admin only. Nothing stops an ai Actor with an admin membership from applying (inferred from can.ts, which never checks actor type).
9. No GET /locations and no GET /changesets/:id. /approval-queue returns metadata only, not the patch.
10. No agent token model.

Proposed migration (one, additive):
1. New table ChangeSetLine: id, entityId, changeSetId, lineIndex, op (add, adjust, gone), resourceId or resourceKey plus resourceName, inventoryItemId, baseVersion (null for add), baseQuantity, proposedQuantity, unit, confidence, evidence, decision (pending, accepted, rejected, edited), editedQuantity, decidedByActorId, decidedAt. Unique on (changeSetId, lineIndex).
2. ChangeSet gets locationId, proposalHash, approvedHash, approvedPatch (JSON), and source (lens or agent).
3. Track gets a nullable locationId.
4. New table AgentToken: id, entityId, actorId, createdByActorId, tokenHash, scopes (read, propose), locationIds, expiresAt, revokedAt, lastUsedAt.
5. New patch handler inventory.reconcile.v1. Per ADR 0003, inventory.delta.v1 stays untouched. Lines are absolute: add creates at quantity q, adjust sets to q, gone sets to 0. The handler writes a delta mutation equal to the difference, using opIndex = lineIndex, so skipped lines leave gaps. That is fine.

How decisions reach the handler: the apply call stores decisions on the lines, builds approvedPatch from accepted and edited lines only, and applyChangeSet passes approvedPatch (falling back to patch) to the handler. That keeps the handler a pure function of its input. Outcomes: some lines accepted gives state applied. All rejected gives state rejected. No new enum value is needed.

## 5. API changes

1. POST /tracks accepts optional location_id and picks pantry_photo_v1 when an image has one.
2. GET /locations.
3. GET /changesets/:id returns lines, hashes, the Location and the Task id.
4. POST /changesets/:id/apply body becomes expected_version, proposal_hash, and decisions[] of line_index, decision, edited_quantity. On the first call it checks hash, checks every accepted line's baseVersion against the live row, then applies in one transaction. A replay with the same approved hash returns 200 with the stored result. Today a replay would return 409 (read).
5. POST /changesets/:id/reject for rejecting the whole set.
6. Policy: add a hard rule that an ai Actor can never get changeset:apply.
7. The Idempotency-Key header on POST /tracks, set by the app per capture.

## 6. Worker and Lens: pantry_photo_v1

Flow, following the existing lens pattern (read): claim LensRun, create a Task with id = lensRun id, build the ChangeSet with id = lensRun id, so a retry returns the existing rows.

Config: LENS_VISION_MODEL, default claude-sonnet-5-5. ANTHROPIC_API_KEY. LENS_TIMEOUT_MS, default 60000. LENS_MAX_RETRIES, default 2. The model id is stored on the LensRun result for audit.

Lease: the current default is 30 seconds and the loop is serial (read). Use a 120 second lease for this lens, and run the LLM call outside any open database transaction. A long call also delays outbox publishing in the same loop (inferred); acceptable for now, noted as a risk.

Prompt inputs:
1. The image or images, resized on the phone to about 1600 pixels on the long edge.
2. The Location name and kind.
3. Current inventory at that Location: inventory_item_id, resource_key, name, quantity, unit, version. Capped at 300 rows.
4. Rules: only report what is visible, never guess a quantity you cannot see, prefer matching an existing item, give evidence in plain words.

Output JSON schema, enforced with a tool call and re-validated by the worker:

```json
{
  "type": "object",
  "required": ["image_quality", "lines"],
  "properties": {
    "image_quality": { "enum": ["good", "poor", "not_a_pantry"] },
    "notes": { "type": "string" },
    "lines": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "type": "object",
        "required": ["op", "name", "quantity", "unit", "confidence", "evidence"],
        "properties": {
          "op": { "enum": ["add", "adjust", "gone"] },
          "inventory_item_id": { "type": ["string", "null"] },
          "name": { "type": "string" },
          "quantity": { "type": "number", "minimum": 0 },
          "unit": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "evidence": { "type": "string", "maxLength": 300 }
        }
      }
    }
  }
}
```

Worker checks: drop any inventory_item_id not at this Location. Drop adjust lines that change nothing. Lines under 0.4 confidence are kept but default to rejected in the app. The worker fills baseVersion from the live row and computes proposalHash.

## 7. MCP server

Recommendation: a separate app, apps/mcp, not a route inside the API. Reasons: agent traffic gets its own rate limits and its own auth (scoped tokens, not Clerk sessions), it can crash or be switched off without touching the phone's API, and its code path has no apply function to misuse. It must call the same packages/db command layer, never raw Prisma, so policy checks stay in one place. Trade-off: one more deployable.

Auth: the token is shown once and stored as a hash. It belongs to an ai Actor, scoped to one entity, with scopes read and/or propose, and an optional location list. Effective power is the lower of the token scopes and the creating user's current role. A token never exceeds contributor. It dies if the creator loses membership.

Tools:
1. list_locations. Input: none. Output: id, name, kind. Scope: read. 60 per minute.
2. search_inventory. Input: location_id optional, query optional, limit up to 100. Output: item id, name, quantity, unit, version, location. Scope: read, filtered to allowed locations. 60 per minute.
3. get_changeset. Input: changeset_id. Output: state, lines with decisions, hashes. Scope: read, limited to the agent's own proposals. 60 per minute.
4. propose_change. Input: location_id, idempotency_key, rationale, lines (up to 50, same shape as the Lens lines). Output: changeset_id, task_id, proposal_hash. Scope: propose. Creates a Task and a pending ChangeSet attributed to the agent Actor. 5 per hour per token, and at most 20 pending at once.

There is no apply tool and no decision tool.

## 8. Failure modes

1. Bad photo: the model reports poor or not_a_pantry. No ChangeSet. The worker creates a Question "Retake this photo" (same pattern as today, read), and the app shows it.
2. LLM timeout or error: retry up to the limit, then LensRun and Track become failed with an error. The app shows Failed with a retake button. Retake is a new Track.
3. Duplicate submissions: same Idempotency-Key returns the same Track. A double tap on Apply gets the stored result. The same photo uploaded twice makes two Tracks; we do not dedupe by sha256 in this slice.
4. Stale proposal: any hash mismatch or row version mismatch returns 409 with the stale line indexes. Nothing is applied. The user retakes the photo. We never silently drop stale lines.
5. Cross-location or cross-entity input: rejected at validate time.

## 9. The hash

proposalHash is sha256 over canonical JSON (sorted keys, numbers as strings) of: location id, each line's op, resource key, unit and proposed quantity, and, for each affected InventoryItem, its id and version (null for add). Editing a quantity during review produces an approvedHash, stored with the decisions. Apply recomputes both from live rows inside the transaction. This idea comes from the Kept project; no code is borrowed.

## 10. Verification plan

Statuses: implemented, then verified (I ran the checks), then human_validated (only Cole grants it).

1. Migration applied to a fresh database and to a copy of current data.
2. Unit tests: hash determinism, the reconcile handler's idempotency (the ADR 0003 requirement), policy denial for ai Actors.
3. Integration tests for Journeys A, B, C, with a fake LLM.
4. One recorded run against the real model on three saved shelf photos, with cost and latency noted.
5. Journey D on one named build.

## 11. Open questions

1. Which codebase hosts the phone app: apps/mobile in this repo (currently a sign-in shell, read) or Capture_Quick (TrackLens)? This spec does not depend on the answer. Recommendation (not yet decided by Cole): keep the app in apps/mobile, move it to TrackLens's Expo SDK 55 stack, and bring over TrackLens's capture core (camera and hold-to-record screen, journaled media storage, transcription, serial task queue, inbox and review layouts). Leave TrackLens's on-phone AI and SQLite-as-truth behind, since here the Lens runs in the worker and Postgres is the record. TrackLens needs a dev build, not Expo Go.
2. Admin-only apply: should an accountable member be able to approve? Today only admins can (read). Cole is probably admin, so this works for him, but it matters for a household.
3. Retry and rerun: LensRun is unique per (track, lens), so a rerun needs a new Track or a versioned lens key. Which?
4. Should the review also create a Question and Answer, as the domain doc describes, or is the line-level decision record enough? I assumed the second.
5. Quantity for loose items (a bag of flour): do we track counts, or "present or gone" only?
6. Model cost ceiling per capture.
7. Where agent tokens get minted: an admin screen in the app, or a script for now?

## 12. What would show this design is wrong

1. On real shelves, most lines get edited or rejected. Then the Lens is the problem, not the flow.
2. Reviewing lines takes longer than typing the list. Then batch accept needs to be primary.
3. Absolute-quantity lines cause constant stale conflicts because inventory changes between photo and approval. Then we need delta lines.
4. A reviewer cannot tell apart two similar items. Then evidence needs a crop or box from the photo.
5. Running the LLM in the worker loop starves outbox publishing. Then split the Lens worker.
6. Agents need to apply in practice. That would be a product change, not a bug, and it needs a new decision.
