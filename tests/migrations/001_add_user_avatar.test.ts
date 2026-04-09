import { describe, it, expect, vi } from 'vitest';
import { id, up, down, type MigrationContext } from '../../src/migrations/001_add_user_avatar.js';

function createMockContext(): MigrationContext & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    exec: vi.fn(async (sql: string) => {
      statements.push(sql);
    }),
  };
}

describe('Migration 001: add user avatar', () => {
  it('has the correct migration id', () => {
    expect(id).toBe('001_add_user_avatar');
  });

  describe('up', () => {
    it('adds avatar_url column', async () => {
      const ctx = createMockContext();
      await up(ctx);

      const addAvatarUrl = ctx.statements.find((s) =>
        s.includes('avatar_url')
      );
      expect(addAvatarUrl).toBeDefined();
      expect(addAvatarUrl).toContain('ADD COLUMN');
      expect(addAvatarUrl).toContain('VARCHAR(512)');
      expect(addAvatarUrl).toContain('DEFAULT NULL');
    });

    it('adds avatar_updated_at column', async () => {
      const ctx = createMockContext();
      await up(ctx);

      const addTimestamp = ctx.statements.find((s) =>
        s.includes('avatar_updated_at')
      );
      expect(addTimestamp).toBeDefined();
      expect(addTimestamp).toContain('ADD COLUMN');
      expect(addTimestamp).toContain('TIMESTAMP');
      expect(addTimestamp).toContain('DEFAULT NULL');
    });

    it('targets the users table', async () => {
      const ctx = createMockContext();
      await up(ctx);

      for (const stmt of ctx.statements) {
        expect(stmt).toContain('ALTER TABLE users');
      }
    });

    it('executes exactly two statements', async () => {
      const ctx = createMockContext();
      await up(ctx);

      expect(ctx.exec).toHaveBeenCalledTimes(2);
    });
  });

  describe('down', () => {
    it('drops avatar_updated_at column', async () => {
      const ctx = createMockContext();
      await down(ctx);

      const dropTimestamp = ctx.statements.find((s) =>
        s.includes('avatar_updated_at')
      );
      expect(dropTimestamp).toBeDefined();
      expect(dropTimestamp).toContain('DROP COLUMN');
    });

    it('drops avatar_url column', async () => {
      const ctx = createMockContext();
      await down(ctx);

      const dropUrl = ctx.statements.find((s) => s.includes('avatar_url'));
      expect(dropUrl).toBeDefined();
      expect(dropUrl).toContain('DROP COLUMN');
    });

    it('executes exactly two statements', async () => {
      const ctx = createMockContext();
      await down(ctx);

      expect(ctx.exec).toHaveBeenCalledTimes(2);
    });
  });

  it('up and down are inverse operations on column names', async () => {
    const upCtx = createMockContext();
    const downCtx = createMockContext();

    await up(upCtx);
    await down(downCtx);

    // up adds the columns that down drops
    const upColumns = upCtx.statements
      .map((s) => s.match(/ADD COLUMN (\w+)/)?.[1])
      .filter(Boolean)
      .sort();
    const downColumns = downCtx.statements
      .map((s) => s.match(/DROP COLUMN (\w+)/)?.[1])
      .filter(Boolean)
      .sort();

    expect(upColumns).toEqual(downColumns);
  });
});
