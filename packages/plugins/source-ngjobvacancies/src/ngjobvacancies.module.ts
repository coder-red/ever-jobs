import { Module } from '@nestjs/common';
import { NgJobVacanciesService } from './ngjobvacancies.service';

@Module({
  providers: [NgJobVacanciesService],
  exports: [NgJobVacanciesService],
})
export class NgJobVacanciesModule {}
