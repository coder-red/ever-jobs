import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CollectorService } from './collector.service';
import { CollectCommand } from './commands/collect.command';
import { ListCommand } from './commands/list.command';
import { ServeCommand } from './commands/serve.command';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
  ],
  providers: [CollectorService, CollectCommand, ListCommand, ServeCommand],
})
export class CollectorModule {}
