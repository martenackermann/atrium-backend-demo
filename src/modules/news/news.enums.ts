import type { AuditLabels } from '@/modules/core/audit/audit-label.registry';
import { type EnumOption, enumOptions } from '@/modules/core/meta/enum.registry';
import type { WorkflowMeta } from '@/modules/core/meta/workflow.registry';
import { newsPostMachine } from './machines/news-post.machine';

export const NEWS_TYPES = ['changelog', 'update', 'information'] as const;
export type NewsType = (typeof NEWS_TYPES)[number];
export const NEWS_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

/** API.md §7.2 NewsAction, canonical order. */
export const NEWS_ACTIONS = ['publish', 'schedule', 'unschedule', 'archive', 'restore', 'edit', 'delete'] as const;
export type NewsAction = (typeof NEWS_ACTIONS)[number];

/** SPEC §4.6 icon allowlist for useful links. */
export const LINK_ICONS = [
  'book',
  'utensils',
  'receipt',
  'bed',
  'life-buoy',
  'calendar',
  'network',
  'palette',
  'shield',
  'heart',
  'link',
] as const;

export const NEWS_ENUMS: Record<string, EnumOption[]> = {
  newsType: enumOptions(NEWS_TYPES, { changelog: 'Changelog', update: 'Update', information: 'Information' }),
  newsStatus: enumOptions(NEWS_STATUSES, {
    draft: ['Draft', 'neutral'],
    scheduled: ['Scheduled', 'moving'],
    published: ['Published', 'positive'],
    archived: ['Archived', 'neutral'],
  }),
};

export const NEWS_AUDIT_LABELS: Record<string, AuditLabels> = {
  news_post: {
    entity: 'News post',
    fields: {
      title: 'Title',
      type: 'Type',
      summary: 'Summary',
      body: 'Body',
      coverImage: 'Cover image',
      pinned: 'Pinned',
      expireAt: 'Expires at',
    },
    actions: {
      create: 'created the post',
      update: 'edited the post',
      delete: 'deleted the post',
      publish: 'published the post',
      schedule: 'scheduled the post',
      unschedule: 'unscheduled the post',
      auto_publish: 'published the post on schedule',
      archive: 'archived the post',
      auto_expire: 'archived the post when it expired',
      restore: 'restored the post as a draft',
    },
  },
  useful_link: {
    entity: 'Useful link',
    fields: {
      title: 'Title',
      url: 'URL',
      description: 'Description',
      icon: 'Icon',
      category: 'Category',
      active: 'Active',
      sortOrder: 'Position',
    },
    actions: {
      create: 'added the link',
      update: 'edited the link',
      delete: 'deleted the link',
      reorder: 'reordered the links',
    },
  },
};

export const newsPostWorkflowMeta: WorkflowMeta = {
  name: 'news_post',
  label: 'News post',
  machine: newsPostMachine,
  initialStates: ['draft'],
  states: {
    draft: { label: 'Draft', tone: 'neutral' },
    scheduled: { label: 'Scheduled', tone: 'moving' },
    published: { label: 'Published', tone: 'positive' },
    archived: { label: 'Archived', tone: 'neutral' },
  },
  events: {
    publish: { label: 'Publish now', actors: ['News editor'] },
    schedule: { label: 'Schedule', actors: ['News editor'] },
    unschedule: { label: 'Unschedule', actors: ['News editor'] },
    auto_publish: { label: 'Publish at the set time', actors: ['System'] },
    archive: { label: 'Archive', actors: ['News editor'] },
    auto_expire: { label: 'Expire', actors: ['System'] },
    restore: { label: 'Restore as draft', actors: ['News editor'] },
  },
};
