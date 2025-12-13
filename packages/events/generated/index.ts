export const EVENT_TYPES = [
  "changeset.applied.v1",
  "changeset.proposed.v1",
  "entity.created.v1",
  "inventory.import_text.applied.v1",
  "lens.run.completed.v1",
  "lens.run.started.v1",
  "meal.goal.created.v1",
  "membership.added.v1",
  "membership.role_changed.v1",
  "question.answered.v1",
  "question.asked.v1",
  "task.completed.v1",
  "task.created.v1",
  "task.state_changed.v1",
  "track.ingested.v1"
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
