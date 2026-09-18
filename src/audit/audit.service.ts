import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  tenantId?: string | null;
  branchId?: string | null;
  actorUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
  request?: RequestWithContext;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        tenantId: input.tenantId,
        branchId: input.branchId,
        actorUserId: input.actorUserId,
        metadata: input.metadata,
        ipAddress: input.request?.ip,
        userAgent: input.request?.get('user-agent'),
      },
    });
  }
}
