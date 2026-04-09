# Avatar Feature Spec

## Overview

Add user avatar support: upload, store, serve, and display profile images.

## Database Schema

```sql
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512) DEFAULT NULL;
ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMP DEFAULT NULL;
```

Rollback:
```sql
ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users DROP COLUMN avatar_updated_at;
```

## API Endpoints

### `PUT /api/users/:id/avatar`
- **Auth**: Bearer token, must match `:id` or be admin
- **Content-Type**: `multipart/form-data`
- **Body**: `file` field with the image
- **Validation**:
  - Max file size: 2 MB
  - Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`
  - Validate MIME via magic bytes server-side (do not trust Content-Type header)
  - Min dimensions: 100x100 px
  - Max dimensions: 2048x2048 px
- **Processing**:
  - Resize to 256x256 (crop-to-fill, center gravity)
  - Convert to WebP
  - Strip EXIF metadata
  - Upload to object storage under `avatars/{userId}/{uuid}.webp`
  - Update `avatar_url` and `avatar_updated_at` in DB
- **Response**: `200 { avatarUrl: string }`
- **Errors**: `400` (invalid file), `401` (unauthorized), `413` (too large), `429` (rate limited)

### `DELETE /api/users/:id/avatar`
- **Auth**: Bearer token, must match `:id` or be admin
- **Action**: set `avatar_url` to NULL, delete file from storage
- **Response**: `204 No Content`

### `GET /api/users/:id` (existing)
- Now includes `avatarUrl` field in the response body

## Component: `<AvatarUpload />`

### Props
```typescript
interface AvatarUploadProps {
  userId: string;
  currentAvatarUrl?: string;
  onUploadComplete: (url: string) => void;
  onError?: (error: Error) => void;
  maxSizeMB?: number;       // default: 2
  acceptedTypes?: string[];  // default: ['image/jpeg', 'image/png', 'image/webp']
}
```

### Behavior
1. Displays current avatar or a default placeholder
2. Click or drag-and-drop to select a file
3. After selection: show a **client-side preview** via `URL.createObjectURL`
4. Client-side validation: check file size and type before uploading
5. Upload with progress indicator
6. On success: swap preview with returned URL, call `onUploadComplete`
7. On error: show inline error message, keep previous avatar, call `onError`
8. "Remove" button visible when an avatar exists; calls DELETE endpoint

### Accessibility
- `role="button"` with `aria-label="Upload avatar"` on the trigger
- File input has associated label
- Keyboard navigable (Enter/Space to open picker)
- Progress bar uses `role="progressbar"` with `aria-valuenow`
- Error messages linked via `aria-describedby` and use `role="alert"`
- Focus management after upload completes

## File Upload Constraints (Summary)

| Constraint       | Value                                  |
|------------------|----------------------------------------|
| Max file size    | 2 MB                                  |
| Allowed MIME     | image/jpeg, image/png, image/webp      |
| Min dimensions   | 100x100 px                             |
| Max dimensions   | 2048x2048 px                           |
| Output format    | WebP, 256x256 px                       |
| Storage          | Object storage (S3-compatible)         |
| URL pattern      | `avatars/{userId}/{uuid}.webp`         |
| Validation       | Client-side (UX) + Server-side (security) |

## Security Considerations

- **Server-side MIME validation** via magic bytes prevents disguised file uploads
- **Image processing** (resize/re-encode) strips EXIF data and neutralizes image-based exploits
- **Authorization** checked on every mutation; users can only modify their own avatar
- **Storage path** uses UUID to prevent enumeration and path traversal
- **Content-Disposition** header on served files set to `inline` with fixed filename
- **Rate limiting**: max 10 uploads per user per hour
