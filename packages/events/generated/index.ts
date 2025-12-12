export const EVENT_TYPES = [
  "task.completed.v1",
  "task.created.v1"
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
