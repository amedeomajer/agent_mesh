import React, { useCallback, useRef, useState, useEffect } from 'react';

// ── Types ──

export interface AvatarUploadProps {
  userId: string;
  currentAvatarUrl?: string;
  onUploadComplete: (url: string) => void;
  onError?: (error: Error) => void;
  maxSizeMB?: number;
  acceptedTypes?: string[];
}

interface UploadState {
  status: 'idle' | 'previewing' | 'uploading' | 'success' | 'error';
  previewUrl: string | null;
  progress: number;
  errorMessage: string | null;
}

// ── Constants ──

const DEFAULT_MAX_SIZE_MB = 2;
const DEFAULT_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ── Helpers ──

function formatAcceptString(types: string[]): string {
  return types.join(',');
}

function validateFile(
  file: File,
  maxSizeMB: number,
  acceptedTypes: string[]
): string | null {
  if (!acceptedTypes.includes(file.type)) {
    return `Invalid file type "${file.type}". Accepted: ${acceptedTypes.join(', ')}`;
  }
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum: ${maxSizeMB} MB`;
  }
  return null;
}

// ── Component ──

export function AvatarUpload({
  userId,
  currentAvatarUrl,
  onUploadComplete,
  onError,
  maxSizeMB = DEFAULT_MAX_SIZE_MB,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
}: AvatarUploadProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const errorId = `avatar-error-${userId}`;

  const [state, setState] = useState<UploadState>({
    status: 'idle',
    previewUrl: null,
    progress: 0,
    errorMessage: null,
  });

  // Clean up object URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
      }
    };
  }, [state.previewUrl]);

  const displayUrl =
    state.previewUrl ?? currentAvatarUrl ?? null;

  // ── File selection ──

  const handleFileSelect = useCallback(
    (file: File) => {
      const validationError = validateFile(file, maxSizeMB, acceptedTypes);
      if (validationError) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: validationError,
        }));
        onError?.(new Error(validationError));
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      setState({
        status: 'previewing',
        previewUrl,
        progress: 0,
        errorMessage: null,
      });
    },
    [maxSizeMB, acceptedTypes, onError]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFileSelect]
  );

  // ── Drag & drop ──

  const [dragging, setDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  // ── Keyboard & click triggers ──

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker]
  );

  // ── Upload ──

  const handleUpload = useCallback(async () => {
    if (!fileInputRef.current?.files?.[0] && !state.previewUrl) return;

    // We need the original file — get it from the hidden input or reconstruct
    // For a real implementation this would use the File object stored in state;
    // here we use fetch on the blob URL to re-obtain the blob.
    let blob: Blob;
    try {
      const resp = await fetch(state.previewUrl!);
      blob = await resp.blob();
    } catch {
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: 'Failed to read selected file.',
      }));
      return;
    }

    const formData = new FormData();
    formData.append('file', blob, 'avatar');

    setState((prev) => ({ ...prev, status: 'uploading', progress: 0 }));

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/users/${userId}/avatar`);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setState((prev) => ({ ...prev, progress: pct }));
        }
      });

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const data = JSON.parse(xhr.responseText) as { avatarUrl: string };
            setState({
              status: 'success',
              previewUrl: null,
              progress: 100,
              errorMessage: null,
            });
            onUploadComplete(data.avatarUrl);
            // Return focus to the trigger after success
            triggerRef.current?.focus();
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Upload failed';
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: message,
        progress: 0,
      }));
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [state.previewUrl, userId, onUploadComplete, onError]);

  // ── Delete ──

  const handleDelete = useCallback(async () => {
    try {
      const resp = await fetch(`/api/users/${userId}/avatar`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        throw new Error(`Delete failed: ${resp.status}`);
      }
      setState({
        status: 'idle',
        previewUrl: null,
        progress: 0,
        errorMessage: null,
      });
      onUploadComplete('');
      triggerRef.current?.focus();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Delete failed';
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: message,
      }));
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [userId, onUploadComplete, onError]);

  // ── Render ──

  return (
    <div className="avatar-upload" data-testid="avatar-upload">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={formatAcceptString(acceptedTypes)}
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: 'none' }}
        data-testid="avatar-file-input"
      />

      {/* Avatar trigger area */}
      <div
        ref={triggerRef}
        role="button"
        aria-label="Upload avatar"
        aria-describedby={state.errorMessage ? errorId : undefined}
        tabIndex={0}
        className={`avatar-upload__trigger${dragging ? ' avatar-upload__trigger--dragging' : ''}`}
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="avatar-trigger"
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={`Avatar for user ${userId}`}
            className="avatar-upload__image"
            data-testid="avatar-image"
          />
        ) : (
          <div
            className="avatar-upload__placeholder"
            data-testid="avatar-placeholder"
          >
            <span aria-hidden="true">+</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {state.status === 'uploading' && (
        <div
          role="progressbar"
          aria-valuenow={state.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
          className="avatar-upload__progress"
          data-testid="avatar-progress"
        >
          <div
            className="avatar-upload__progress-bar"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      )}

      {/* Error message */}
      {state.errorMessage && (
        <p
          id={errorId}
          role="alert"
          className="avatar-upload__error"
          data-testid="avatar-error"
        >
          {state.errorMessage}
        </p>
      )}

      {/* Action buttons */}
      <div className="avatar-upload__actions">
        {state.status === 'previewing' && (
          <button
            type="button"
            onClick={handleUpload}
            className="avatar-upload__btn avatar-upload__btn--upload"
            data-testid="avatar-upload-btn"
          >
            Upload
          </button>
        )}

        {(currentAvatarUrl || state.status === 'success') && (
          <button
            type="button"
            onClick={handleDelete}
            className="avatar-upload__btn avatar-upload__btn--remove"
            data-testid="avatar-remove-btn"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default AvatarUpload;
