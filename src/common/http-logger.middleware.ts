import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from './types/request-context';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const path = request.originalUrl.split('?', 1)[0];
      const message = `${request.method} ${path} ${response.statusCode} ${Math.round(durationMs)}ms requestId=${request.requestId}`;

      if (response.statusCode >= 500) {
        this.logger.error(message);
      } else if (response.statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}
