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

const prisma = new PrismaClient();
const password = (name: string, fallback: string) => process.env[name] ?? fallback;

async function upsertUser(
  email: string,
  firstName: string,
  lastName: string,
  rawPassword: string,
  platformRole?: PlatformRole,
) {
  const passwordHash = await bcrypt.hash(rawPassword, 12);
  return prisma.user.upsert({
    where: { email },
    create: {
      email,
      firstName,
      lastName,
      passwordHash,
      status: UserStatus.ACTIVE,
      platformRole,
    },
    update: {
      firstName,
      lastName,
      status: UserStatus.ACTIVE,
      passwordHash,
      ...(platformRole ? { platformRole } : {}),
    },
  });
}

async function main(): Promise<void> {
  await upsertUser(
    (process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@beautyflow.local').toLowerCase(),
    'Platform',
    'Admin',
    password('SEED_SUPER_ADMIN_PASSWORD', 'ChangeMe123!'),
    PlatformRole.SUPER_ADMIN,
  );
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'glow-salon' },
    create: {
      name: 'Glow Salon',
      slug: 'glow-salon',
      defaultLanguage: Language.EN,
      currencyCode: 'PKR',
      timezone: 'Asia/Karachi',
      status: TenantStatus.ACTIVE,
    },
    update: { status: TenantStatus.ACTIVE },
  });
  const mainBranch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MAIN' } },
    create: {
      tenantId: tenant.id,
      name: 'Glow Salon Main',
      code: 'MAIN',
      city: 'Karachi',
      isActive: true,
    },
    update: { name: 'Glow Salon Main', isActive: true },
  });
  const northBranch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'NORTH' } },
    create: {
      tenantId: tenant.id,
      name: 'Glow Salon North',
      code: 'NORTH',
      city: 'Karachi',
      timezone: 'Asia/Karachi',
      isActive: true,
    },
    update: { name: 'Glow Salon North', isActive: true },
  });
  const accounts = [
    {
      email: (process.env.SEED_OWNER_EMAIL ?? 'owner@example.com').toLowerCase(),
      firstName: 'Olivia',
      lastName: 'Owner',
      role: TenantRole.SALON_OWNER,
      pass: password('SEED_OWNER_PASSWORD', 'ChangeMe123!'),
      branches: [],
    },
    {
      email: (process.env.SEED_RECEPTIONIST_EMAIL ?? 'receptionist@example.com').toLowerCase(),
      firstName: 'Rita',
      lastName: 'Receptionist',
      role: TenantRole.RECEPTIONIST,
      pass: password('SEED_RECEPTIONIST_PASSWORD', 'ChangeMe123!'),
      branches: [mainBranch.id],
    },
    {
      email: (process.env.SEED_PROVIDER_EMAIL ?? 'provider@example.com').toLowerCase(),
      firstName: 'Sam',
      lastName: 'Stylist',
      role: TenantRole.SERVICE_PROVIDER,
      pass: password('SEED_PROVIDER_PASSWORD', 'ChangeMe123!'),
      branches: [northBranch.id],
    },
  ];
  for (const account of accounts) {
    const user = await upsertUser(account.email, account.firstName, account.lastName, account.pass);
    const membership = await prisma.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: account.role,
        status: MembershipStatus.ACTIVE,
      },
      update: { role: account.role, status: MembershipStatus.ACTIVE },
    });
    for (const branchId of account.branches) {
      await prisma.membershipBranch.upsert({
        where: { membershipId_branchId: { membershipId: membership.id, branchId } },
        create: { membershipId: membership.id, branchId, tenantId: tenant.id },
        update: {},
      });
    }
  }
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
