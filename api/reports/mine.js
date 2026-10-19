import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';

/**
 * The signed-in teacher's own reports — Phase 13 / 06 D3 ("Your reports").
 * Newest 20, summary fields only. Never another teacher's.
 */
export default createHandler({
  method: 'GET',
  auth: true,
  role: 'teacher',
  rateLimit: { bucket: 'reports_mine', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ user }) => {
    const snap = await getDb()
      .collection('reports')
      .where('submittedBy.uid', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    return {
      ok: true,
      reports: snap.docs.map((d) => {
        const r = d.data();
        return {
          id: d.id,
          type: r.type,
          number: r.number,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt?.toDate?.()?.toISOString() ?? null,
          responseDueAt: r.responseDueAt?.toDate?.()?.toISOString() ?? null,
        };
      }),
    };
  },
});
