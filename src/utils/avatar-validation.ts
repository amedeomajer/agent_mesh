/**
 * Client-side and server-side validation utilities for avatar uploads.
 */

export const DEFAULT_MAX_SIZE_MB = 2;
export const DEFAULT_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MIN_DIMENSIONS = { width: 100, height: 100 };
export const MAX_DIMENSIONS = { width: 2048, height: 2048 };

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/**
 * Validate a file's MIME type against the accepted list.
 */
export function validateMimeType(
  mimeType: string,
  acceptedTypes: readonly string[] = DEFAULT_ACCEPTED_TYPES
): ValidationResult {
  if (!acceptedTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid file type "${mimeType}". Accepted: ${acceptedTypes.join(', ')}`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Validate file size against the maximum.
 */
export function validateFileSize(
  sizeBytes: number,
  maxSizeMB: number = DEFAULT_MAX_SIZE_MB
): ValidationResult {
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (sizeBytes <= 0) {
    return { valid: false, error: 'File is empty' };
  }
  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      error: `File is too large (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB). Maximum: ${maxSizeMB} MB`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Validate image dimensions against min/max constraints.
 */
export function validateDimensions(
  width: number,
  height: number,
  min = MIN_DIMENSIONS,
  max = MAX_DIMENSIONS
): ValidationResult {
  if (width < min.width || height < min.height) {
    return {
      valid: false,
      error: `Image too small (${width}x${height}). Minimum: ${min.width}x${min.height}`,
    };
  }
  if (width > max.width || height > max.height) {
    return {
      valid: false,
      error: `Image too large (${width}x${height}). Maximum: ${max.width}x${max.height}`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Server-side magic-byte MIME detection.
 *
 * Returns the detected MIME type or null if unrecognised.
 * Checks the first few bytes of the buffer against known signatures.
 */
export function detectMimeFromBytes(
  buffer: Uint8Array
): string | null {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Run all client-side validations on a file-like object.
 */
export function validateAvatarFile(
  file: { type: string; size: number },
  maxSizeMB: number = DEFAULT_MAX_SIZE_MB,
  acceptedTypes: readonly string[] = DEFAULT_ACCEPTED_TYPES
): ValidationResult {
  const typeResult = validateMimeType(file.type, acceptedTypes);
  if (!typeResult.valid) return typeResult;

  const sizeResult = validateFileSize(file.size, maxSizeMB);
  if (!sizeResult.valid) return sizeResult;

  return { valid: true, error: null };
}
