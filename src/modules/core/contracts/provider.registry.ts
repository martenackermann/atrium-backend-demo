import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { type AttachmentPolicy, RegisterAttachmentPolicy } from './attachment-policy.contract';
import { type InboxProvider, RegisterInboxProvider } from './inbox.contract';
import { type MyDayContributor, RegisterMyDayContributor } from './my-day.contract';
import { RegisterSearchProvider, type SearchProvider } from './search.contract';

/**
 * Collects every provider registered by the modules through the contract decorators.
 * Core never imports slice code: slices decorate their providers and Nest discovery
 * finds them here at startup.
 */
@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistry.name);
  inbox: InboxProvider[] = [];
  search: SearchProvider[] = [];
  myDay: MyDayContributor[] = [];
  attachmentPolicies: AttachmentPolicy[] = [];

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const instances = <T>(decorator: { KEY: string }): T[] =>
      this.discovery
        .getProviders({ metadataKey: decorator.KEY })
        .map((wrapper) => wrapper.instance as T)
        .filter(Boolean);
    this.inbox = instances<InboxProvider>(RegisterInboxProvider);
    this.search = instances<SearchProvider>(RegisterSearchProvider);
    this.myDay = instances<MyDayContributor>(RegisterMyDayContributor);
    this.attachmentPolicies = instances<AttachmentPolicy>(RegisterAttachmentPolicy);
    this.logger.log(
      `Providers: inbox ${this.inbox.length}, search ${this.search.length}, my-day ${this.myDay.length}, attachment policies ${this.attachmentPolicies.length}`,
    );
  }

  attachmentPolicyFor(entityType: string): AttachmentPolicy | undefined {
    return this.attachmentPolicies.find((policy) => policy.entityTypes.includes(entityType));
  }
}
