import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithContext } from './types/request-context';

interface ExceptionBody {
  message?: string | string[];
  code?: string;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithContext>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logServerError(exception, request);
    }

    const raw = exception instanceof HttpException ? exception.getResponse() : {};
    const body: ExceptionBody = typeof raw === 'string' ? { message: raw } : raw;
    const validation = Array.isArray(body.message);
    const defaultCodes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
    };
    response.status(status).json({
      statusCode: status,
      code: body.code ?? (validation ? 'VALIDATION_ERROR' : (defaultCodes[status] ?? 'HTTP_ERROR')),
      message: validation
        ? 'Request validation failed'
        : (body.message ?? 'An unexpected error occurred'),
      ...(validation
        ? { details: body.message }
        : body.details === undefined
          ? {}
          : { details: body.details }),
      requestId: request.requestId,
    });
  }

  private logServerError(exception: unknown, request: RequestWithContext): void {
    const path = request.originalUrl.split('?', 1)[0];
    const exceptionName =
      exception instanceof Error ? exception.constructor.name : 'UnknownException';
    const context = `${request.method} ${path} requestId=${request.requestId} ${exceptionName}`;

    if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
      this.logger.error(`${context}: ${exception.message}`, exception.stack);
      return;
    }

    this.logger.error(context);
  }
}
