import test from "node:test";
import assert from "node:assert/strict";
import { can } from "../can.js";
import type { Actor } from "../roles.js";

test("admin can manage within entity", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "admin" };
  assert.equal(can(actor, "admin:manage", { entityId: "e1" }), true);
});

test("member cannot apply changesets", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "member" };
  assert.equal(can(actor, "changeset:apply", { entityId: "e1" }), false);
});

test("cross-entity access denied", () => {
  const actor: Actor = { actorId: "a", entityId: "e1", role: "admin" };
  assert.equal(can(actor, "task:read", { entityId: "e2" }), false);
});

