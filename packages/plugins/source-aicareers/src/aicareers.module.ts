import { Module } from '@nestjs/common';
import { AicareersService } from './aicareers.service';

@Module({
  providers: [AicareersService],
  exports: [AicareersService],
})
export class AicareersModule {}
