/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import type { PrismaService } from '../prisma/prisma.service';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/branch.dto';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: '33333333-3333-4333-8333-333333333333' } as AuthContext;
const request = {} as RequestWithContext;
const branch = {
  id: branchId,
  name: 'Main Branch',
  code: 'BR-12345678',
  phone: null,
  email: null,
  address: null,
  city: null,
  timezone: 'Asia/Karachi',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  tenant: { timezone: 'UTC' },
};

function setup() {
  const prisma = {
    branch: {
      create: jest.fn().mockResolvedValue(branch),
      findFirst: jest.fn().mockResolvedValue({ id: branchId }),
      update: jest.fn().mockResolvedValue(branch),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    service: new BranchesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
  };
}

describe('BranchesService management rules', () => {
  it('rejects an invalid IANA timezone', async () => {
    const dto = plainToInstance(CreateBranchDto, {
      name: 'Main Branch',
      timezone: 'Pakistan Time',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'timezone')).toBe(true);
  });

  it('generates the internal code when the management form omits it', async () => {
    const { service, prisma } = setup();
    await service.create(
      tenantId,
      { name: 'Main Branch', timezone: 'Asia/Karachi' },
      actor,
      request,
    );
    expect(prisma.branch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          code: expect.stringMatching(/^BR-[A-F0-9]{8}$/),
          timezone: 'Asia/Karachi',
        }),
      }),
    );
  });

  it('scopes updates to the authenticated tenant', async () => {
    const { service, prisma } = setup();
    prisma.branch.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.update(tenantId, branchId, { timezone: 'Asia/Riyadh' }, actor, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.branch.update).not.toHaveBeenCalled();
  });

  it('deactivates without deleting the branch and records an audit event', async () => {
    const { service, prisma, audit } = setup();
    await service.setActive(tenantId, branchId, false, actor, request);
    expect(prisma.branch.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: branchId }, data: { isActive: false } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BRANCH_DEACTIVATED', tenantId, entityId: branchId }),
    );
  });
});
