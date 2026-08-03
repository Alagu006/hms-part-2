/**
 * UUID v7 generator — time-ordered, sortable.
 * Spec: https://www.ietf.org/rfc/rfc9562 §5.7
 *
 * Layout (128 bits):
 *   48 bits  unix_ts_ms
 *    4 bits  version = 0x7
 *   12 bits  rand_a
 *    2 bits  variant = 0b10
 *   62 bits  rand_b
 */
import { randomBytes } from 'crypto';

export function uuidv7() {
  const now = BigInt(Date.now());

  // 48-bit timestamp
  const tsHigh = (now >> 16n) & 0xffffffffn;
  const tsLow  = now & 0xffffn;

  // 12 random bits (rand_a) + 62 random bits (rand_b)
  const rand = randomBytes(10);
  const randA = ((rand[0] & 0x0f) << 8) | rand[1];          // 12 bits
  const randBHi = ((rand[2] & 0x3f) << 8) | rand[3];        // 14 bits (variant + 12)
  const randBLo = (rand[4] * 0x1000000) + (rand[5] << 16) + (rand[6] << 8) + rand[7]; // 32 bits (unsigned — avoid << overflow past bit 31)
  const randBEx = (rand[8] << 8) | rand[9];                  // 16 bits

  const hex = [
    tsHigh.toString(16).padStart(8, '0'),
    tsLow.toString(16).padStart(4, '0'),
    (0x7000 | randA).toString(16).padStart(4, '0'),
    (0x8000 | randBHi).toString(16).padStart(4, '0'),
    randBLo.toString(16).padStart(8, '0') + randBEx.toString(16).padStart(4, '0'),
  ];

  return `${hex[0]}-${hex[1]}-${hex[2]}-${hex[3]}-${hex[4]}`;
}
