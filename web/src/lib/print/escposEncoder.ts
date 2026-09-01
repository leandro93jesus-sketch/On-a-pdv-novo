/**
 * Encoder ESC/POS mínimo (texto + corte). Não envia para hardware.
 */

export interface EncodeEscPosOptions {
  cut?: boolean;
  width?: '58mm' | '80mm' | 'A4';
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const LATIN1: Record<string, number> = {
  Á: 0xc1,
  À: 0xc0,
  Â: 0xc2,
  Ã: 0xc3,
  Ä: 0xc4,
  É: 0xc9,
  È: 0xc8,
  Ê: 0xca,
  Í: 0xcd,
  Ó: 0xd3,
  Ô: 0xd4,
  Õ: 0xd5,
  Ú: 0xda,
  Ç: 0xc7,
  á: 0xe1,
  à: 0xe0,
  â: 0xe2,
  ã: 0xe3,
  é: 0xe9,
  ê: 0xea,
  í: 0xed,
  ó: 0xf3,
  ô: 0xf4,
  õ: 0xf5,
  ú: 0xfa,
  ç: 0xe7,
  'º': 0xba,
  'ª': 0xaa,
};

function encodeLatin1(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === '\n') {
      out.push(LF);
      continue;
    }
    if (code < 128) {
      out.push(code);
      continue;
    }
    if (LATIN1[ch] != null) {
      out.push(LATIN1[ch]);
      continue;
    }
    out.push(0x3f);
  }
  return out;
}

export function encodeEscPos(text: string, opts: EncodeEscPosOptions = {}): Uint8Array {
  const bytes: number[] = [];
  bytes.push(ESC, 0x40); // init
  bytes.push(ESC, 0x74, 0x10); // code page WPC1252
  bytes.push(ESC, 0x61, 0x00); // align left
  bytes.push(ESC, 0x21, 0x00); // font A, not bold
  bytes.push(...encodeLatin1(text.endsWith('\n') ? text : `${text}\n`));
  bytes.push(LF, LF);
  if (opts.cut !== false) {
    bytes.push(GS, 0x56, 0x01); // partial cut
  }
  return Uint8Array.from(bytes);
}

export function inspectEscPos(bytes: Uint8Array): {
  hasInit: boolean;
  hasCut: boolean;
  hasText: boolean;
  textBytes: number;
  totalBytes: number;
} {
  const arr = Array.from(bytes);
  let hasInit = false;
  let hasCut = false;
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] === ESC && arr[i + 1] === 0x40) hasInit = true;
    if (arr[i] === GS && arr[i + 1] === 0x56) hasCut = true;
  }
  const textBytes = arr.filter((b) => b >= 32 && b < 127).length;
  return {
    hasInit,
    hasCut,
    hasText: textBytes >= 8,
    textBytes,
    totalBytes: arr.length,
  };
}
