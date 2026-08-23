import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260530104205_add_origin_session_id",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`origin_session_id\` text;`)
      yield* tx.run(`CREATE INDEX \`session_origin_idx\` ON \`session\` (\`origin_session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
