/**
 * Migration 001: Add avatar columns to users table.
 *
 * UP  — adds `avatar_url` (VARCHAR 512) and `avatar_updated_at` (TIMESTAMP)
 * DOWN — drops both columns
 */

export interface MigrationContext {
  /** Execute a raw SQL statement. */
  exec(sql: string): Promise<void>;
}

export const id = '001_add_user_avatar';

export async function up(ctx: MigrationContext): Promise<void> {
  await ctx.exec(
    `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512) DEFAULT NULL`
  );
  await ctx.exec(
    `ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMP DEFAULT NULL`
  );
}

export async function down(ctx: MigrationContext): Promise<void> {
  await ctx.exec(`ALTER TABLE users DROP COLUMN avatar_updated_at`);
  await ctx.exec(`ALTER TABLE users DROP COLUMN avatar_url`);
}
