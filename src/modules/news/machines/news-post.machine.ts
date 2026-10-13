import { setup } from 'xstate';
import { workflowActions, type WorkflowEvent } from '@/modules/core/workflow';

/** SPEC §5.5 news post lifecycle. `auto_publish` and `auto_expire` are system events (job). */
export interface NewsPostContext {
  /** title, summary and body are non-empty (publish / schedule guard). */
  hasContent: boolean;
}

export type NewsPostEvent =
  | WorkflowEvent<'publish'>
  | WorkflowEvent<'schedule', { publishAt: string; expireAt: string | null }>
  | WorkflowEvent<'unschedule'>
  | WorkflowEvent<'auto_publish'>
  | WorkflowEvent<'archive'>
  | WorkflowEvent<'auto_expire'>
  | WorkflowEvent<'restore'>;

export const newsPostMachine = setup({
  types: { context: {} as NewsPostContext, events: {} as NewsPostEvent },
  guards: { hasContent: ({ context }) => context.hasContent },
  actions: { ...workflowActions },
}).createMachine({
  id: 'newsPost',
  initial: 'draft',
  context: { hasContent: false },
  states: {
    draft: {
      on: {
        publish: { guard: 'hasContent', target: 'published' },
        schedule: { guard: 'hasContent', target: 'scheduled' },
      },
    },
    scheduled: {
      on: {
        publish: { guard: 'hasContent', target: 'published' },
        unschedule: { target: 'draft' },
        auto_publish: { target: 'published' },
      },
    },
    published: {
      on: {
        archive: { target: 'archived' },
        auto_expire: { target: 'archived' },
      },
    },
    archived: {
      on: { restore: { target: 'draft' } },
    },
  },
});
