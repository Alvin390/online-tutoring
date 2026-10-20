import { useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { flagsStore } from './FlagsContext';
import logger from '@utils/logger';

/**
 * Live flags for staff pages — Phase 13 / 08 A1.
 *
 * One listener on `config/flags`, mounted only inside the staff shell, so a
 * superadmin's flag change reaches an open dashboard at once. Public pages get
 * flags from /api/public/bootstrap instead and never load Firestore.
 */
export default function FlagsLiveSync() {
  useEffect(() => onSnapshot(
    doc(db, 'config', 'flags'),
    (snap) => flagsStore.setFromRemote(snap.exists() ? snap.data() : null),
    (error) => logger.warn('Flags listener failed; keeping last known flags', { code: error?.code })
  ), []);
  return null;
}
