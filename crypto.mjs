// Shared, dependency-free Web Crypto format. This file is intentionally public.
export const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export function username(value) {
  const result = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(result)) throw new Error('Invalid username');
  return result;
}
export function validatePassword(value) {
  if (typeof value !== 'string' || value.trim().length < 24 || value.length > 1024 || /REPLACE_WITH|CHANGE_ME/i.test(value)) {
    throw new Error('Use a password-manager-generated password of at least 24 characters');
  }
}
export function base64(bytes) {
  return btoa(Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join(''));
}
export function unbase64(value, length) {
  if (typeof value !== 'string' || value.length > 48_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid encrypted archive');
  const result = Uint8Array.from(atob(value), b => b.charCodeAt(0));
  if (length !== undefined && result.length !== length) throw new Error('Invalid encrypted archive');
  return result;
}
const context = (slug, purpose, id = '') => enc.encode(`team-archive:v1:${slug}:${purpose}:${id}`);
async function userId(name) {
  return base64(await crypto.subtle.digest('SHA-256', enc.encode(username(name))));
}
async function passwordKey(name, password, salt) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  // Domain-separate users even if they happen to choose the same password.
  const fullSalt = new Uint8Array([...salt, ...enc.encode(`:${username(name)}`)]);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fullSalt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function validateEnvelope(value, slug) {
  if (!value || value.format !== 'team-archive-v1' || value.workspace !== slug || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS) throw new Error('Unsupported encrypted archive');
  const keys = ['format', 'workspace', 'kdf', 'iterations', 'iv', 'ciphertext', 'readers'];
  if (Object.keys(value).sort().join() !== keys.sort().join() || !value.readers || Array.isArray(value.readers) || Object.keys(value.readers).length < 1 || Object.keys(value.readers).length > 100) throw new Error('Invalid encrypted archive');
  unbase64(value.iv, 12);
  if (unbase64(value.ciphertext).length < 16) throw new Error('Invalid encrypted archive');
  for (const [id, reader] of Object.entries(value.readers)) {
    unbase64(id, 32);
    if (!reader || Object.keys(reader).sort().join() !== ['salt', 'iv', 'key'].sort().join()) throw new Error('Invalid reader');
    unbase64(reader.salt, 16); unbase64(reader.iv, 12); unbase64(reader.key, 48);
  }
  return value;
}
export async function encryptArchive(payload, slug, readers) {
  if (!readers.length) throw new Error('Every archive needs an approved reader');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(slug, 'data') }, key, enc.encode(JSON.stringify(payload)));
  const wrapped = Object.create(null);
  try {
    for (const reader of readers) {
      const name = username(reader.username); validatePassword(reader.password);
      const id = await userId(name);
      if (Object.hasOwn(wrapped, id)) throw new Error('Duplicate username');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const wrappingKey = await passwordKey(name, reader.password, salt);
      wrapped[id] = { salt: base64(salt), iv: base64(nonce), key: base64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: context(slug, 'reader', id) }, wrappingKey, bytes)) };
    }
  } finally { bytes.fill(0); }
  return validateEnvelope({ format: 'team-archive-v1', workspace: slug, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, iv: base64(iv), ciphertext: base64(ciphertext), readers: wrapped }, slug);
}
export async function decryptArchive(envelope, slug, name, password) {
  validateEnvelope(envelope, slug);
  const id = await userId(name), reader = envelope.readers[id];
  // Do the same KDF work for an unknown username before returning a generic error.
  const salt = reader ? unbase64(reader.salt, 16) : new Uint8Array(16);
  const wrappingKey = await passwordKey(name, password, salt);
  if (!reader) throw new Error('Unable to unlock');
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(reader.iv, 12), additionalData: context(slug, 'reader', id) }, wrappingKey, unbase64(reader.key, 48)));
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(envelope.iv, 12), additionalData: context(slug, 'data') }, key, unbase64(envelope.ciphertext));
    return JSON.parse(dec.decode(clear));
  } finally { bytes?.fill(0); }
}
