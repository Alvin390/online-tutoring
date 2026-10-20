import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { useAuthState } from '@features/auth/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';

/**
 * Private student notes — Phase 05 Part B.
 *
 * Direct Firestore rather than a serverless endpoint, deliberately: the
 * collection is teacher-only in `firestore.rules` with no student clause at
 * all, so rules are already a complete control here. Going through the API
 * would add a round trip and lose realtime for no security gain.
 *
 * The listener is created ONLY when the drawer opens (`enabled`), so notes are
 * never part of the dashboard's initial payload. On a roster of 200 students
 * that is 200 collections the dashboard does not read.
 *
 * Deletion is SOFT (`deletedAt`), with a 30-day window. A note is often the
 * only record of a conversation with a parent, and a mis-click should not
 * destroy it.
 */

const RECOVERY_WINDOW_DAYS = 30;
const RECOVERY_WINDOW_MS = RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : null);

export const useStudentNotes = ({ session, phone, enabled = false }) => {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { user } = useAuthState();
  const { showSuccess, showError } = useToast();

  const path = session && phone ? `sessions/${session}/students/${phone}/notes` : null;

  useEffect(() => {
    if (!enabled || !path) {
      setNotes([]);
      return undefined;
    }

    setLoading(true);
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = [];
        snapshot.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setNotes(list);
        setLoading(false);
      },
      (error) => {
        logger.error('Notes listener failed', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [enabled, path]);

  /** Live notes only. Soft-deleted ones stay out of the UI but not out of the DB. */
  const visibleNotes = useMemo(() => notes.filter((n) => !n.deletedAt), [notes]);

  /** Every tag used on this student, for the composer's autocomplete. */
  const knownTags = useMemo(() => {
    const set = new Set();
    for (const note of visibleNotes) {
      for (const tag of note.tags ?? []) set.add(tag);
    }
    return [...set].sort();
  }, [visibleNotes]);

  const addNote = useCallback(
    async (bodyText, tags = []) => {
      if (!path || !bodyText.trim()) return { success: false };

      setSaving(true);
      try {
        await addDoc(collection(db, path), {
          body: bodyText.trim(),
          tags: tags.filter(Boolean).slice(0, 10),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user?.uid ?? null,
          deletedAt: null,
        });
        showSuccess('Note saved.');
        return { success: true };
      } catch (error) {
        logger.error('Add note failed', error);
        showError('Could not save that note. Please try again.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [path, user?.uid, showSuccess, showError]
  );

  const editNote = useCallback(
    async (noteId, bodyText, tags) => {
      if (!path) return { success: false };
      setSaving(true);
      try {
        await updateDoc(doc(db, path, noteId), {
          body: bodyText.trim(),
          ...(tags ? { tags: tags.filter(Boolean).slice(0, 10) } : {}),
          updatedAt: serverTimestamp(),
        });
        return { success: true };
      } catch (error) {
        logger.error('Edit note failed', error);
        showError('Could not update that note.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [path, showError]
  );

  const restoreNote = useCallback(
    async (noteId) => {
      if (!path) return { success: false };
      try {
        await updateDoc(doc(db, path, noteId), { deletedAt: null });
        showSuccess('Note restored.');
        return { success: true };
      } catch (error) {
        logger.error('Restore note failed', error);
        showError('Could not restore that note.');
        return { success: false };
      }
    },
    [path, showSuccess, showError]
  );

  const deleteNote = useCallback(
    async (noteId) => {
      if (!path) return { success: false };
      try {
        // Soft delete. The note stays for RECOVERY_WINDOW_DAYS so an accidental
        // tap is recoverable; a hard delete of a parent conversation is not.
        // Phase 13 / 07 D4: the toast carries an Undo for 8 seconds, and the
        // Notes tab lists "Recently deleted" for the rest of the window.
        await updateDoc(doc(db, path, noteId), { deletedAt: serverTimestamp() });
        showSuccess(`Recoverable for ${RECOVERY_WINDOW_DAYS} days.`, 'Note deleted', {
          duration: 8000,
          action: { label: 'Undo', onClick: () => { restoreNote(noteId); } },
        });
        return { success: true };
      } catch (error) {
        logger.error('Delete note failed', error);
        showError('Could not delete that note.');
        return { success: false };
      }
    },
    [path, restoreNote, showSuccess, showError]
  );

  /**
   * Soft-deleted notes still inside the recovery window, newest deletion
   * first. Older ones are purged by the nightly sweep (feesSweep); until it
   * runs they are simply not offered. A just-deleted note whose server
   * timestamp has not resolved yet counts as "now".
   */
  const deletedNotes = useMemo(() => {
    const cutoff = Date.now() - RECOVERY_WINDOW_MS;
    return notes
      .filter((n) => n.deletedAt && (millis(n.deletedAt) ?? Date.now()) >= cutoff)
      .sort((a, b) => (millis(b.deletedAt) ?? Date.now()) - (millis(a.deletedAt) ?? Date.now()));
  }, [notes]);

  return {
    notes: visibleNotes,
    deletedNotes,
    knownTags,
    loading,
    saving,
    addNote,
    editNote,
    deleteNote,
    restoreNote,
  };
};

export { RECOVERY_WINDOW_DAYS };
