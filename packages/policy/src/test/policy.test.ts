import test from "node:test";
import assert from "node:assert/strict";
import { can } from "../can.js";
import type { Actor } from "../roles.js";

test("admin can manage within entity", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "admin" };
  assert.equal(can(actor, "admin:manage", { entityId: "e1" }), true);
});

test("contributor cannot apply changesets", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "contributor" };
  assert.equal(can(actor, "changeset:apply", { entityId: "e1" }), false);
});

test("members can read changesets", () => {
  const contributor: Actor = { actorId: "a", entityId: "e1", role: "contributor" };
  const accountable: Actor = { actorId: "a", entityId: "e1", role: "accountable" };
  assert.equal(can(contributor, "changeset:read", { entityId: "e1" }), true);
  assert.equal(can(accountable, "changeset:read", { entityId: "e1" }), true);
});

test("accountable can complete tasks", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "accountable" };
  assert.equal(can(actor, "task:complete", { entityId: "e1" }), true);
});

test("cross-entity access denied", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "admin" };
  assert.equal(can(actor, "task:read", { entityId: "e2" }), false);
});
