import type { PrismaClient } from '@/generated/prisma/client';

/** The client handed to callbacks of `prisma.$transaction(async (tx) => ...)`. */
export type PrismaTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
