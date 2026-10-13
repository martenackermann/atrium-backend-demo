import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { Public } from '@/common/auth/public.decorator';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbility, AppAbilityBuilder } from '@/common/authz/ability.types';
import { CheckAbility, CurrentAbility } from '@/common/authz/check-ability.decorator';
import { paginated, paginationQuerySchema } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { sortParam } from '@/common/http/sort';
import { UuidPipe } from '@/common/http/uuid.pipe';
import type { PrismaTx } from '@/database/prisma.types';
import { PrismaService } from '@/database/prisma.service';
import { mjml } from '@/infra/mail/mjml';
import { type AttachmentPolicy, RegisterAttachmentPolicy } from '@/modules/core/contracts/attachment-policy.contract';
import {
  type InboxItem,
  inboxItemId,
  type InboxProvider,
  RegisterInboxProvider,
} from '@/modules/core/contracts/inbox.contract';
import { RegisterSearchProvider, type SearchHit, type SearchProvider } from '@/modules/core/contracts/search.contract';
import { enumOptions } from '@/modules/core/meta/enum.registry';
import { CoreExtensionsModule } from '@/modules/core/meta/core-extensions.module';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { NotificationService } from '@/modules/core/notifications/notification.service';
import {
  type ToyRequest,
  toyRequestWorkflow,
  toyRequestWorkflowMeta,
} from '@/modules/core/workflow/examples/toy-request.workflow';
import { WorkflowService } from '@/modules/core/workflow/workflow.service';

/**
 * Test-only module exercising the slice-facing framework exactly like a slice would:
 * validation/pagination/sort, abilities, a workflow resource with HTTP actions, a
 * notification template, inbox/search providers and an attachment policy.
 * Mounted under /api/v1/test-fixtures by the e2e tests only.
 */

// --- HTTP conventions -------------------------------------------------------
const createThingSchema = z.strictObject({
  title: z.string().min(3),
  quantity: z.number().int().positive(),
  contact: z.strictObject({ email: z.email() }),
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
    if (hasRole(user, 'it_admin')) can('read', 'Secret');
    if (hasRole(user, 'manager')) can('decide', 'ToyRequest');
  }
}

let echoCounter = 0;

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

  @Public()
  @Get('maybe-me')
  maybeMe(@CurrentUser({ optional: true }) user?: AuthUser): { userId: string | null } {
    return { userId: user?.id ?? null };
  }

  @CheckAbility('read', 'Secret')
  @Get('secret')
  secret(): { secret: string } {
    return { secret: 'demo' };
  }

  /** Counts executions - an idempotent replay must not increment. */
  @Post('echo')
  echo(@Body() body: { value?: string }): { value: string | null; execution: number } {
    return { value: body.value ?? null, execution: ++echoCounter };
  }
}

// --- Workflow resource (toy requests stored as SystemSetting rows) --------------
export const toyEventNotification = defineNotification({
  id: 'test.toy_event',
  module: 'core',
  schema: z.object({ toyId: z.string(), state: z.string(), actorName: z.string() }),
  subject: (c) => `Toy ${c.toyId.slice(0, 8)} is now ${c.state}`,
  body: (c) => `${c.actorName} moved the toy to ${c.state}.`,
  email: (c) => mjml`<mj-text>${c.actorName} moved the toy to <b>${c.state}</b>.</mj-text>`,
  link: (c) => `/toys/${c.toyId}`,
  preview: { toyId: '00000000-0000-7000-8000-000000000000', state: 'submitted', actorName: 'Emma Employee' },
});

const toyStore = {
  async find(tx: PrismaTx, id: string): Promise<ToyRequest | null> {
    const row = await tx.systemSetting.findUnique({ where: { key: `toy:${id}` } });
    return row ? (row.value as unknown as ToyRequest) : null;
  },
  async update(tx: PrismaTx, id: string, expectedVersion: number, patch: Partial<ToyRequest>) {
    const current = await toyStore.find(tx, id);
    if (!current || current.version !== expectedVersion) return null;
    const next = { ...current, ...patch };
    await tx.systemSetting.update({ where: { key: `toy:${id}` }, data: { value: next as never } });
    return next;
  },
};

