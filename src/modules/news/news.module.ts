import { Module } from '@nestjs/common';
import { CoreExtensionsModule } from '@/modules/core/meta/core-extensions.module';
import { NewsAbilities } from './abilities/news.abilities';
import { LinksController } from './controllers/links.controller';
import { NewsController } from './controllers/news.controller';
import { NewsJobs } from './jobs/news.jobs';
import { NewsPostWorkflow } from './machines/news-post.workflow';
import { NEWS_AUDIT_LABELS, NEWS_ENUMS, newsPostWorkflowMeta } from './news.enums';
import { LinksService } from './services/links.service';
import { NewsAttachmentPolicy } from './services/news-attachment.policy';
import { NewsMyDayContributor } from './services/news-my-day.contributor';
import { NewsSearchProvider } from './services/news-search.provider';
import { NewsService } from './services/news.service';

/** Slice A4 - news posts and useful links (SPEC §4.6, §5.5). */
@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      enums: NEWS_ENUMS,
      workflows: [newsPostWorkflowMeta],
      auditLabels: NEWS_AUDIT_LABELS,
    }),
  ],
  controllers: [LinksController, NewsController],
  providers: [
    NewsAbilities,
    NewsPostWorkflow,
    NewsService,
    LinksService,
    NewsJobs,
    NewsSearchProvider,
    NewsMyDayContributor,
    NewsAttachmentPolicy,
  ],
  exports: [NewsService, LinksService],
})
export class NewsModule {}
