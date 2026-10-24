/**
 * Browser links for the availability page: `<PUBLIC_URL>/?t=<token>`.
 * Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature), signed on the server
 * with LINK_SIGNING_SECRET. The client may read the payload (it is not secret) but only the
 * server can verify it.
 */
export type LinkPayload = { g: number; m: number; n: string; exp: number };

const fromB64Url = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Reads the payload without verifying it (verification happens on the server). */
export function peekLinkToken(token: string): LinkPayload | null {
  try {
    const p = JSON.parse(fromB64Url(token.split('.')[0] ?? '')) as LinkPayload;
    return typeof p.g === 'number' && typeof p.m === 'number' ? p : null;
  } catch {
    return null;
  }
}
