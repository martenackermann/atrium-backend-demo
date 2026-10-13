import { Injectable } from '@nestjs/common';
import { type JobRunContext, type JobSummary, ScheduledJob } from '@/modules/core/jobs/scheduled-job.decorator';
import { NewsService } from '../services/news.service';

@Injectable()
export class NewsJobs {
  constructor(private readonly news: NewsService) {}

  /** SPEC §8: scheduled posts go live at `publishAt`; published posts expire at `expireAt`. */
  @ScheduledJob({
    name: 'news.publish-and-expire',
    slice: 'A4',
    cronEnv: 'CRON_NEWS',
    description: 'Publishes scheduled news posts that are due and archives expired ones',
  })
  async publishAndExpire(ctx: JobRunContext): Promise<JobSummary> {
    return this.news.publishAndExpire(ctx.now);
  }
}
