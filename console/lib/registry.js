import { randomUUID } from 'node:crypto';

/**
 * The console's list of schools — 013Fixes / 38a. Kept in the console's own
 * KV (binding CONSOLE_KV, key "registry"), edited in the console.
 *
 * Each school: { id, name, url, secretRef?, binding? }
 *   url        the school's https origin (no path, no credentials, not an IP
 *              or localhost), so the console only ever signs requests to a
 *              real school address
 *   secretRef  optional NAME of a console secret to sign with
 *              (CONSOLE_SECRET_<X>); without it, the shared CONSOLE_SECRET.
 *              Never a secret itself.
 *   binding    optional NAME of a Service Binding to that school's Worker
 *              (same Cloudflare zone: see console/lib/fetchStatus.js)
 */

const KEY = 'registry';
export const MAX_SCHOOLS = 50;
const SECRET_REF = /^CONSOLE_SECRET(_[A-Z0-9]{1,30})?$/;
const BINDING = /^[A-Z][A-Z0-9_]{2,40}$/;

export class RegistryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The https origin of a school address, or a 400. */
export function schoolOrigin(raw) {
  let url;
  try { url = new URL(String(raw ?? '').trim()); } catch { throw new RegistryError(400, 'bad_url', 'Enter the school’s full https address.'); }
  const host = url.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  if (url.protocol !== 'https:' || url.username || url.password || isIp || host === 'localhost' || !host.includes('.')
    || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new RegistryError(400, 'bad_url', 'Use the school’s https address only, like https://school.example.');
  }
  return url.origin;
}

export async function readRegistry(kv) {
  const list = await kv.get(KEY, 'json');
  return Array.isArray(list) ? list : [];
}

async function save(kv, list) {
  await kv.put(KEY, JSON.stringify(list));
  return list;
}

export async function addSchool(kv, { name, url, secretRef, binding }) {
  const cleanName = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!cleanName || cleanName.length > 60) throw new RegistryError(400, 'bad_name', 'Give the school a name (up to 60 characters).');
  const origin = schoolOrigin(url);
  if (secretRef != null && secretRef !== '' && !SECRET_REF.test(secretRef)) {
    throw new RegistryError(400, 'bad_secret_ref', 'The secret is named like CONSOLE_SECRET or CONSOLE_SECRET_SCHOOL (the name, never the secret).');
  }
  if (binding != null && binding !== '' && !BINDING.test(binding)) throw new RegistryError(400, 'bad_binding', 'A binding name is capital letters, digits and _.');
  const list = await readRegistry(kv);
  if (list.some((s) => s.url === origin)) throw new RegistryError(409, 'duplicate', 'That school is already listed.');
  if (list.length >= MAX_SCHOOLS) throw new RegistryError(409, 'full', `Up to ${MAX_SCHOOLS} schools.`);
  const school = {
    id: randomUUID().slice(0, 8), name: cleanName, url: origin,
    ...(secretRef ? { secretRef } : {}), ...(binding ? { binding } : {}),
  };
  return save(kv, [...list, school]);
}

export async function removeSchool(kv, id) {
  const list = await readRegistry(kv);
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) throw new RegistryError(404, 'not_found', 'That school is not listed.');
  return save(kv, next);
}
