import { Module } from '@nestjs/common';
import { HotNigerianJobsService } from './hotnigerianjobs.service';

@Module({
  providers: [HotNigerianJobsService],
  exports: [HotNigerianJobsService],
})
export class HotNigerianJobsModule {}
