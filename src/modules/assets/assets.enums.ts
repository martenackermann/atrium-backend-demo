import type { AuditLabels } from '@/modules/core/audit/audit-label.registry';
import { type EnumOption, enumOptions } from '@/modules/core/meta/enum.registry';
import { ASSET_STATUSES, RETURN_CONDITIONS } from './assets.domain';

/**
 * Enums served by `GET /meta/enums` (API.md §3.6). Labels and tones follow DESIGN.md §2.4
 * (SPEC_RESOLUTIONS #8: DESIGN wins on appearance); `you` is applied client-side.
 */
export const ASSET_ENUMS: Record<string, EnumOption[]> = {
  assetStatus: enumOptions(ASSET_STATUSES, {
    in_stock: ['In stock', 'neutral'],
    pending_acceptance: ['Waiting for acceptance', 'waiting'],
    in_use: ['In use', 'positive'],
    in_repair: ['In repair', 'blocked'],
    scrapped: ['Scrapped', 'neutral'],
  }),
  returnCondition: enumOptions(RETURN_CONDITIONS, {
    ok: ['OK', 'positive', 'Back to stock'],
    damaged: ['Damaged', 'negative', 'Goes to repair'],
  }),
};

/** Field labels and timeline phrases (core AuditLabelRegistry, SPEC_RESOLUTIONS #6). */
export const ASSET_AUDIT_LABELS: Record<string, AuditLabels> = {
  asset: {
    entity: 'Asset',
    fields: {
      serialNumber: 'Serial number',
      name: 'Device name',
      model: 'Model',
      platform: 'Platform',
      purchaseDate: 'Purchase date',
      costCenter: 'Cost centre',
      mdmEnrolled: 'MDM enrolled',
      notes: 'Notes',
    },
    actions: {
      create: 'added the asset',
      update: 'edited the details',
      delete: 'deleted the asset',
      assign: 'assigned the device',
      accept: 'accepted the device',
      decline: 'declined the device',
      unassign: 'withdrew the assignment',
      return: 'recorded the return',
      send_to_repair: 'sent the device to repair',
      complete_repair: 'completed the repair',
      scrap: 'scrapped the device',
      remind: 'sent an acceptance reminder',
      cost_center_sync: 'synced the cost centre',
    },
  },
  asset_model: {
    entity: 'Asset model',
    fields: {
      name: 'Name',
      manufacturer: 'Manufacturer',
      deviceType: 'Device type',
      storageGb: 'Storage (GB)',
      color: 'Colour',
      archived: 'Archived',
    },
    actions: { create: 'added the model', update: 'edited the model', delete: 'deleted the model' },
  },
  device_type: {
    entity: 'Device type',
    fields: { code: 'Code', name: 'Name', requiresPlatform: 'Requires platform', sortOrder: 'Sort order' },
    actions: { create: 'added the device type', update: 'edited the device type', delete: 'deleted the device type' },
  },
  manufacturer: {
    entity: 'Manufacturer',
    fields: { name: 'Name', deviceTypes: 'Device types', archived: 'Archived' },
    actions: { create: 'added the manufacturer', update: 'edited the manufacturer' },
  },
  platform: {
    entity: 'Platform',
    fields: { name: 'Name', deviceTypes: 'Device types', archived: 'Archived' },
    actions: { create: 'added the platform', update: 'edited the platform' },
  },
};
