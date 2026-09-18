import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Language,
  MembershipStatus,
  PlatformRole,
  PrismaClient,
  TenantRole,
  TenantStatus,
  UserStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('BeautyFlow foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const password = 'StrongPassword123!';
  let tenantA: string;
  let tenantB: string;
  let branchA1: string;
  let branchA2: string;
  let branchB1: string;
  let providerMembershipId: string;
  let stage2CategoryId: string;
  let stage2ServiceId: string;
  let stage2ProviderId: string;

  const login = async (email: string, tenantSlug?: string) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password, ...(tenantSlug ? { tenantSlug } : {}) });
    return response;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.auditLog.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.providerService.deleteMany();
    await prisma.serviceProviderProfile.deleteMany();
    await prisma.branchService.deleteMany();
    await prisma.catalogService.deleteMany();
    await prisma.serviceCategory.deleteMany();
    await prisma.membershipBranch.deleteMany();
    await prisma.tenantMembership.deleteMany();
    await prisma.branch.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
    const hash = await bcrypt.hash(password, 12);
    const a = await prisma.tenant.create({
      data: {
        name: 'Tenant A Data',
        slug: 'tenant-a',
        currencyCode: 'PKR',
        timezone: 'Asia/Karachi',
      },
    });
    const b = await prisma.tenant.create({
      data: {
        name: 'Tenant B Data',
        slug: 'tenant-b',
        currencyCode: 'AED',
        timezone: 'Asia/Dubai',
      },
    });
    tenantA = a.id;
    tenantB = b.id;
    const [a1, a2, b1] = await Promise.all([
      prisma.branch.create({ data: { tenantId: a.id, name: 'A One', code: 'ONE' } }),
      prisma.branch.create({ data: { tenantId: a.id, name: 'A Two', code: 'TWO' } }),
      prisma.branch.create({ data: { tenantId: b.id, name: 'B One', code: 'ONE' } }),
    ]);
    branchA1 = a1.id;
    branchA2 = a2.id;
    branchB1 = b1.id;
    const make = async (
      email: string,
      role: TenantRole,
      tenantId: string,
      status: UserStatus = UserStatus.ACTIVE,
      assigned: string[] = [],
    ) => {
      const user = await prisma.user.create({
        data: { email, firstName: 'Test', lastName: role, passwordHash: hash, status },
      });
      const membership = await prisma.tenantMembership.create({
        data: { tenantId, userId: user.id, role, status: MembershipStatus.ACTIVE },
      });
      for (const branchId of assigned)
        await prisma.membershipBranch.create({
          data: { membershipId: membership.id, branchId, tenantId },
        });
      return { user, membership };
    };
    await make('owner-a@example.com', TenantRole.SALON_OWNER, a.id);
    await make('reception@example.com', TenantRole.RECEPTIONIST, a.id, UserStatus.ACTIVE, [a1.id]);
    const provider = await make(
      'provider@example.com',
      TenantRole.SERVICE_PROVIDER,
      a.id,
      UserStatus.ACTIVE,
      [a1.id],
    );
    providerMembershipId = provider.membership.id;
    await make('suspended@example.com', TenantRole.RECEPTIONIST, a.id, UserStatus.SUSPENDED, [
      a1.id,
    ]);
    await make('owner-b@example.com', TenantRole.SALON_OWNER, b.id);
    await prisma.user.create({
      data: {
        email: 'admin@example.com',
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: hash,
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.SUPER_ADMIN,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. logs in an owner and returns safe current-user data', async () => {
    const auth = await login('OWNER-A@EXAMPLE.COM', 'tenant-a');
    expect(auth.status).toBe(201);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.tenant.role).toBe('SALON_OWNER');
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });
  it('2. returns the same safe error for invalid credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong' });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid credentials or account unavailable');
  });
  it('3. rejects a suspended user', async () => {
    expect((await login('suspended@example.com', 'tenant-a')).status).toBe(401);
  });
  it('4. rejects a suspended tenant', async () => {
    await prisma.tenant.update({
      where: { id: tenantA },
      data: { status: TenantStatus.SUSPENDED },
    });
    expect((await login('owner-a@example.com', 'tenant-a')).status).toBe(401);
    await prisma.tenant.update({ where: { id: tenantA }, data: { status: TenantStatus.ACTIVE } });
  });
  it('5. rotates refresh tokens and rejects reuse', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const old = auth.body.data.refreshToken;
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: old });
    expect(rotated.status).toBe(201);
    expect(rotated.body.data.refreshToken).not.toBe(old);
    expect(
      (await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: old }))
        .status,
    ).toBe(401);
  });
  it('6. logout revokes the current session', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: auth.body.data.refreshToken })
      .expect(401);
  });
  it('7 and 12. tenant A cannot access or discover tenant B data', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchB1}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(404);
  });
  it('8. owner manages branches in their tenant', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const created = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: 'New Branch', code: 'NEW' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('NEW');
  });
  it('9. receptionist cannot update tenant settings', async () => {
    const auth = await login('reception@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .patch('/api/v1/tenant/settings')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: 'Nope' })
      .expect(403);
  });
  it.each([
    ['10. receptionist', 'reception@example.com'],
    ['11. provider', 'provider@example.com'],
  ])('%s cannot use an unassigned branch', async (_label, email) => {
    const auth = await login(email, 'tenant-a');
    await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .set('X-Branch-Id', branchA2)
      .expect(404);
  });
  it('13. Super Admin atomically creates tenant, branch, and owner', async () => {
    const auth = await login('admin@example.com');
    const response = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({
        name: 'Created Salon',
        slug: 'created-salon',
        currencyCode: 'SAR',
        timezone: 'Asia/Riyadh',
        initialBranch: { name: 'Main', code: 'MAIN' },
        owner: {
          email: 'created-owner@example.com',
          firstName: 'Created',
          lastName: 'Owner',
          password,
        },
      });
    expect(response.status).toBe(201);
    expect(response.body.data.owner.role).toBe('SALON_OWNER');
  });
  it('14 and 15. changes language without changing tenant-created data', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const response = await request(app.getHttpServer())
      .patch('/api/v1/tenant/settings')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ defaultLanguage: Language.AR });
    expect(response.status).toBe(200);
    expect(response.body.data.defaultLanguage).toBe('AR');
    expect(response.body.data.name).toBe('Tenant A Data');
  });
  it('16. rejects duplicate branch codes in one tenant', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: 'Duplicate', code: 'ONE' })
      .expect(409);
  });
  it('17. permits the same branch code in different tenants', async () => {
    const [a, b] = await Promise.all([
      prisma.branch.count({ where: { tenantId: tenantA, code: 'ONE' } }),
      prisma.branch.count({ where: { tenantId: tenantB, code: 'ONE' } }),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
  it('18. never serializes password or stored token hashes', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const members = await request(app.getHttpServer())
      .get('/api/v1/memberships')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    const serialized = JSON.stringify(members.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('tokenHash');
  });

  it('19. owner creates an Arabic category and normalized duplicates are rejected', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const created = await request(app.getHttpServer())
      .post('/api/v1/service-categories')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: '  العناية بالشعر  ', sortOrder: 1 });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('العناية بالشعر');
    stage2CategoryId = created.body.data.id;
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/service-categories')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: 'العناية   بالشعر' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('SERVICE_CATEGORY_NAME_EXISTS');
  });

  it('20. receptionist cannot create a category', async () => {
    const auth = await login('reception@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post('/api/v1/service-categories')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: 'Forbidden' })
      .expect(403);
  });

  it('21. different tenants may reuse a category name', async () => {
    const auth = await login('owner-b@example.com', 'tenant-b');
    await request(app.getHttpServer())
      .post('/api/v1/service-categories')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ name: 'العناية بالشعر' })
      .expect(201);
  });

  it('22. creates a fixed-precision service with Arabic content and supports search', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const created = await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({
        categoryId: stage2CategoryId,
        name: 'قص الشعر',
        description: 'قصة شعر احترافية',
        code: 'CUT-AR',
        defaultPrice: 100.5,
        durationMinutes: 45,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.defaultPrice).toBe('100.50');
    stage2ServiceId = created.body.data.id;
    const found = await request(app.getHttpServer())
      .get('/api/v1/catalog-services?search=الشعر')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(found.text).toContain(stage2ServiceId);
  });

  it('23. rejects invalid service price, duration, and another tenant category', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ categoryId: stage2CategoryId, name: 'Bad price', defaultPrice: -1 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({
        categoryId: stage2CategoryId,
        name: 'Bad duration',
        defaultPrice: 1,
        durationMinutes: 0,
      })
      .expect(400);
    const foreignCategory = await prisma.serviceCategory.findFirstOrThrow({
      where: { tenantId: tenantB },
    });
    await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ categoryId: foreignCategory.id, name: 'Cross tenant', defaultPrice: 1 })
      .expect(404);
  });

  it('24. inherits branch defaults, applies an override, and reset restores inheritance', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const inherited = await request(app.getHttpServer())
      .get(`/api/v1/catalog-services/${stage2ServiceId}?branchId=${branchA1}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(inherited.body.data).toMatchObject({
      priceOverride: null,
      effectivePrice: '100.50',
      availabilityOverride: null,
      effectiveAvailability: true,
    });
    const overridden = await request(app.getHttpServer())
      .put(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ isAvailable: false, priceOverride: 125.75 });
    expect(overridden.body.data).toMatchObject({
      priceOverride: '125.75',
      effectivePrice: '125.75',
      effectiveAvailability: false,
    });
    const reset = await request(app.getHttpServer())
      .delete(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}/configuration`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(reset.body.data).toMatchObject({
      priceOverride: null,
      effectivePrice: '100.50',
      effectiveAvailability: true,
    });
  });

  it('25. receptionist reads an assigned branch catalog but not another branch', async () => {
    const auth = await login('reception@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchA1}/catalog-services`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchA2}/catalog-services`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(404);
  });

  it('26. creates a provider only for a provider membership and prevents duplicates', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const created = await request(app.getHttpServer())
      .post('/api/v1/service-providers')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({
        membershipId: providerMembershipId,
        displayName: 'ليلى خبيرة الشعر',
        jobTitle: 'مصففة شعر',
      });
    expect(created.status).toBe(201);
    stage2ProviderId = created.body.data.id;
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');
    await request(app.getHttpServer())
      .post('/api/v1/service-providers')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ membershipId: providerMembershipId, displayName: 'Duplicate' })
      .expect(409);
    const receptionistMembership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: tenantA, role: TenantRole.RECEPTIONIST },
    });
    const wrongRole = await request(app.getHttpServer())
      .post('/api/v1/service-providers')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ membershipId: receptionistMembership.id, displayName: 'Wrong role' });
    expect(wrongRole.body.code).toBe('MEMBERSHIP_NOT_SERVICE_PROVIDER');
  });

  it('27. qualification add is idempotent, replace deduplicates, and remove works', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post(`/api/v1/service-providers/${stage2ProviderId}/qualifications/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/service-providers/${stage2ProviderId}/qualifications/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    const replaced = await request(app.getHttpServer())
      .put(`/api/v1/service-providers/${stage2ProviderId}/qualifications`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ serviceIds: [stage2ServiceId, stage2ServiceId] });
    expect(replaced.body.data).toHaveLength(1);
    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/service-providers/${stage2ProviderId}/qualifications/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(removed.body.data).toHaveLength(0);
    await request(app.getHttpServer())
      .post(`/api/v1/service-providers/${stage2ProviderId}/qualifications/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
  });

  it('28. eligibility enforces qualification, branch assignment, profile activity, and branch availability', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const eligible = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}/eligible-providers`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(eligible.text).toContain(stage2ProviderId);
    await request(app.getHttpServer())
      .post(`/api/v1/service-providers/${stage2ProviderId}/deactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    const inactive = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}/eligible-providers`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(inactive.body.data).toHaveLength(0);
    await request(app.getHttpServer())
      .post(`/api/v1/service-providers/${stage2ProviderId}/reactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    const otherBranch = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchA2}/catalog-services/${stage2ServiceId}/eligible-providers`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(otherBranch.body.data).toHaveLength(0);
    await request(app.getHttpServer())
      .put(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ isAvailable: false, priceOverride: null });
    const disabled = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}/eligible-providers`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(disabled.body.data).toHaveLength(0);
  });

  it('29. receptionist cannot configure branch service pricing', async () => {
    const auth = await login('reception@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .put(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ isAvailable: true, priceOverride: 50 })
      .expect(403);
  });

  it('30. provider cannot manage qualifications', async () => {
    const auth = await login('provider@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .put(`/api/v1/service-providers/${stage2ProviderId}/qualifications`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ serviceIds: [] })
      .expect(403);
  });

  it('31. rejects a duplicate normalized service name in its category', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ categoryId: stage2CategoryId, name: '  قص   الشعر ', defaultPrice: 200 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('CATALOG_SERVICE_NAME_EXISTS');
  });

  it('32. rejects a duplicate normalized service code in its tenant', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({
        categoryId: stage2CategoryId,
        name: 'Different treatment',
        code: ' cut-ar ',
        defaultPrice: 200,
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('CATALOG_SERVICE_CODE_EXISTS');
  });

  it('33. inactive service stays unavailable when its branch override says available', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .put(`/api/v1/branches/${branchA1}/catalog-services/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ isAvailable: true, priceOverride: null })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog-services/${stage2ServiceId}/deactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    const service = await request(app.getHttpServer())
      .get(`/api/v1/catalog-services/${stage2ServiceId}?branchId=${branchA1}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(service.body.data.effectiveAvailability).toBe(false);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog-services/${stage2ServiceId}/reactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
  });

  it('34. inactive category makes its active services effectively unavailable', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post(`/api/v1/service-categories/${stage2CategoryId}/deactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    const service = await request(app.getHttpServer())
      .get(`/api/v1/catalog-services/${stage2ServiceId}?branchId=${branchA1}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`);
    expect(service.body.data.effectiveAvailability).toBe(false);
    await request(app.getHttpServer())
      .post(`/api/v1/service-categories/${stage2CategoryId}/reactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
  });

  it('35. bulk qualification replacement rejects cross-tenant IDs atomically', async () => {
    const ownerB = await login('owner-b@example.com', 'tenant-b');
    const foreignCategory = await prisma.serviceCategory.findFirstOrThrow({
      where: { tenantId: tenantB },
    });
    const foreign = await request(app.getHttpServer())
      .post('/api/v1/catalog-services')
      .set('Authorization', `Bearer ${ownerB.body.data.accessToken}`)
      .send({
        categoryId: foreignCategory.id,
        name: 'Foreign service',
        code: 'FOREIGN',
        defaultPrice: 10,
      });
    expect(foreign.status).toBe(201);
    const ownerA = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .put(`/api/v1/service-providers/${stage2ProviderId}/qualifications`)
      .set('Authorization', `Bearer ${ownerA.body.data.accessToken}`)
      .send({ serviceIds: [stage2ServiceId, foreign.body.data.id] })
      .expect(404);
    const unchanged = await request(app.getHttpServer())
      .get(`/api/v1/service-providers/${stage2ProviderId}/qualifications`)
      .set('Authorization', `Bearer ${ownerA.body.data.accessToken}`);
    expect(unchanged.body.data).toHaveLength(1);
  });

  it('36. provider can read their own profile and qualifications', async () => {
    const auth = await login('provider@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .get(`/api/v1/service-providers/${stage2ProviderId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/service-providers/${stage2ProviderId}/qualifications`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(200);
  });

  it('37. rejects unsafe provider image URL protocols', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .patch(`/api/v1/service-providers/${stage2ProviderId}`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ profileImageUrl: 'javascript:alert(1)' })
      .expect(400);
  });

  it('38. records Stage 2 business audit events', async () => {
    const actions = await prisma.auditLog.findMany({
      where: { tenantId: tenantA, action: { startsWith: 'SERVICE_' } },
      select: { action: true },
    });
    expect(actions.length).toBeGreaterThan(0);
  });

  it('39. deactivation is historical-safe and tenant resources do not leak', async () => {
    const auth = await login('owner-a@example.com', 'tenant-a');
    await request(app.getHttpServer())
      .post(`/api/v1/service-categories/${stage2CategoryId}/deactivate`)
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .expect(201);
    expect(
      await prisma.serviceCategory.count({
        where: { id: stage2CategoryId, isActive: false, deletedAt: null },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .patch('/api/v1/tenant/settings')
      .set('Authorization', `Bearer ${auth.body.data.accessToken}`)
      .send({ defaultLanguage: Language.EN })
      .expect(200);
    const storedService = await prisma.catalogService.findUniqueOrThrow({
      where: { id: stage2ServiceId },
    });
    const storedProvider = await prisma.serviceProviderProfile.findUniqueOrThrow({
      where: { id: stage2ProviderId },
    });
    expect(storedService.name).toBe('قص الشعر');
    expect(storedProvider.displayName).toBe('ليلى خبيرة الشعر');
    const ownerB = await login('owner-b@example.com', 'tenant-b');
    await request(app.getHttpServer())
      .get(`/api/v1/catalog-services/${stage2ServiceId}`)
      .set('Authorization', `Bearer ${ownerB.body.data.accessToken}`)
      .expect(404);
  });
});
