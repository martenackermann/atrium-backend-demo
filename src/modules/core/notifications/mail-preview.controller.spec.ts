import { describe, expect, it } from 'vitest';
import { ProblemException } from '@/common/http/problem';
import type { AppConfig } from '@/config/app-config';
import { MailPreviewController } from './mail-preview.controller';
import type { NotificationService } from './notification.service';
import type { NotificationTemplateRegistry } from './notification-template.registry';

describe('dev mail preview', () => {
  const registry = { list: () => [], get: () => undefined } as unknown as NotificationTemplateRegistry;
  const controller = (isProduction: boolean) =>
    new MailPreviewController(
      registry,
      {} as NotificationService,
      {
        isProduction,
        get: () => 'http://localhost:3100',
      } as unknown as AppConfig,
    );

  it('is a 404 in production', async () => {
    const prod = controller(true);
    expect(() => prod.list()).toThrow(ProblemException);
    await expect(prod.preview('training.approval_requested')).rejects.toMatchObject({
      problem: { status: 404, code: 'not_found' },
    });
  });

  it('lists templates outside production', () => {
    expect(controller(false).list()).toEqual({ templates: [] });
  });
});
