export const JACCARD_SIMILAR_THRESHOLD_ACU = 0.7;

const SHA1_K_ACU = new Uint32Array([
  0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6,
]);

function rotl_ACU(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function sha1Bytes_ACU(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i += 1) w[i] = rotl_ACU(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) >>> 0;

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = SHA1_K_ACU[0];
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = SHA1_K_ACU[1];
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = SHA1_K_ACU[2];
      } else {
        f = b ^ c ^ d;
        k = SHA1_K_ACU[3];
      }
      const temp = (rotl_ACU(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl_ACU(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  out.setUint32(0, h0, false);
  out.setUint32(4, h1, false);
  out.setUint32(8, h2, false);
  out.setUint32(12, h3, false);
  out.setUint32(16, h4, false);
  return digest;
}

function hex_ACU(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function utf8_ACU(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function sha1Hex_ACU(value: string): string {
  return hex_ACU(sha1Bytes_ACU(utf8_ACU(value)));
}

/** 去空白、大小写折叠、去标点/符号后的紧凑文本，用于指纹哈希。 */
export function normalizeEventText_ACU(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function eventTokens_ACU(value: string): Set<string> {
  const prepared = value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ');
  const tokens = new Set<string>();
  for (const part of prepared.split(/\s+/).filter(Boolean)) {
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(part)) {
      for (const char of part) tokens.add(char);
    } else {
      tokens.add(part);
    }
  }
  return tokens;
}

export function eventFingerprint_ACU(summary: string, at: string, relatedIds: readonly string[]): string {
  const related = [...relatedIds].map(item => item.trim()).filter(Boolean).sort();
  return sha1Hex_ACU(`${normalizeEventText_ACU(summary)}${at}${related.join(',')}`);
}

export function fuzzySimilarity_ACU(a: string, b: string): number {
  const left = eventTokens_ACU(a);
  const right = eventTokens_ACU(b);
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}
