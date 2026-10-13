import { Injectable } from '@nestjs/common';

/** Labels for one audited entity type (SPEC_RESOLUTIONS #6). */
export interface AuditLabels {
  /** Human label of the entity type, e.g. "Training request". */
  entity?: string;
  /** Field labels for FieldChange rows: `{ costCents: 'Cost' }`. */
  fields?: Record<string, string>;
  /** Fields recorded as '•••' (secrets, personal data). */
  masked?: string[];
  /** Past-tense phrases for timeline summaries: `{ book: 'booked the training' }`. */
  actions?: Record<string, string>;
}

/**
 * Field-change labels and summary phrases per entity type, used by AuditService for diffs
 * and timelines. Register with `CoreExtensionsModule.forFeature({ auditLabels: { training_request: {...} } })`.
 */
@Injectable()
export class AuditLabelRegistry {
  private readonly labels = new Map<string, AuditLabels>();

  register(entityType: string, labels: AuditLabels): void {
    const existing = this.labels.get(entityType) ?? {};
    this.labels.set(entityType, {
      entity: labels.entity ?? existing.entity,
      fields: { ...existing.fields, ...labels.fields },
      masked: [...(existing.masked ?? []), ...(labels.masked ?? [])],
      actions: { ...existing.actions, ...labels.actions },
    });
  }

  get(entityType: string): AuditLabels {
    return this.labels.get(entityType) ?? {};
  }

  fieldLabel(entityType: string, field: string): string {
    return this.get(entityType).fields?.[field] ?? field;
  }

  actionPhrase(entityType: string, action: string): string | undefined {
    return this.get(entityType).actions?.[action];
  }
}
