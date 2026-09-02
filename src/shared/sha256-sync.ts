/**
 * 同步 SHA-256（FIPS 180-4），供“必须在同步调用链里得到稠密指纹”的场景使用。
 * Web Crypto 的 subtle.digest 只有异步接口，而向量索引的 scope 指纹在十余处同步代码里被当作
 * 路径段 / 比对键使用，把整条调用链改成 async 的收益远低于内置一份 60 行的纯实现。
 * 输入按 UTF-8 编码；输出与 crypto.subtle.digest('SHA-256') 逐字节一致。
 */

const SHA256_K_ACU = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr_ACU(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

export function sha256BytesSync_ACU(input: Uint8Array): Uint8Array {
    const bitLength = input.length * 8;
    // 填充：1 字节 0x80 + 若干 0x00 + 8 字节大端比特长度，总长为 64 的整数倍。
    const paddedLength = (((input.length + 9) + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;
    const view = new DataView(padded.buffer);
    // JS 位运算只到 32 位，长度高位单独用除法写入。
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    const state = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            w[index] = view.getUint32(offset + index * 4, false);
        }
        for (let index = 16; index < 64; index += 1) {
            const w15 = w[index - 15];
            const w2 = w[index - 2];
            const s0 = rotr_ACU(w15, 7) ^ rotr_ACU(w15, 18) ^ (w15 >>> 3);
            const s1 = rotr_ACU(w2, 17) ^ rotr_ACU(w2, 19) ^ (w2 >>> 10);
            w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
        }

        let a = state[0];
        let b = state[1];
        let c = state[2];
        let d = state[3];
        let e = state[4];
        let f = state[5];
        let g = state[6];
        let h = state[7];

        for (let index = 0; index < 64; index += 1) {
            const bigSigma1 = rotr_ACU(e, 6) ^ rotr_ACU(e, 11) ^ rotr_ACU(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + bigSigma1 + choose + SHA256_K_ACU[index] + w[index]) >>> 0;
            const bigSigma0 = rotr_ACU(a, 2) ^ rotr_ACU(a, 13) ^ rotr_ACU(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (bigSigma0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        state[0] = (state[0] + a) >>> 0;
        state[1] = (state[1] + b) >>> 0;
        state[2] = (state[2] + c) >>> 0;
        state[3] = (state[3] + d) >>> 0;
        state[4] = (state[4] + e) >>> 0;
        state[5] = (state[5] + f) >>> 0;
        state[6] = (state[6] + g) >>> 0;
        state[7] = (state[7] + h) >>> 0;
    }

    const digest = new Uint8Array(32);
    const digestView = new DataView(digest.buffer);
    for (let index = 0; index < 8; index += 1) {
        digestView.setUint32(index * 4, state[index], false);
    }
    return digest;
}

export function sha256TextSync_ACU(text: string): Uint8Array {
    return sha256BytesSync_ACU(new TextEncoder().encode(String(text ?? '')));
}

export function sha256HexSync_ACU(text: string): string {
    return Array.from(sha256TextSync_ACU(text)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** base64url（无 padding），32 字节摘要恒为 43 字符，字母表 [A-Za-z0-9_-]。 */
export function sha256Base64UrlSync_ACU(text: string): string {
    const bytes = sha256TextSync_ACU(text);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
