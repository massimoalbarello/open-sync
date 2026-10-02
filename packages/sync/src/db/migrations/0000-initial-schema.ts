import type { Database } from 'bun:sqlite';
import schema from '../schema.sql' with { type: 'text' };

export function up(db: Database): void {
  // The released schema is idempotent, so existing unversioned databases adopt this baseline.
  // Its simple DDL statements end with semicolon/newline; execute separately to catch each failure.
  for (const statement of schema.split(';\n').filter((sql) => sql.trim())) {
    db.query(statement).run();
  }
}
