import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadReportAttachment } from '@services/api/reports';
import { ACCEPTED_TYPES, MAX_ATTACHMENTS } from '../constants';
import { blobToBase64, blobToDataUrl, compressInBackground } from '../utils/compressImage';

/**
 * Screenshots for a report — Phase 13 / 06 D2.
 *
 * Paste (the usual way a screenshot arrives), drag-and-drop, or pick. Each
 * image is compressed off the main thread, then the full image and its
 * thumbnail are uploaded under the draft's report id while the teacher keeps
 * typing. At most two uploads run at once; each tile can be cancelled.
 *
 * `screenshots` is owned by the parent (it is part of the saved draft); a tile
 * is `{ index, preview, width, height, status, error? }` where status is
 * 'working' | 'done' | 'error'. Only 'done' tiles are persisted and sent.
 */

const MAX_CONCURRENT = 2;

const freeIndex = (tiles) => {
  const used = new Set(tiles.map((t) => t.index));
  for (let i = 0; i < MAX_ATTACHMENTS; i += 1) if (!used.has(i)) return i;
  return null;
};

export default function ScreenshotPicker({ reportId, screenshots, onChange, disabled = false }) {
  const inputRef = useRef(null);
  const queue = useRef([]);
  const active = useRef(0);
  const controllers = useRef(new Map());
  const latest = useRef(screenshots);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);

  latest.current = screenshots;

  const update = useCallback((fn) => {
    const next = fn(latest.current);
    latest.current = next;
    onChange(next);
  }, [onChange]);

  const patchTile = useCallback((index, patch) => {
    update((tiles) => tiles.map((t) => (t.index === index ? { ...t, ...patch } : t)));
  }, [update]);

  const runJob = useCallback(async ({ index, file }) => {
    const controller = new AbortController();
    controllers.current.set(index, controller);
    try {
      const { full, thumb } = await compressInBackground(file);
      if (controller.signal.aborted) return;

      const preview = await blobToDataUrl((thumb ?? full).blob);
      patchTile(index, { preview, width: full.width, height: full.height });

      const result = await uploadReportAttachment({
        reportId, index, variant: 'full', contentType: full.type,
        data: await blobToBase64(full.blob), width: full.width, height: full.height,
      }, { signal: controller.signal });

      if (result?.duplicate) {
        update((tiles) => tiles.filter((t) => t.index !== index));
        setMessage('That screenshot is already attached.');
        return;
      }
      if (thumb) {
        await uploadReportAttachment({
          reportId, index, variant: 'thumb', contentType: thumb.type,
          data: await blobToBase64(thumb.blob), width: thumb.width, height: thumb.height,
        }, { signal: controller.signal });
      }
      patchTile(index, { status: 'done' });
    } catch (err) {
      if (controller.signal.aborted) return;
      patchTile(index, { status: 'error', error: err?.message ?? 'Upload failed.' });
    } finally {
      controllers.current.delete(index);
    }
  }, [reportId, patchTile, update]);

  const pump = useCallback(() => {
    while (active.current < MAX_CONCURRENT && queue.current.length > 0) {
      const job = queue.current.shift();
      active.current += 1;
      runJob(job).finally(() => {
        active.current -= 1;
        pump();
      });
    }
  }, [runJob]);

  const addFiles = useCallback((files) => {
    setMessage('');
    const images = [...files].filter((f) => f && f.type?.startsWith('image/'));
    if (images.length === 0) return;

    for (const file of images) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setMessage('Only PNG, JPEG or WebP images can be attached.');
        continue;
      }
      const index = freeIndex(latest.current);
      if (index === null) {
        setMessage(`You can attach up to ${MAX_ATTACHMENTS} screenshots.`);
        break;
      }
      update((tiles) => [...tiles, { index, preview: null, status: 'working' }]);
      queue.current.push({ index, file });
    }
    pump();
  }, [pump, update]);

  // A screenshot pasted anywhere in the open form lands here — teachers paste
  // into the description box as often as into the drop zone.
  useEffect(() => {
    if (disabled) return undefined;
    const onPaste = (event) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type?.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles, disabled]);

  // Cancel anything in flight if the form closes.
  useEffect(() => () => {
    for (const c of controllers.current.values()) c.abort();
  }, []);

  const remove = (index) => {
    controllers.current.get(index)?.abort();
    queue.current = queue.current.filter((job) => job.index !== index);
    update((tiles) => tiles.filter((t) => t.index !== index));
  };

  const full = screenshots.length >= MAX_ATTACHMENTS;

  return (
    <div className="report-screenshots">
      <div
        className={`report-dropzone${dragging ? ' is-dragging' : ''}${full || disabled ? ' is-disabled' : ''}`}
        role="button"
        tabIndex={full || disabled ? -1 : 0}
        aria-disabled={full || disabled}
        aria-describedby="report-screenshot-help"
        onClick={() => !full && !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !full && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onPaste={(e) => {
          // Handled by the document listener; stop the default text paste.
          if ([...(e.clipboardData?.files ?? [])].length) e.preventDefault();
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!full && !disabled) addFiles(e.dataTransfer?.files ?? []);
        }}
      >
        <i className="bi bi-image me-2" aria-hidden="true" />
        {full ? 'Three screenshots attached' : 'Paste, drop or click to add screenshots'}
      </div>
      <div id="report-screenshot-help" className="form-text">
        Up to {MAX_ATTACHMENTS} images (PNG, JPEG or WebP, under 10 MB each). They are shrunk before upload.
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        hidden
        data-testid="report-file-input"
        onChange={(e) => {
          addFiles(e.target.files ?? []);
          e.target.value = '';
        }}
      />

      {message && <div className="small text-danger mt-1" role="alert">{message}</div>}

      {screenshots.length > 0 && (
        <ul className="report-thumbs list-unstyled d-flex gap-2 mt-2 mb-0" aria-label="Attached screenshots">
          {[...screenshots].sort((a, b) => a.index - b.index).map((tile) => (
            <li key={tile.index} className="report-thumb" data-testid="report-thumb">
              {tile.preview
                ? <img src={tile.preview} alt={`Screenshot ${tile.index + 1}`} />
                : <div className="report-thumb-placeholder" aria-hidden="true" />}
              {tile.status === 'working' && (
                <div className="progress report-thumb-progress" role="progressbar" aria-label={`Uploading screenshot ${tile.index + 1}`}>
                  <div className="progress-bar progress-bar-striped progress-bar-animated w-100" />
                </div>
              )}
              {tile.status === 'error' && (
                <div className="report-thumb-error small text-danger" title={tile.error}>Failed</div>
              )}
              <button
                type="button"
                className="btn btn-sm btn-light report-thumb-remove"
                onClick={() => remove(tile.index)}
                aria-label={`Remove screenshot ${tile.index + 1}`}
                disabled={disabled}
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
