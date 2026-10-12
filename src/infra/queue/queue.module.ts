import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { QueueService } from './queue.service';

/** Background jobs on pg-boss (Postgres schema `pgboss`). */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
