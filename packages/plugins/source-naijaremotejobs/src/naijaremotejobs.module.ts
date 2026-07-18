import { Module } from '@nestjs/common';
import { NaijaremotejobsService } from './naijaremotejobs.service';

@Module({
  providers: [NaijaremotejobsService],
  exports: [NaijaremotejobsService],
})
export class NaijaremotejobsModule {}
