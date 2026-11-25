import { getPublicBootstrap } from '@services/api/public';
import { flagsStore } from '@shared/config/FlagsContext';
import { resolveFlags } from '@shared/config/flags';

/**
 * Settings that changed while the page was open — 012Fixes / 05, ported in
 * 014Fixes / 07.
 *
 * On 16 Nov admission numbers were switched off at 19:41 EAT while students
 * were part-way through registering: their pages still had the old settings
 * (the bootstrap is cached), so for about 10 minutes register codes got "not
 * found" and code entries were refused, until they reloaded.
 *
 * When an answer shows this page's settings may be out of date, the page
 * asks again, past the browser's cache, and stores the answer for every
 * screen. Returns { numbers } as the server has it now, or null when there is
 * no answer (the page then carries on as it was). One request, only then.
 */
export async function resyncSettings() {
  try {
    const data = await getPublicBootstrap({ force: true, fresh: true });
    flagsStore.setFromRemote(data?.flags);
    const flags = resolveFlags(data?.flags ?? null);
    return { numbers: flags['checkin.admissionNumbers'] === true };
  } catch {
    return null;
  }
}
