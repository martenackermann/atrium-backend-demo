import type { AbilityBuilder } from '@casl/ability';
import type { Model, PrismaAbility, PrismaQueryFactory } from '@casl/prisma';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthUser } from '@/common/auth/auth-user';

/**
 * CASL actions. The CRUD verbs plus any workflow action slug ("approve", "submit"...).
 * `manage` matches every action.
 */
export type AppAction = 'manage' | 'create' | 'read' | 'update' | 'delete' | (string & {});

/**
 * Subject types: every Prisma model name (picked up automatically from the generated
 * client), `all`, or a free-form feature name such as "AdminDashboard".
 */
export type AppSubjectType = Prisma.ModelName | 'all' | (string & {});

/** A subject instance: a Prisma row tagged with `subject('TrainingRequest', row)`. */
export type AppSubjectInstance = Model<Record<string, unknown>, Prisma.ModelName>;

export type AppSubject = AppSubjectType | AppSubjectInstance;

/** Conditions are Prisma `where` inputs, so the same rules drive `accessibleBy()` queries. */
export type AppPrismaQuery = PrismaQueryFactory<Prisma.TypeMap>;

export type AppAbility = PrismaAbility<[AppAction, AppSubject], AppPrismaQuery>;

export type AppAbilityBuilder = AbilityBuilder<AppAbility>;

/**
 * Implemented by each module's `abilities/<m>.abilities.ts` provider (decorated with
 * `@AbilityRules()`) to add that module's rules for a user.
 */
export interface AbilityRulesContributor {
  define(user: AuthUser, builder: AppAbilityBuilder): void | Promise<void>;
}
