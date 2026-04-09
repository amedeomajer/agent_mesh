# Implementation Plan: User Avatar Feature

Reference: [Approved Spec](./spec.md)

## Step 1: Database Migration

**Task**: Add `avatar_url` and `avatar_updated_at` columns to the `users` table.

- Create migration file `src/migrations/XXXX_add_user_avatar.ts`
- Add UP migration: `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512) DEFAULT NULL; ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMP DEFAULT NULL;`
- Add DOWN migration: drop both columns
- **Test**: Run migration up and down; verify columns exist/don't exist via schema introspection

## Step 2: Update User Model

**Task**: Extend the User model/type to include avatar fields.

- Add `avatarUrl: string | null` and `avatarUpdatedAt: Date | null` to the User type in `src/models/user.ts`
- Update any serialization/deserialization logic to include the new fields
- Update `GET /api/users/:id` response to include `avatarUrl`
- **Test**: Unit test that User model correctly maps DB columns; integration test that GET endpoint returns `avatarUrl` (null for users without avatar)

## Step 3: File Upload Validation Utilities

**Task**: Create server-side validation helpers for avatar uploads.

- Create `src/utils/avatar-validation.ts`
- Implement `validateMimeType(buffer: Buffer): string | null` — check magic bytes for JPEG, PNG, WebP
- Implement `validateFileSize(size: number, maxMB: number): boolean`
- Implement `validateDimensions(buffer: Buffer): { width: number, height: number } | null` — check min 100x100, max 2048x2048
- **Test**: Unit tests with valid/invalid files, edge cases (empty buffer, wrong extension with valid magic bytes, oversized files)

## Step 4: Image Processing Utility

**Task**: Create image processing pipeline (resize, convert, strip EXIF).

- Create `src/utils/avatar-processing.ts`
- Implement `processAvatar(buffer: Buffer): Promise<Buffer>` — resize to 256x256 (crop-to-fill, center), convert to WebP, strip EXIF
- Use `sharp` library for image processing
- **Test**: Unit test with sample images; verify output is WebP, 256x256, no EXIF data

## Step 5: Storage Service

**Task**: Implement object storage upload/delete for avatar files.

- Create `src/services/avatar-storage.ts`
- Implement `uploadAvatar(userId: string, buffer: Buffer): Promise<string>` — uploads to `avatars/{userId}/{uuid}.webp`, returns URL
- Implement `deleteAvatar(url: string): Promise<void>` — deletes file from storage
- Use S3-compatible SDK; abstract behind an interface for testability
- **Test**: Integration test with mock/local S3; verify upload returns valid URL, delete removes file

## Step 6: PUT /api/users/:id/avatar Endpoint

**Task**: Implement the avatar upload endpoint.

- Add route handler in the appropriate router file
- Parse multipart form data (use `multer` or equivalent)
- Check auth: user must match `:id` or be admin
- Validate file using Step 3 utilities
- Process image using Step 4 utility
- Upload using Step 5 storage service
- Update user record in DB (`avatar_url`, `avatar_updated_at`)
- Return `200 { avatarUrl: string }`
- Handle errors: 400, 401, 413, 429
- **Test**: Integration tests covering: successful upload, invalid MIME, oversized file, unauthorized user, rate limiting

## Step 7: DELETE /api/users/:id/avatar Endpoint

**Task**: Implement the avatar delete endpoint.

- Add route handler
- Check auth: user must match `:id` or be admin
- Delete file from storage via Step 5
- Set `avatar_url` to NULL and `avatar_updated_at` to now in DB
- Return `204 No Content`
- **Test**: Integration tests: successful delete, delete when no avatar exists (idempotent), unauthorized user

## Step 8: AvatarUpload Component — Core UI

**Task**: Build the `<AvatarUpload />` React component with display and file selection.

- Create `src/components/AvatarUpload.tsx`
- Implement props interface per spec
- Display current avatar or placeholder
- Click or drag-and-drop to open file picker (filtered to accepted types)
- Show client-side preview via `URL.createObjectURL` after selection
- Client-side validation: file size and type
- **Test**: Render tests: shows placeholder when no avatar, shows current avatar when provided, file picker opens on click, preview displayed after file selection, validation errors shown for invalid files

## Step 9: AvatarUpload Component — Upload & Delete

**Task**: Add upload progress, success/error handling, and delete functionality.

- Wire up PUT endpoint call with `XMLHttpRequest` or `fetch` for progress tracking
- Show progress bar during upload
- On success: update displayed image, call `onUploadComplete`
- On error: show inline error message, keep previous avatar, call `onError`
- Add "Remove" button (visible when avatar exists); calls DELETE endpoint
- **Test**: Mock API calls; test upload progress rendering, success callback, error display, delete flow

## Step 10: AvatarUpload Component — Accessibility

**Task**: Ensure all accessibility requirements are met.

- Add `role="button"` with `aria-label="Upload avatar"` on trigger
- Associate file input with label
- Keyboard navigation: Enter/Space to open picker
- Progress bar: `role="progressbar"` with `aria-valuenow`
- Error messages: `aria-describedby` + `role="alert"`
- Focus management after upload completes
- **Test**: Accessibility audit with testing-library; verify ARIA attributes, keyboard interaction, screen reader announcements

## Dependency Graph

```
Step 1 (migration) → Step 2 (model)
Step 3 (validation) ─┐
Step 4 (processing) ──┼→ Step 6 (PUT endpoint) → Step 7 (DELETE endpoint)
Step 5 (storage) ─────┘
Step 8 (UI core) → Step 9 (upload/delete) → Step 10 (a11y)
```

Steps 3, 4, 5 can be implemented in parallel.
Steps 8-10 can begin after Step 2 (they need the model types) and run in parallel with Steps 6-7.
