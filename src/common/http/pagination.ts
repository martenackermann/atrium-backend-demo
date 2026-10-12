import { z } from 'zod';

export const PER_PAGE_DEFAULT = 20;
export const PER_PAGE_MAX = 100;

/** `?page=&perPage=` - extend it with filters and `sort` in a module's list-query DTO. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(PER_PAGE_MAX).default(PER_PAGE_DEFAULT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const pageMetaSchema = z.object({
  page: z.number().int(),
  perPage: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/** Response schema for a paginated list of `item` (use in `createZodDto` / `@ZodResponse`). */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}

/** Prisma `skip`/`take` for a page. */
export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.perPage, take: query.perPage };
}

export function pageMeta(total: number, query: PaginationQuery): PageMeta {
  return {
    page: query.page,
    perPage: query.perPage,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.perPage),
  };
}

export function paginated<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { data, meta: pageMeta(total, query) };
}

/**
 * Runs a page query and its count in parallel.
 *
 * @example
 * return paginate(query,
 *   (page) => this.prisma.trainingRequest.findMany({ where, orderBy, ...page }),
 *   () => this.prisma.trainingRequest.count({ where }));
 */
export async function paginate<T>(
  query: PaginationQuery,
  findPage: (page: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<Paginated<T>> {
  const [data, total] = await Promise.all([findPage(toSkipTake(query)), count()]);
  return paginated(data, total, query);
}
