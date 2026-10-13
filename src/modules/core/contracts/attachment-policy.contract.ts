import { DiscoveryService } from '@nestjs/core';
import type { AuthUser } from '@/common/auth/auth-user';

/**
 * Who may see / link attachments of a module's entity types (e.g. `training_request`).
 * Core consults it for `GET /attachments/{id}` and download URLs of linked files.
 * Decorate with `@RegisterAttachmentPolicy()` and list it in the module's `providers`.
 */
export interface AttachmentPolicy {
  /** snake_case entity types this policy is responsible for. */
  readonly entityTypes: readonly string[];
  /** May the user see the entity (and therefore its attachments)? */
  canView(user: AuthUser, entityType: string, entityId: string): Promise<boolean>;
  /** May the user link staged attachments to the entity? Defaults to `canView`. */
  canLink?(user: AuthUser, entityType: string, entityId: string): Promise<boolean>;
}

export const RegisterAttachmentPolicy = DiscoveryService.createDecorator<void>();
