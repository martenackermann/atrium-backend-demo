import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** argon2id hashing. Plain functions for seeds/scripts, `PasswordHasher` for DI. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

@Injectable()
export class PasswordHasher {
  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return verifyPassword(hash, plain);
  }
}
