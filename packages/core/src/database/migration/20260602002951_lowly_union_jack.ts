import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260602002951_lowly_union_jack",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`permission\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`permission_project_action_resource_idx\` ON \`permission\` (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(`
        INSERT INTO \`permission\` (\`id\`, \`project_id\`, \`action\`, \`resource\`, \`time_created\`, \`time_updated\`)
        SELECT
          'legacy_' || legacy.\`project_id\` || '_' || rule.key,
          legacy.\`project_id\`,
          json_extract(rule.value, '$.permission'),
          json_extract(rule.value, '$.pattern'),
          legacy.\`time_created\`,
          legacy.\`time_updated\`
        FROM \`permission_legacy\` AS legacy, json_each(legacy.\`data\`) AS rule
        WHERE json_extract(rule.value, '$.action') = 'allow'
        ON CONFLICT (\`project_id\`, \`action\`, \`resource\`) DO NOTHING;
      `)
      yield* tx.run(`DROP TABLE \`permission_legacy\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
