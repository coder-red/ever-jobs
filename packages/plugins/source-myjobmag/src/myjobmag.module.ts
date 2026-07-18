import { Module } from '@nestjs/common';
import { MyJobMagService } from './myjobmag.service';

@Module({
  providers: [MyJobMagService],
  exports: [MyJobMagService],
})
export class MyJobMagModule {}
