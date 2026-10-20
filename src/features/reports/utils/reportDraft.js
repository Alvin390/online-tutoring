/**
 * The unsent report, kept in sessionStorage — Phase 13 / 06 D6.
 *
 * Closing the modal by accident must not lose a carefully written report. The
 * draft carries the REPORT ID as well as the text: screenshots are uploaded
 * under that id while the teacher types, so reopening with a new id would
 * orphan them and the submit would fail with "attachments_missing". A fresh id
 * is made only after a successful submit (clearDraft).
 *
 * sessionStorage can throw (private mode, blocked storage) — every access is
 * guarded, and the form works without it.
 */

const KEY = 'tutoring.reportDraft.v1';

export const newReportId = () =>
  (globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export const emptyDraft = () => ({
  reportId: newReportId(),
  tab: 'bug',
  bug: { title: '', description: '', steps: '', expected: '', severity: '' },
  feature: { title: '', description: '', problem: '', urgency: '' },
  // [{ index, preview, width, height }] — only screenshots already uploaded.
  screenshots: [],
});

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.reportId !== 'string') return emptyDraft();
    const base = emptyDraft();
    return {
      ...base,
      ...parsed,
      bug: { ...base.bug, ...parsed.bug },
      feature: { ...base.feature, ...parsed.feature },
      screenshots: Array.isArray(parsed.screenshots) ? parsed.screenshots : [],
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Quota or blocked storage: the draft simply is not kept.
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
