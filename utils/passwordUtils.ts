/**
 * Generates a cryptographically random password suitable for Firebase Auth (min 6 chars).
 * Ensures at least one uppercase, lowercase, digit, and symbol from readable sets.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
/** Symbols unlikely to break copy-paste or upset naive parsers */
const SYMBOLS = '!@#$%&*-+=?';

function randomFromCharset(length: number, charset: string): string {
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += charset[bytes[i]! % charset.length];
    }
    return out;
}

function shuffleString(str: string): string {
    const arr = str.split('');
    const bytes = new Uint32Array(arr.length);
    crypto.getRandomValues(bytes);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = bytes[i]! % (i + 1);
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr.join('');
}

export function generateSecurePassword(length = 14): string {
    const minLen = Math.max(12, length);
    const required =
        randomFromCharset(1, UPPER) +
        randomFromCharset(1, LOWER) +
        randomFromCharset(1, DIGITS) +
        randomFromCharset(1, SYMBOLS);
    const all = UPPER + LOWER + DIGITS + SYMBOLS;
    const restLen = Math.max(0, minLen - required.length);
    const rest = randomFromCharset(restLen, all);
    return shuffleString(required + rest);
}
