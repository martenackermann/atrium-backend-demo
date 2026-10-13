import { describe, expect, it } from 'vitest';
import { getNextTransitions, transition } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import { describeWorkflow } from '@/modules/core/meta/workflow.registry';
import { newsPostWorkflowMeta } from '../news.enums';
import { newsPostMachine } from './news-post.machine';

const actor: AuthUser = {
  id: 'u-editor',
  email: 'paula.people-ops@example.com',
  displayName: 'Paula People-Ops',
  roles: ['employee', 'news_editor'],
  isSiteManager: false,
  sessionId: null,
};

const snapshot = (value: string, hasContent = true) => newsPostMachine.resolveState({ value, context: { hasContent } });
const event = (type: string) =>
  ({ type, actor, input: { publishAt: '2026-10-20T08:00:00.000Z', expireAt: null } }) as never;

/** SPEC §5.5. */
const TABLE: [string, string, string][] = [
  ['draft', 'publish', 'published'],
  ['scheduled', 'publish', 'published'],
  ['draft', 'schedule', 'scheduled'],
  ['scheduled', 'unschedule', 'draft'],
  ['scheduled', 'auto_publish', 'published'],
  ['published', 'archive', 'archived'],
  ['published', 'auto_expire', 'archived'],
  ['archived', 'restore', 'draft'],
];

describe('news post machine (SPEC §5.5)', () => {
  it.each(TABLE)('%s --%s--> %s', (from, type, to) => {
    expect(transition(newsPostMachine, snapshot(from), event(type))[0].value).toBe(to);
  });

  it('allows only the table transitions', () => {
    for (const state of ['draft', 'scheduled', 'published', 'archived']) {
      const events = getNextTransitions(snapshot(state))
        .map((t) => t.eventType)
        .sort();
      expect({ state, events }).toEqual({
        state,
        events: TABLE.filter(([from]) => from === state)
          .map(([, e]) => e)
          .sort(),
      });
    }
  });

  it('guards publish and schedule on content', () => {
    expect(snapshot('draft', false).can(event('publish'))).toBe(false);
    expect(snapshot('draft', false).can(event('schedule'))).toBe(false);
    expect(snapshot('scheduled', false).can(event('publish'))).toBe(false);
    expect(snapshot('draft', true).can(event('publish'))).toBe(true);
  });

  it('describes the diagram', () => {
    const view = describeWorkflow(newsPostWorkflowMeta);
    expect(view.transitions).toHaveLength(TABLE.length);
    expect(view.transitions.find((t) => t.event === 'auto_publish')?.actors).toEqual(['System']);
  });
});
