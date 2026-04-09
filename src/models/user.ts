/**
 * User model with avatar support.
 *
 * Represents a user record from the `users` table, including the optional
 * avatar fields added by migration 001_add_user_avatar.
 */

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Raw database row shape — dates come back as strings from most drivers.
 */
export interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  avatar_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fields returned by the public GET /api/users/:id endpoint.
 */
export interface UserPublicView {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Maps a raw database row to the application-level User model.
 */
export function fromRow(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    avatarUpdatedAt: row.avatar_updated_at
      ? new Date(row.avatar_updated_at)
      : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Maps a User to the shape sent over the public API.
 */
export function toPublicView(user: User): UserPublicView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * Maps a User back to a flat row object for DB inserts/updates.
 */
export function toRow(user: User): UserRow {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    avatar_updated_at: user.avatarUpdatedAt
      ? user.avatarUpdatedAt.toISOString()
      : null,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}
