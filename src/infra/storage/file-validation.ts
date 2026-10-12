import { lookup } from 'mime-types';
import { ProblemException } from '@/common/http/problem';

export interface UploadRules {
  /** Max size in bytes. */
  maxBytes: number;
  /** Allowed MIME types, e.g. ['application/pdf', 'image/png']. */
  allowedMimeTypes: readonly string[];
}

/** The parts of a Multer file the validator needs (works with `Express.Multer.File`). */
export interface UploadCandidate {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

export const MB = 1024 * 1024;

/** Common presets for module uploads. */
export const UploadPresets = {
  documents: {
    maxBytes: 10 * MB,
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
  },
  images: { maxBytes: 5 * MB, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
} as const satisfies Record<string, UploadRules>;

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/**
 * Returns validation messages for an upload (empty when valid): size, allowed type, the
 * extension matches the declared type, and - for known binary formats - the magic bytes.
 */
export function checkUpload(file: UploadCandidate, rules: UploadRules): string[] {
  const problems: string[] = [];
  if (file.size <= 0) problems.push('The file is empty.');
  if (file.size > rules.maxBytes) {
    problems.push(`The file is too large (max ${Math.floor(rules.maxBytes / MB) || rules.maxBytes} MB).`);
  }
  if (!rules.allowedMimeTypes.includes(file.mimetype)) {
    problems.push(`File type ${file.mimetype || 'unknown'} is not allowed. Allowed: ${rules.allowedMimeTypes.join(', ')}.`);
    return problems;
  }
  const byExtension = lookup(file.originalname);
  if (byExtension !== file.mimetype) problems.push('The file extension does not match its type.');
  const signature = SIGNATURES[file.mimetype];
  if (signature && file.buffer && !signature(file.buffer)) problems.push('The file content does not match its type.');
  return problems;
}

/** Throws a 422 problem (`errors[field]`) when the upload breaks the rules. */
export function assertValidUpload(file: UploadCandidate | undefined, rules: UploadRules, field = 'file'): void {
  if (!file) throw ProblemException.validation({ [field]: ['Required'] });
  const problems = checkUpload(file, rules);
  if (problems.length) throw ProblemException.validation({ [field]: problems });
}
