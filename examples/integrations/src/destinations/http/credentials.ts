import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const keyBytes = 32;
const nonceBytes = 12;
const tagBytes = 16;

/** Ciphertext is bound to its owner and endpoint; the host supplies a stable secret. */
export function destinationCredentials(secret: string) {
  const key = Buffer.from(
    hkdfSync('sha256', secret, 'open-sync', 'destination-api-keys', keyBytes),
  );
  return {
    seal(input: { ownerId: string; endpoint: string; apiKey: string }): string {
      const nonce = randomBytes(nonceBytes);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify([input.ownerId, input.endpoint])));
      const data = Buffer.concat([cipher.update(input.apiKey, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url');
    },
    open(input: { ownerId: string; endpoint: string; credential: string }): string {
      const data = Buffer.from(input.credential, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, nonceBytes));
      decipher.setAAD(Buffer.from(JSON.stringify([input.ownerId, input.endpoint])));
      decipher.setAuthTag(data.subarray(nonceBytes, nonceBytes + tagBytes));
      return Buffer.concat([
        decipher.update(data.subarray(nonceBytes + tagBytes)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
