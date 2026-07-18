import { Module } from '@nestjs/common';
import { RedditSocialService } from './reddit-social.service';

@Module({
  providers: [RedditSocialService],
  exports: [RedditSocialService],
})
export class RedditSocialModule {}
