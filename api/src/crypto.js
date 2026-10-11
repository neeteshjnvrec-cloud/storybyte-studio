/**
 * Encrypts OAuth tokens before they're stored, in exactly the format the
 * video worker's Node decrypt() reads (worker/src/crypto.js):
 * "v1:<iv b64>:<auth tag b64>:<ciphertext b64>", AES-256-GCM, with
 * TOKEN_KEY a base64-encoded 32-byte key.
 */
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export async function encrypt(value, tokenKey) {
  const raw = Uint8Array.from(atob(tokenKey || ''), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('TOKEN_KEY must be a base64-encoded 32-byte key');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  // WebCrypto appends the 16-byte tag to the ciphertext; the stored format keeps them apart.
  return ['v1', b64(iv), b64(sealed.slice(-16)), b64(sealed.slice(0, -16))].join(':');
}
