import { Module } from '@nestjs/common';
import { JobgurusService } from './jobgurus.service';

@Module({
  providers: [JobgurusService],
  exports: [JobgurusService],
})
export class JobgurusModule {}
