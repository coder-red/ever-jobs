import { Module } from '@nestjs/common';
import { JobnowService } from './jobnow.service';

@Module({
  providers: [JobnowService],
  exports: [JobnowService],
})
export class JobnowModule {}
