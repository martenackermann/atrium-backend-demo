import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/queue/job-handler.decorator';
import { MAIL_SEND_JOB, type MailJob, MailService } from './mail.service';

@Injectable()
export class MailJobs {
  private readonly logger = new Logger(MailJobs.name);

  constructor(private readonly mail: MailService) {}

  @JobHandler(MAIL_SEND_JOB, { queue: { retryLimit: 3, retryDelay: 30, retryBackoff: true } })
  async send(job: MailJob): Promise<void> {
    const messageId = await this.mail.deliver(job);
    this.logger.log(`Mail "${job.template}" sent to ${job.to.join(', ')} (${messageId})`);
  }
}
