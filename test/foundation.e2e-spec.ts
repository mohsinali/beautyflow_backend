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
  let branchA2: string;
  let branchB1: string;

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
    await make('provider@example.com', TenantRole.SERVICE_PROVIDER, a.id, UserStatus.ACTIVE, [
      a1.id,
    ]);
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
});
