import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}
  @Get()
  live() {
    return { status: 'ok', application: 'up' };
  }

  @Get('ready')
  async ready() {
    const checks = { postgresql: false, redis: false };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgresql = true;
    } catch {
      /* reported below */
    }
    try {
      checks.redis = await this.redis.ping();
    } catch {
      /* reported below */
    }
    const result = { status: checks.postgresql && checks.redis ? 'ready' : 'not_ready', checks };
    if (result.status !== 'ready')
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Application is not ready',
        details: checks,
      });
    return result;
  }
}
