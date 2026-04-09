import { describe, it, expect } from 'vitest';
import {
  fromRow,
  toPublicView,
  toRow,
  type User,
  type UserRow,
} from '../../src/models/user.js';

const sampleRow: UserRow = {
  id: 'u-001',
  username: 'jdoe',
  email: 'jdoe@example.com',
  display_name: 'Jane Doe',
  avatar_url: 'https://cdn.example.com/avatars/u-001/abc.webp',
  avatar_updated_at: '2026-03-15T12:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-03-15T12:00:00.000Z',
};

const sampleRowNoAvatar: UserRow = {
  ...sampleRow,
  id: 'u-002',
  avatar_url: null,
  avatar_updated_at: null,
};

describe('User model', () => {
  describe('fromRow', () => {
    it('maps a full database row to a User object', () => {
      const user = fromRow(sampleRow);

      expect(user.id).toBe('u-001');
      expect(user.username).toBe('jdoe');
      expect(user.email).toBe('jdoe@example.com');
      expect(user.displayName).toBe('Jane Doe');
      expect(user.avatarUrl).toBe(
        'https://cdn.example.com/avatars/u-001/abc.webp'
      );
      expect(user.avatarUpdatedAt).toBeInstanceOf(Date);
      expect(user.avatarUpdatedAt!.toISOString()).toBe(
        '2026-03-15T12:00:00.000Z'
      );
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('maps null avatar fields correctly', () => {
      const user = fromRow(sampleRowNoAvatar);

      expect(user.avatarUrl).toBeNull();
      expect(user.avatarUpdatedAt).toBeNull();
    });
  });

  describe('toPublicView', () => {
    it('returns only public-facing fields', () => {
      const user = fromRow(sampleRow);
      const view = toPublicView(user);

      expect(view).toEqual({
        id: 'u-001',
        username: 'jdoe',
        displayName: 'Jane Doe',
        avatarUrl: 'https://cdn.example.com/avatars/u-001/abc.webp',
      });
    });

    it('returns avatarUrl as null when no avatar exists', () => {
      const user = fromRow(sampleRowNoAvatar);
      const view = toPublicView(user);

      expect(view.avatarUrl).toBeNull();
    });

    it('does not expose email', () => {
      const user = fromRow(sampleRow);
      const view = toPublicView(user);

      expect(view).not.toHaveProperty('email');
    });
  });

  describe('toRow', () => {
    it('round-trips through fromRow -> toRow', () => {
      const user = fromRow(sampleRow);
      const row = toRow(user);

      expect(row.id).toBe(sampleRow.id);
      expect(row.username).toBe(sampleRow.username);
      expect(row.email).toBe(sampleRow.email);
      expect(row.display_name).toBe(sampleRow.display_name);
      expect(row.avatar_url).toBe(sampleRow.avatar_url);
      expect(row.avatar_updated_at).toBe(sampleRow.avatar_updated_at);
      expect(row.created_at).toBe(sampleRow.created_at);
      expect(row.updated_at).toBe(sampleRow.updated_at);
    });

    it('handles null avatar fields in round-trip', () => {
      const user = fromRow(sampleRowNoAvatar);
      const row = toRow(user);

      expect(row.avatar_url).toBeNull();
      expect(row.avatar_updated_at).toBeNull();
    });
  });
});
