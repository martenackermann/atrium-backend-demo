import { Module } from '@nestjs/common';
import { HomeController } from './controllers/home.controller';
import { HomeService } from './services/home.service';

/** Slice A4 - Home "My day" (no tables; consumes the core provider framework). */
@Module({
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
