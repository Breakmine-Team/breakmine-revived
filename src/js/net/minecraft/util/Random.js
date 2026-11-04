import Long from "../../../../../libraries/long.js";

// Java-compatible 48-bit LCG: seed = (seed * 25214903917 + 0xB) & ((1 << 48) - 1)
// Implemented with plain 32-bit limbs (no long.js / BigInt) for speed.
// multiplier 25214903917 = 5 * 2^32 + 0xDEECE66D
const MULT_HI = 0x5;
const MULT_LO = 0xDEECE66D;
const MULT_LO_HI = 0xDEEC; // MULT_LO >>> 16
const MULT_LO_LO = 0xE66D; // MULT_LO & 0xFFFF
const ADDEND = 0xB;

// skip(n) support: precompute affine transforms for 2^i-step advances.
// A single LCG step is state' = (state * M + C) mod 2^48, stored as 48-bit
// values (hi16, lo32). P[i] is the transform for 2^i consecutive steps:
//   m = M^(2^i) mod 2^48
//   a = C * (1 + M + M^2 + ... + M^(2^i - 1)) mod 2^48
const M_BIG = 0x5DEECE66Dn;
const C_BIG = 0xBn;
const MASK48 = (1n << 48n) - 1n;

function affineCompose(outerM, outerA, innerM, innerA) {
    return [
        (outerM * innerM) & MASK48,
        (outerM * innerA + outerA) & MASK48,
    ];
}

const SKIP_TABLE = [];
{
    let m = M_BIG;
    let a = C_BIG;
    for (let i = 0; i < 48; i++) {
        const mh = Number(m >> 32n);
        const ml = Number(m & 0xFFFFFFFFn);
        const ah = Number(a >> 32n);
        const al = Number(a & 0xFFFFFFFFn);
        SKIP_TABLE.push([mh, ml, ah, al]);
        [m, a] = affineCompose(m, a, m, a);
    }
}

export default class Random {

    static instances = 0;

    constructor(seed = Date.now() % 1000000000 ^ Random.instances++ * 1000) {
        this.doubleUnit = 1.1102230246251565E-16;
        this._hi = 0; // high 16 bits of the 48-bit seed
        this._lo = 0; // low 32 bits of the 48-bit seed
        this.setSeed(seed);
    }

    get seed() {
        return Long.fromBits(this._lo, this._hi);
    }

    set seed(value) {
        this.setSeed(value);
    }

    nextBytes(bytes, length) {
        let i = 0;
        while (i < length) {
            let rnd = this.nextInt();
            let n = Math.min(length - i, 32 / 8);

            while (n-- > 0) {
                bytes[i++] = rnd & 0xff;
                rnd >>= 8;
            }
        }
    }

    nextFloat() {
        return this.next(24) / 16777216;
    }

    nextDouble() {
        return ((this.next(26) * 134217728) + this.next(27)) * this.doubleUnit;
    }

    nextInt(max = -1) {
        if (max === -1) {
            return this.next(32);
        }

        let r = this.next(31);
        let m = max - 1;
        if ((max & m) === 0) {
            return Math.floor(max * r / 2147483648);
        }

        for (let u = r; u - (r = u % max) + m < 0; u = this.next(31));
        return r;
    }

    nextLong() {
        const hi = this.next(32);
        const lo = this.next(32);
        return Long.fromBits(lo, lo < 0 ? hi - 1 : hi);
    }

    next(bits) {
        const sLo = this._lo;
        const sHi = this._hi;
        const a = sLo >>> 16;
        const b = sLo & 0xFFFF;
        const bd = b * MULT_LO_LO;
        const t16 = a * MULT_LO_LO + b * MULT_LO_HI + (bd >>> 16);
        const lo = (bd & 0xFFFF) | ((t16 & 0xFFFF) << 16);
        const carry = (t16 >>> 16) + (a * MULT_LO_HI & 0xFFFF) + sHi * MULT_LO + sLo * MULT_HI;

        let loFinal = lo + ADDEND;
        let hiFinal;
        if (loFinal > 0xFFFFFFFF) {
            loFinal -= 0x100000000;
            hiFinal = (carry + 1) & 0xFFFF;
        } else {
            hiFinal = carry & 0xFFFF;
        }
        this._lo = loFinal;
        this._hi = hiFinal;

        const value = hiFinal * (1 << (32 - (48 - bits))) + (loFinal >>> (48 - bits));
        return value >= 0x80000000 ? value - 0x100000000 : value;
    }

