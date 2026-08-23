// Legacy import path retained as a rollback adapter for downstream consumers.
// Production code imports ./database directly.
export * from "./database"
export * as Database from "./database"
