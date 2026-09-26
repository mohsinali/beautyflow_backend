import { Module } from '@nestjs/common';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [ServiceProvidersModule],
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
