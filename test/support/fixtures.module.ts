import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { Public } from '@/common/auth/public.decorator';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';
import { CheckAbility } from '@/common/authz/check-ability.decorator';
import { paginated, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';

/**
 * Test-only endpoints that exercise the shared HTTP conventions (validation, pagination,
 * sort, auth, abilities). Mounted under /api/v1/test-fixtures by the e2e tests only.
 */
const createThingSchema = z.object({
  title: z.string().min(3),
  quantity: z.number().int().positive(),
  contact: z.object({ email: z.email() }),
});
class CreateThingDto extends createZodDto(createThingSchema) {}

const listThingsSchema = paginationQuerySchema.extend({
  sort: sortParam({ allowed: ['title', 'createdAt'], default: '-createdAt' }),
});
class ListThingsQuery extends createZodDto(listThingsSchema) {}

@Injectable()
@AbilityRules()
export class FixtureAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    if (user.roles.includes('admin')) can('read', 'Secret');
  }
}

@Controller('test-fixtures')
export class FixturesController {
  @Public()
  @Post('things')
  create(@Body() dto: CreateThingDto): CreateThingDto {
    return dto;
  }

  @Public()
  @Get('things')
  list(@Query() query: ListThingsQuery) {
    const all = Array.from({ length: 45 }, (_, i) => ({ id: i + 1 }));
    const start = (query.page - 1) * query.perPage;
    return { ...paginated(all.slice(start, start + query.perPage), all.length, query), sort: query.sort };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Public()
  @Get('maybe-me')
  maybeMe(@CurrentUser({ optional: true }) user?: AuthUser): { user: AuthUser | null } {
    return { user: user ?? null };
  }

  @CheckAbility('read', 'Secret')
  @Get('secret')
  secret(): { secret: string } {
    return { secret: 'demo' };
  }
}

/** Mimics an auth route so the rate limit (only /api/v1/auth/*) can be tested. */
@Controller('auth/test-ping')
export class FixtureAuthController {
  @Public()
  @Get()
  ping(): { pong: true } {
    return { pong: true };
  }
}

@Module({ controllers: [FixturesController, FixtureAuthController], providers: [FixtureAbilities] })
export class FixturesModule {}
