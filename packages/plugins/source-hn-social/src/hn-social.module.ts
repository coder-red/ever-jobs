import { Module } from '@nestjs/common';
import { HnSocialService } from './hn-social.service';

@Module({
  providers: [HnSocialService],
  exports: [HnSocialService],
})
export class HnSocialModule {}
