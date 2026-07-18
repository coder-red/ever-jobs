import { Module } from '@nestjs/common';
import { BlueskySocialService } from './bluesky-social.service';

@Module({
  providers: [BlueskySocialService],
  exports: [BlueskySocialService],
})
export class BlueskySocialModule {}
