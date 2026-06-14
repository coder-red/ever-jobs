import { Module } from '@nestjs/common';
import { NgDevsService } from './ngdevs.service';

@Module({
  providers: [NgDevsService],
  exports: [NgDevsService],
})
export class NgDevsModule {}
