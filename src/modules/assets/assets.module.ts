import { Module } from '@nestjs/common';
import { CoreExtensionsModule } from '@/modules/core/meta/core-extensions.module';
import { AssetsAbilities } from './abilities/assets.abilities';
import { ASSET_AUDIT_LABELS, ASSET_ENUMS } from './assets.enums';
import { AssetsController } from './controllers/assets.controller';
import { CatalogController } from './controllers/catalog.controller';
import { AssetsJobs } from './jobs/assets.jobs';
import { assetWorkflowMeta } from './machines/asset.machine';
import { AssetWorkflow } from './machines/asset.workflow';
import { AssetActionsService } from './services/asset-actions.service';
import { AssetDashboardService } from './services/asset-dashboard.service';
import { AssetsInboxProvider } from './services/assets-inbox.provider';
import { AssetsMyDayContributor } from './services/assets-my-day.contributor';
import { AssetsSearchProvider } from './services/assets-search.provider';
import { AssetsService } from './services/assets.service';
import { CatalogService } from './services/catalog.service';

/**
 * Assets (slice A3): catalogue, inventory, assignment/acceptance lifecycle, dashboard,
 * cost-centre sync and acceptance reminders (SPEC §4.4, §5.3, §8; API.md §6).
 * Notification templates in ./mail and the seed in ./seed are discovered by core.
 */
@Module({
  imports: [
    CoreExtensionsModule.forFeature({
      enums: ASSET_ENUMS,
      workflows: [assetWorkflowMeta],
      auditLabels: ASSET_AUDIT_LABELS,
    }),
  ],
  // The catalogue controller first: its static paths must win over `/assets/:id` routes.
  controllers: [CatalogController, AssetsController],
  providers: [
    AssetsAbilities,
    AssetWorkflow,
    AssetActionsService,
    AssetsService,
    AssetDashboardService,
    CatalogService,
    AssetsInboxProvider,
    AssetsSearchProvider,
    AssetsMyDayContributor,
    AssetsJobs,
  ],
})
export class AssetsModule {}