    // Advance the LCG by exactly `n` single steps without iterating, using the
    // closed-form affine transform state' = (M^n * state + A_n) mod 2^48.
    // All arithmetic is exact: 48-bit values live as (hi16, lo32) pairs and
    // every intermediate product stays well under 2^53.
    skip(n) {
        n = n >>> 0;
        let mh = 0;
        let ml = 1;
        let ah = 0;
        let al = 0;
        let i = 0;
        while (n > 0) {
            if (n & 1) {
                const [sh, sl, ah2, al2] = SKIP_TABLE[i];
                // compose (m,a) = P[i] o (m,a): m' = m_i*m ; a' = m_i*a + a_i
                const k2 = sh;        // m_i limbs (16-bit each)
                const k1 = sl >>> 16;
                const k0 = sl & 0xFFFF;
                const j2 = mh;        // m limbs
                const j1 = ml >>> 16;
                const j0 = ml & 0xFFFF;

                let prod0 = k0 * j0;
                let r0 = prod0 & 0xFFFF;
                let carry = prod0 >>> 16;
                let prod1 = k0 * j1 + k1 * j0 + carry;
                let r1 = prod1 & 0xFFFF;
                carry = prod1 >>> 16;
                let prod2 = k0 * j2 + k1 * j1 + k2 * j0 + carry;
                const mhi = prod2 & 0xFFFF;
                const mlo = ((r1 << 16) | r0) >>> 0;

                const i2 = ah;        // a limbs
                const i1 = al >>> 16;
                const i0 = al & 0xFFFF;

                prod0 = k0 * i0;
                r0 = prod0 & 0xFFFF;
                carry = prod0 >>> 16;
                prod1 = k0 * i1 + k1 * i0 + carry;
                r1 = prod1 & 0xFFFF;
                carry = prod1 >>> 16;
                prod2 = k0 * i2 + k1 * i1 + k2 * i0 + carry;
                let alo = (((r1 << 16) | r0) >>> 0) + al2;
                let ahi = (prod2 & 0xFFFF) + ah2;

                if (alo > 0xFFFFFFFF) {
                    alo -= 0x100000000;
                    ahi = (ahi + 1) & 0xFFFF;
                } else {
                    ahi &= 0xFFFF;
                }

                mh = mhi;
                ml = mlo;
                ah = ahi;
                al = alo;
            }
            n >>>= 1;
            i++;
        }

        // apply state' = state * m + a mod 2^48
        const s2 = this._hi;          // state limbs
        const s1 = this._lo >>> 16;
        const s0 = this._lo & 0xFFFF;
        const k2 = mh;                // m limbs
        const k1 = ml >>> 16;
        const k0 = ml & 0xFFFF;
        const a2 = ah;                // a limbs
        const a1 = al >>> 16;
        const a0 = al & 0xFFFF;

        let prod0 = s0 * k0;
        let r0 = prod0 & 0xFFFF;
        let carry = prod0 >>> 16;
        let prod1 = s0 * k1 + s1 * k0 + carry;
        let r1 = prod1 & 0xFFFF;
        carry = prod1 >>> 16;
        let prod2 = s0 * k2 + s1 * k1 + s2 * k0 + carry;
        const p2 = prod2 & 0xFFFF;

        let sum0 = r0 + a0;
        const lo = sum0 & 0xFFFF;
        let c = sum0 >>> 16;
        let sum1 = r1 + a1 + c;
        const mid = sum1 & 0xFFFF;
        c = sum1 >>> 16;
        const hi = (p2 + a2 + c) & 0xFFFF;

        this._lo = ((mid << 16) | lo) | 0;
        this._hi = hi;
    }

    setSeed(n) {
        let value;
        if (typeof n === "bigint") {
            value = n;
        } else if (typeof n === "number") {
            value = BigInt(n | 0);
        } else if (n instanceof Long) {
            value = (BigInt(n.high) << 32n) + BigInt(n.low >>> 0);
        } else {
            const long = Long.fromString(n);
            value = (BigInt(long.high) << 32n) + BigInt(long.low >>> 0);
        }

        const masked = (value ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
        this._lo = Number(masked & 0xFFFFFFFFn);
        this._hi = Number(masked >> 32n);
    }
}
