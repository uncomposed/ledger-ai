export type JsonSchema = Record<string, unknown>;

export function strictObjectSchema(input: {
  properties: Record<string, JsonSchema>;
  required?: readonly string[];
}): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: input.properties,
    ...(input.required ? { required: input.required } : {}),
  };
}

export const TaskStates = ["proposed", "ready", "in_progress", "completed", "blocked", "cancelled"] as const;
export const ChangeSetStates = ["draft", "pending_approval", "applied", "rejected"] as const;
export const MembershipRoles = ["admin", "contributor", "accountable"] as const;
export const MealGoalStatuses = ["open", "planned", "cancelled"] as const;

export function uuidSchema(): JsonSchema {
  return { type: "string", format: "uuid" };
}

export function nonNegativeIntSchema(): JsonSchema {
  return { type: "integer", minimum: 0 };
}
