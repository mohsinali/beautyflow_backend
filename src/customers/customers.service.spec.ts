/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { NotFoundException } from '@nestjs/common';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { CustomersService, normalizePhone } from './customers.service';
import { CustomerStatusFilter } from './dto/customer.dto';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const actor = { userId: '44444444-4444-4444-8444-444444444444' } as AuthContext;
const request = {} as RequestWithContext;
const customer = {
  id: customerId,
  name: 'Sara',
  phone: null,
  notes: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  preferredBranch: null,
};

function setup() {
  const prisma = {
    customer: {
      create: jest.fn().mockResolvedValue(customer),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(customer),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch' }) },
    $transaction: jest
      .fn()
      .mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    service: new CustomersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
  };
}

describe('CustomersService critical rules', () => {
  it('creates a customer with name only and keeps phone optional', async () => {
    const { service, prisma } = setup();
    await service.create(tenantA, { name: '  سارة  ' }, actor, request);
    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: tenantA,
          name: 'سارة',
          phone: null,
          normalizedPhone: null,
        }),
      }),
    );
  });

  it('searches by partial name', async () => {
    const { service, prisma } = setup();
    await service.list(tenantA, {
      search: 'Sara',
      status: CustomerStatusFilter.ALL,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: tenantA,
          OR: expect.arrayContaining([{ name: { contains: 'Sara', mode: 'insensitive' } }]),
        }),
      }),
    );
  });

  it('normalizes formatting and searches by phone', async () => {
    expect(normalizePhone('+92 300-123(4567)')).toBe('+923001234567');
    const { service, prisma } = setup();
    await service.list(tenantA, {
      search: '+92-300',
      status: CustomerStatusFilter.ACTIVE,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ normalizedPhone: { contains: '+92300' } }]),
        }),
      }),
    );
  });

  it('rejects a duplicate active phone in the same tenant', async () => {
    const { service, prisma } = setup();
    prisma.customer.findFirst.mockResolvedValueOnce({ id: customerId });
    await expect(
      service.create(tenantA, { name: 'Sara', phone: '+92 300 1234567' }, actor, request),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_PHONE_EXISTS' } });
  });

  it('allows the same normalized phone in different tenants', async () => {
    const { service, prisma } = setup();
    await service.create(tenantA, { name: 'Sara', phone: '+923001234567' }, actor, request);
    await service.create(tenantB, { name: 'Maya', phone: '+92-300-1234567' }, actor, request);
    expect(prisma.customer.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: tenantB, normalizedPhone: '+923001234567' }),
      }),
    );
  });

  it('does not expose a customer from another tenant', async () => {
    const { service, prisma } = setup();
    prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(service.get(tenantA, customerId)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: tenantA }) }),
    );
  });

  it('rejects a preferred branch outside the tenant', async () => {
    const { service, prisma } = setup();
    prisma.branch.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.create(
        tenantA,
        { name: 'Sara', preferredBranchId: '55555555-5555-4555-8555-555555555555' },
        actor,
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_BRANCH_NOT_FOUND' } });
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: tenantA }) }),
    );
  });

  it('deactivates without deleting the customer record', async () => {
    const { service, prisma } = setup();
    prisma.customer.findFirst.mockResolvedValueOnce({ id: customerId, normalizedPhone: null });
    await service.setActive(tenantA, customerId, false, actor, request);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: customerId }, data: { isActive: false } }),
    );
    expect(prisma.customer.update.mock.calls[0][0].data).not.toHaveProperty('deletedAt');
  });
});
