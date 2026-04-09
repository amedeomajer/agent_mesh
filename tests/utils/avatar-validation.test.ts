import { describe, it, expect } from 'vitest';
import {
  validateMimeType,
  validateFileSize,
  validateDimensions,
  detectMimeFromBytes,
  validateAvatarFile,
  DEFAULT_MAX_SIZE_MB,
  DEFAULT_ACCEPTED_TYPES,
  MIN_DIMENSIONS,
  MAX_DIMENSIONS,
} from '../../src/utils/avatar-validation.js';

// ── validateMimeType ──

describe('validateMimeType', () => {
  it('accepts image/jpeg', () => {
    expect(validateMimeType('image/jpeg')).toEqual({ valid: true, error: null });
  });

  it('accepts image/png', () => {
    expect(validateMimeType('image/png')).toEqual({ valid: true, error: null });
  });

  it('accepts image/webp', () => {
    expect(validateMimeType('image/webp')).toEqual({ valid: true, error: null });
  });

  it('rejects image/gif', () => {
    const result = validateMimeType('image/gif');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('image/gif');
    expect(result.error).toContain('Accepted');
  });

  it('rejects application/pdf', () => {
    const result = validateMimeType('application/pdf');
    expect(result.valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateMimeType('').valid).toBe(false);
  });

  it('uses custom accepted types when provided', () => {
    expect(validateMimeType('image/gif', ['image/gif']).valid).toBe(true);
    expect(validateMimeType('image/jpeg', ['image/gif']).valid).toBe(false);
  });
});

// ── validateFileSize ──

describe('validateFileSize', () => {
  const MB = 1024 * 1024;

  it('accepts a 1 MB file (under 2 MB limit)', () => {
    expect(validateFileSize(1 * MB)).toEqual({ valid: true, error: null });
  });

  it('accepts a file exactly at the 2 MB limit', () => {
    expect(validateFileSize(2 * MB)).toEqual({ valid: true, error: null });
  });

  it('rejects a file over 2 MB', () => {
    const result = validateFileSize(2 * MB + 1);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
    expect(result.error).toContain('2 MB');
  });

  it('rejects an empty file (0 bytes)', () => {
    const result = validateFileSize(0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('uses custom max size', () => {
    expect(validateFileSize(5 * MB, 10).valid).toBe(true);
    expect(validateFileSize(5 * MB, 4).valid).toBe(false);
  });

  it('accepts 1 byte file', () => {
    expect(validateFileSize(1).valid).toBe(true);
  });
});

// ── validateDimensions ──

describe('validateDimensions', () => {
  it('accepts 256x256 (typical avatar)', () => {
    expect(validateDimensions(256, 256)).toEqual({ valid: true, error: null });
  });

  it('accepts exactly min dimensions (100x100)', () => {
    expect(validateDimensions(100, 100)).toEqual({ valid: true, error: null });
  });

  it('accepts exactly max dimensions (2048x2048)', () => {
    expect(validateDimensions(2048, 2048)).toEqual({ valid: true, error: null });
  });

  it('rejects image smaller than minimum', () => {
    const result = validateDimensions(50, 50);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too small');
    expect(result.error).toContain('50x50');
  });

  it('rejects image with only width below minimum', () => {
    const result = validateDimensions(50, 200);
    expect(result.valid).toBe(false);
  });

  it('rejects image with only height below minimum', () => {
    const result = validateDimensions(200, 50);
    expect(result.valid).toBe(false);
  });

  it('rejects image larger than maximum', () => {
    const result = validateDimensions(4096, 4096);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('rejects image with only width above maximum', () => {
    const result = validateDimensions(3000, 1000);
    expect(result.valid).toBe(false);
  });

  it('uses custom constraints', () => {
    const min = { width: 200, height: 200 };
    const max = { width: 500, height: 500 };
    expect(validateDimensions(300, 300, min, max).valid).toBe(true);
    expect(validateDimensions(100, 100, min, max).valid).toBe(false);
    expect(validateDimensions(600, 600, min, max).valid).toBe(false);
  });
});

// ── detectMimeFromBytes ──

describe('detectMimeFromBytes', () => {
  it('detects JPEG (FF D8 FF)', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(detectMimeFromBytes(buf)).toBe('image/jpeg');
  });

  it('detects PNG (89 50 4E 47)', () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMimeFromBytes(buf)).toBe('image/png');
  });

  it('detects WebP (RIFF....WEBP)', () => {
    // RIFF + 4 bytes size + WEBP
    const buf = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (don't care)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(detectMimeFromBytes(buf)).toBe('image/webp');
  });

  it('returns null for GIF', () => {
    // GIF89a
    const buf = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectMimeFromBytes(buf)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(detectMimeFromBytes(new Uint8Array([]))).toBeNull();
  });

  it('returns null for buffer too short', () => {
    expect(detectMimeFromBytes(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('returns null for random bytes', () => {
    const buf = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(detectMimeFromBytes(buf)).toBeNull();
  });

  it('correctly identifies JPEG even with EXIF header variant', () => {
    // FF D8 FF E1 (EXIF marker)
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]);
    expect(detectMimeFromBytes(buf)).toBe('image/jpeg');
  });
});

// ── validateAvatarFile ──

describe('validateAvatarFile', () => {
  it('accepts a valid JPEG under size limit', () => {
    const result = validateAvatarFile({ type: 'image/jpeg', size: 500_000 });
    expect(result).toEqual({ valid: true, error: null });
  });

  it('rejects invalid MIME type first', () => {
    const result = validateAvatarFile({ type: 'image/gif', size: 100 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('file type');
  });

  it('rejects oversized file after type check passes', () => {
    const result = validateAvatarFile({
      type: 'image/png',
      size: 10 * 1024 * 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('respects custom maxSizeMB', () => {
    const result = validateAvatarFile(
      { type: 'image/jpeg', size: 5 * 1024 * 1024 },
      10
    );
    expect(result.valid).toBe(true);
  });

  it('respects custom accepted types', () => {
    const result = validateAvatarFile(
      { type: 'image/gif', size: 100 },
      2,
      ['image/gif']
    );
    expect(result.valid).toBe(true);
  });
});

// ── Constants ──

describe('Constants', () => {
  it('default max size is 2 MB', () => {
    expect(DEFAULT_MAX_SIZE_MB).toBe(2);
  });

  it('default accepted types include jpeg, png, webp', () => {
    expect(DEFAULT_ACCEPTED_TYPES).toContain('image/jpeg');
    expect(DEFAULT_ACCEPTED_TYPES).toContain('image/png');
    expect(DEFAULT_ACCEPTED_TYPES).toContain('image/webp');
    expect(DEFAULT_ACCEPTED_TYPES).toHaveLength(3);
  });

  it('min dimensions are 100x100', () => {
    expect(MIN_DIMENSIONS).toEqual({ width: 100, height: 100 });
  });

  it('max dimensions are 2048x2048', () => {
    expect(MAX_DIMENSIONS).toEqual({ width: 2048, height: 2048 });
  });
});
