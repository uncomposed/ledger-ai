import { redact } from "./redact.js";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, fields: Record<string, unknown>, msg: string) {
  const line = {
    level,
    msg,
    time: new Date().toISOString(),
    ...((redact(fields) ?? {}) as Record<string, unknown>),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export const logger = {
  debug(fields: Record<string, unknown>, msg: string) {
    emit("debug", fields, msg);
  },
  info(fields: Record<string, unknown>, msg: string) {
    emit("info", fields, msg);
  },
  warn(fields: Record<string, unknown>, msg: string) {
    emit("warn", fields, msg);
  },
  error(fields: Record<string, unknown>, msg: string) {
    emit("error", fields, msg);
  },
};

