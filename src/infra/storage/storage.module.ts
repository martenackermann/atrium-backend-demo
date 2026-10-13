import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Private blob storage + signed tokens. Attachments (metadata, access, downloads) live in core. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
