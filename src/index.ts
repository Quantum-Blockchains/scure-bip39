/*! scure-bip39 - MIT License (c) 2022 Patricio Palladino, Paul Miller (paulmillr.com) */
import assert from '@noble/hashes/_assert';
import { pbkdf2, pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { randomBytes } from '@noble/hashes/utils';
import { utils as baseUtils } from '@scure/base';
import fetch from 'cross-fetch';

async function getQRNGEntropy(strength: number): Promise<string> {
  assert.number(strength);
  if (strength % 32 !== 0 || strength > 256) throw new TypeError('Invalid entropy');
  const apiKey = '47416dad-5ea0-463b-b2db-37edd4f77277';
  const apiProvider = 'qbck';
  const apiTarget = 'block';
  const apiUrlPrefix = 'https://qrng.qbck.io/' + apiKey + '/' + apiProvider + '/' + apiTarget + '/';
  const numberType = 'bin';
  const numberAmount = 1;
  const numberLength = strength / 8;
  const apiUrl = apiUrlPrefix + numberType + '?size=' + numberAmount + '&length=' + numberLength;
  const response = await fetch(apiUrl);
  const data = await response.json();
  return data.data.result[0];
}

function randomBinary(n: number): string {
  let result = '';
  for (let i = 0; i < n; ++i) {
    result += Math.round(Math.random()).toString();
  }
  return result;
}

function binaryToByte(bin: string): number {
  return parseInt(bin, 2);
}

// Normalization replaces equivalent sequences of characters
// so that any two texts that are equivalent will be reduced
// to the same sequence of code points, called the normal form of the original text.
function nfkd(str: string) {
  if (typeof str !== 'string') throw new TypeError(`Invalid mnemonic type: ${typeof str}`);
  return str.normalize('NFKD');
}

function normalize(str: string) {
  const norm = nfkd(str);
  const words = norm.split(' ');
  if (![12, 15, 18, 21, 24].includes(words.length)) throw new Error('Invalid mnemonic');
  return { nfkd: norm, words };
}

function assertEntropy(entropy: Uint8Array) {
  assert.bytes(entropy, 16, 20, 24, 28, 32);
}

/**
 * Generate x random words. Uses Cryptographically-Secure Random Number Generator.
 * @param wordlist imported wordlist for specific language
 * @param strength mnemonic strength 128-256 bits
 * @example
 * generateMnemonic(wordlist, 128)
 * // 'legal winner thank year wave sausage worth useful legal winner thank yellow'
 */
export function generateMnemonic(wordlist: string[], strength: number = 128): Uint8Array {
  assert.number(strength);
  if (strength % 32 !== 0 || strength > 256) throw new TypeError('Invalid entropy');
  return entropyToMnemonic(randomBytes(strength / 8), wordlist);
}

export async function generateMnemonicQBCK(
  wordlist: string[],
  strength: number = 128
): Promise<Uint8Array> {
  assert.number(strength);
  if (strength % 32 !== 0 || strength > 256) throw new TypeError('Invalid entropy');
  const qbckEntropy: string = await getQRNGEntropy(strength);
  const localEntropy: string = randomBinary(strength);
  let bitwiseEntropy: string = '';
  for (let i = 0; i < qbckEntropy.length; i++) {
    bitwiseEntropy += (
      parseInt(qbckEntropy.charAt(i), 2) ^ parseInt(localEntropy.charAt(i), 2)
    ).toString();
  }
  const entropyBytes = bitwiseEntropy.match(/(.{1,8})/g)!.map(binaryToByte);
  const entropyUint8Array = Uint8Array.from(entropyBytes);
  return entropyToMnemonic(entropyUint8Array, wordlist);
}

const calcChecksum = (entropy: Uint8Array) => {
  // Checksum is ent.length/4 bits long
  const bitsLeft = 8 - entropy.length / 4;
  // Zero rightmost "bitsLeft" bits in byte
  // For example: bitsLeft=4 val=10111101 -> 10110000
  return new Uint8Array([(sha256(entropy)[0] >> bitsLeft) << bitsLeft]);
};

function getCoder(wordlist: string[]) {
  if (!Array.isArray(wordlist) || wordlist.length !== 2 ** 11 || typeof wordlist[0] !== 'string')
    throw new Error('Worlist: expected array of 2048 strings');
  wordlist.forEach((i) => {
    if (typeof i !== 'string') throw new Error(`Wordlist: non-string element: ${i}`);
  });
  return baseUtils.chain(
    baseUtils.checksum(1, calcChecksum),
    baseUtils.radix2(11, true),
    baseUtils.alphabet(wordlist)
  );
}

/**
 * Reversible: Converts mnemonic string to raw entropy in form of byte array.
 * @param mnemonic 12-24 words
 * @param wordlist imported wordlist for specific language
 * @example
 * const mnem = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
 * mnemonicToEntropy(mnem, wordlist)
 * // Produces
 * new Uint8Array([
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f
 * ])
 */
export function mnemonicToEntropy(mnemonic: string | Uint8Array, wordlist: string[]): Uint8Array {
  let entropy;
  if (typeof mnemonic === 'string') {
    const { words } = normalize(mnemonic);
    entropy = getCoder(wordlist).decode(words);
  } else {
    // expected intanceOf Uint8Array when used with eth-hd-keyring
    entropy = getCoder(wordlist).decode(
      Array.from(new Uint16Array(mnemonic.buffer)).map((i) => wordlist[i])
    );
  }
  assertEntropy(entropy);
  return entropy;
}

/**
 * Reversible: Converts raw entropy in form of byte array to mnemonic string.
 * @param entropy byte array
 * @param wordlist imported wordlist for specific language
 * @returns 12-24 words
 * @example
 * const ent = new Uint8Array([
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
 *   0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f
 * ]);
 * entropyToMnemonic(ent, wordlist);
 * // 'legal winner thank year wave sausage worth useful legal winner thank yellow'
 */
export function entropyToMnemonic(entropy: Uint8Array, wordlist: string[]): Uint8Array {
  assertEntropy(entropy);
  const words = getCoder(wordlist).encode(entropy);
  const indices = words.map((word) => wordlist.indexOf(word));
  const uInt8ArrayOfMnemonic = new Uint8Array(new Uint16Array(indices).buffer);
  return uInt8ArrayOfMnemonic;
}

/**
 * Validates mnemonic for being 12-24 words contained in `wordlist`.
 */
export function validateMnemonic(mnemonic: string | Uint8Array, wordlist: string[]): boolean {
  try {
    mnemonicToEntropy(mnemonic, wordlist);
  } catch (e) {
    return false;
  }
  return true;
}

const salt = (passphrase: string) => nfkd(`mnemonic${passphrase}`);

/**
 * Irreversible: Uses KDF to derive 64 bytes of key data from mnemonic + optional password.
 * @param mnemonic 12-24 words (string | Uint8Array)
 * @param wordlist array of 2048 words used to recover the mnemonic string from a Uint8Array
 * @param passphrase string that will additionally protect the key
 * @returns 64 bytes of key data
 * @example
 * const mnem = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
 * await mnemonicToSeed(mnem, 'password');
 * // new Uint8Array([...64 bytes])
 */
export function mnemonicToSeed(mnemonic: string | Uint8Array, wordlist: string[], passphrase = '') {
  const encodedMnemonicUint8Array = encodeMnemonicForSeedDerivation(mnemonic, wordlist);
  return pbkdf2Async(sha512, encodedMnemonicUint8Array, salt(passphrase), { c: 2048, dkLen: 64 });
}

/**
 * Irreversible: Uses KDF to derive 64 bytes of key data from mnemonic + optional password.
 * @param mnemonic 12-24 words (string | Uint8Array)
 * @param wordlist array of 2048 words used to recover the mnemonic string from a Uint8Array
 * @param passphrase string that will additionally protect the key
 * @returns 64 bytes of key data
 * @example
 * const mnem = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
 * mnemonicToSeedSync(mnem, 'password');
 * // new Uint8Array([...64 bytes])
 */
export function mnemonicToSeedSync(
  mnemonic: string | Uint8Array,
  wordlist: string[],
  passphrase = ''
) {
  const encodedMnemonicUint8Array = encodeMnemonicForSeedDerivation(mnemonic, wordlist);
  return pbkdf2(sha512, encodedMnemonicUint8Array, salt(passphrase), { c: 2048, dkLen: 64 });
}

/**
 * Helper function to encode mnemonic passed either as a string or `Uint8Array` for deriving a seed/key with pbkdf2.
 */
function encodeMnemonicForSeedDerivation(mnemonic: string | Uint8Array, wordlist: string[]) {
  let encodedMnemonicUint8Array;
  if (typeof mnemonic === 'string') {
    encodedMnemonicUint8Array = new TextEncoder().encode(normalize(mnemonic).nfkd);
  } else {
    encodedMnemonicUint8Array = new TextEncoder().encode(
      Array.from(new Uint16Array(mnemonic.buffer))
        .map((i) => wordlist[i])
        .join(' ')
    );
  }
  return encodedMnemonicUint8Array;
}