@Injectable()
export class ToyService {
  readonly workflow;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowService,
    notifications: NotificationService,
  ) {
    const base = toyRequestWorkflow(toyStore);
    this.workflow = {
      ...base,
      // visibility: owner or managers (others get 404)
      load: async (tx: PrismaTx, id: string, actor: AuthUser) => {
        const row = await toyStore.find(tx, id);
        return row && (row.ownerId === actor.id || hasRole(actor, 'manager')) ? row : null;
      },
      afterTransition: async ({ tx, entity, change }: Parameters<NonNullable<typeof base.afterTransition>>[0]) => {
        await notifications.send(
          toyEventNotification,
          {
            to: [{ userId: entity.ownerId }],
            context: { toyId: entity.id, state: change.toState, actorName: change.actor.displayName },
            priority: change.toState === 'submitted' ? 'high' : 'normal',
            entity: { type: 'toy_request', id: entity.id },
          },
          { tx },
        );
      },
    };
  }

  async create(owner: AuthUser): Promise<ToyRequest> {
    const toy: ToyRequest = {
      id: randomUUID(),
      ownerId: owner.id,
      status: 'draft',
      decidedBy: null,
      reason: null,
      version: 1,
    };
    await this.prisma.systemSetting.create({ data: { key: `toy:${toy.id}`, value: toy as never } });
    return toy;
  }

  async detail(id: string, user: AuthUser, ability: AppAbility) {
    const toy = await this.workflow.load(this.prisma, id, user);
    if (!toy) throw ProblemException.notFound('Toy');
    return { ...toy, ...(await this.workflows.view(this.workflow, toy, user, ability)) };
  }
}

@Controller('test-fixtures/toys')
export class ToysController {
  constructor(
    private readonly toys: ToyService,
    private readonly workflows: WorkflowService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility) {
    const toy = await this.toys.create(user);
    return this.toys.detail(toy.id, user, ability);
  }

  @Get(':id')
  get(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility) {
    return this.toys.detail(id, user, ability);
  }

  /** The canonical slice pattern: apply, then return the full detail DTO. */
  @Post(':id/actions/:action')
  async act(
    @Param('id', UuidPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ) {
    await this.workflows.apply(this.toys.workflow, { id, action, actor: user, ability, input: body });
    return this.toys.detail(id, user, ability);
  }
}

// --- Provider framework ---------------------------------------------------------
@Injectable()
@RegisterInboxProvider()
export class ToyInboxProvider implements InboxProvider {
  readonly module = 'training' as const;

  items(user: AuthUser): Promise<InboxItem[]> {
    if (user.email !== 'max.manager@example.com') return Promise.resolve([]);
    const base = {
      module: 'training' as const,
      reference: null,
      subtitle: null,
      actingAs: 'approver' as const,
      quickActions: ['approve', 'decline'],
    };
    const item = (
      key: string,
      title: string,
      dueAt: string | null,
      priority: 'high' | 'normal',
      createdAt: string,
    ): InboxItem => {
      const entityId = `0192f1c2-8e4b-7c3a-9d2e-1a2b3c4d5e0${key}`;
      return {
        ...base,
        id: inboxItemId('training.approval_required', entityId),
        type: 'training.approval_required',
        title,
        dueAt,
        priority,
        link: `/training/approvals?tab=approvals&selected=${entityId}`,
        actionsPath: `/training/participations/${entityId}`,
        entityId,
        createdAt,
      };
    };
    return Promise.resolve([
      item('1', 'Later', '2026-12-01T00:00:00.000Z', 'normal', '2026-10-01T00:00:00.000Z'),
      item('2', 'Urgent', '2026-12-05T00:00:00.000Z', 'high', '2026-10-02T00:00:00.000Z'),
      item('3', 'Undated', null, 'normal', '2026-10-03T00:00:00.000Z'),
      item('4', 'Sooner', '2026-11-01T00:00:00.000Z', 'normal', '2026-10-04T00:00:00.000Z'),
    ]);
  }
}

@Injectable()
@RegisterSearchProvider()
export class ToySearchProvider implements SearchProvider {
  readonly module = 'news' as const;

  search(_user: AuthUser, q: string): Promise<SearchHit[]> {
    return Promise.resolve(
      Array.from({ length: 7 }, (_, i) => ({
        module: 'news' as const,
        type: 'news_post' as const,
        id: `0192f1c2-8e4b-7c3a-9d2e-1a2b3c4d5f0${i}`,
        reference: null,
        title: `${q} ${i}`,
        subtitle: null,
        link: `/news/${i}`,
      })),
    );
  }
}

@Injectable()
@RegisterAttachmentPolicy()
export class ToyAttachmentPolicy implements AttachmentPolicy {
  readonly entityTypes = ['toy_request'];

  constructor(private readonly prisma: PrismaService) {}

  async canView(user: AuthUser, _entityType: string, entityId: string): Promise<boolean> {
    const toy = await toyStore.find(this.prisma, entityId);
    return !!toy && (toy.ownerId === user.id || hasRole(user, 'it_admin'));
  }
}

@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      notifications: [toyEventNotification],
      workflows: [toyRequestWorkflowMeta],
      enums: {
        toyStatus: enumOptions(['draft', 'submitted', 'approved', 'declined'], { submitted: ['Submitted', 'waiting'] }),
      },
    }),
  ],
  controllers: [FixturesController, ToysController],
  providers: [FixtureAbilities, ToyService, ToyInboxProvider, ToySearchProvider, ToyAttachmentPolicy],
})
export class FixturesModule {}
