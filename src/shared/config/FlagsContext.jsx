import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { DEFAULT_FLAGS, resolveFlags } from './flags';
import logger from '@utils/logger';

/**
 * Flag provider — Phase 01 D6.
 *
 * One listener on one document for the whole app. Flags render against the
 * defaults immediately rather than blocking on the read: a flag fetch is not
 * worth a blank screen, and every default is the conservative (off) value, so
 * the worst case of rendering early is that a feature appears a beat late.
 */

const FlagsContext = createContext(DEFAULT_FLAGS);

export function FlagsProvider({ children }) {
  const [flags, setFlags] = useState(DEFAULT_FLAGS);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'config', 'flags'),
      (snap) => setFlags(resolveFlags(snap.exists() ? snap.data() : null)),
      (error) => {
        // Non-fatal: the app runs on defaults. `config/flags` is world-readable
        // by design (booleans, no PII), so this should only fire on a genuine
        // connectivity problem.
        logger.warn('Flags listener failed; using defaults', { code: error?.code });
      }
    );
    return unsubscribe;
  }, []);

  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

/** Returns the whole flag map. */
export function useFlags() {
  return useContext(FlagsContext);
}

/** Returns one boolean, so a consumer does not re-render on unrelated flags. */
export function useFlag(key) {
  const flags = useContext(FlagsContext);
  return useMemo(() => flags[key] === true, [flags, key]);
}

export { FlagsContext };
