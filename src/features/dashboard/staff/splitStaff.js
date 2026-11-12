/**
 * 007Fixes / 09 — one pass over a roster snapshot: students, and staff "on
 * the side" (owner). Order is kept; only an explicit `staff: true` is staff
 * (ordinary records have no such field).
 * @returns {{ students: object[], staff: object[] }}
 */
export function splitStaff(list) {
  const students = [];
  const staff = [];
  for (const record of list ?? []) (record?.staff === true ? staff : students).push(record);
  return { students, staff };
}
