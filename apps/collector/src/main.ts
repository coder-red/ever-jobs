import { CommandFactory } from 'nest-commander';
import { CollectorModule } from './collector.module';

async function bootstrap() {
  await CommandFactory.run(CollectorModule, {
    logger: ['error', 'warn', 'log'],
    errorHandler: (err) => {
      console.error('Error:', err.message);
      process.exit(1);
    },
  });
}

bootstrap();
