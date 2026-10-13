import { basename, extname } from 'node:path';

export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/**
 * Detects the MIME type from magic bytes (never trusts the client). DOCX files are ZIP
 * containers, so a ZIP signature is accepted as DOCX only with a `.docx` name and a
 * `word/` entry.
 */
export function detectMimeType(content: Buffer, originalName: string): string | null {
  if (content.length >= 5 && content.subarray(0, 5).toString('latin1') === '%PDF-') return MIME.pdf;
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return MIME.png;
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return MIME.jpeg;
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString('latin1') === 'RIFF' &&
    content.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return MIME.webp;
  }
  if (content.length >= 4 && content.subarray(0, 4).toString('latin1') === 'GIF8') return MIME.gif;
  if (
    content.length >= 4 &&
    content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
    extname(originalName).toLowerCase() === '.docx' &&
    content.includes(Buffer.from('word/'))
  ) {
    return MIME.docx;
  }
  return null;
}

/** Multipart parsers decode file names as latin1; recover UTF-8 names ("Ãœ" -> "Ü"). */
export function decodeUploadFileName(name: string): string {
  if (!/[\u0080-ÿ]/.test(name)) return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

/** Strips path parts and control characters; max 200 characters (SPEC §4.1). */
export function sanitizeFileName(name: string): string {
  const base = basename(decodeUploadFileName(name).replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim();
  const safe = base && base !== '.' && base !== '..' ? base : 'file';
  if (safe.length <= 200) return safe;
  const ext = extname(safe).slice(0, 20);
  return safe.slice(0, 200 - ext.length) + ext;
}
