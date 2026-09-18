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

const normalized = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

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
    {
      email: 'provider-two@example.com',
      firstName: 'Maya',
      lastName: 'Artist',
      role: TenantRole.SERVICE_PROVIDER,
      pass: password('SEED_PROVIDER_TWO_PASSWORD', 'ChangeMe123!'),
      branches: [mainBranch.id, northBranch.id],
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

  const categoryNames = ['Hair', 'Nails', 'Makeup', 'Skin Care'];
  const categories = new Map<string, string>();
  for (const [sortOrder, name] of categoryNames.entries()) {
    const existing = await prisma.serviceCategory.findFirst({
      where: { tenantId: tenant.id, normalizedName: normalized(name) },
    });
    const category = existing
      ? await prisma.serviceCategory.update({
          where: { id: existing.id },
          data: { name, sortOrder, isActive: true, deletedAt: null },
        })
      : await prisma.serviceCategory.create({
          data: { tenantId: tenant.id, name, normalizedName: normalized(name), sortOrder },
        });
    categories.set(name, category.id);
  }
  const serviceSeeds = [
    ['Hair', 'Haircut', 'HAIRCUT', '1500.00', 45],
    ['Hair', 'Hair Styling', 'STYLE', '2500.00', 60],
    ['Hair', 'Hair Coloring', 'COLOR', '6500.00', 120],
    ['Nails', 'Manicure', 'MANI', '1800.00', 45],
    ['Nails', 'Pedicure', 'PEDI', '2200.00', 60],
    ['Makeup', 'Bridal Makeup', 'BRIDAL', '25000.00', 180],
    ['Makeup', 'Party Makeup', 'PARTY', '7500.00', 90],
    ['Skin Care', 'Facial', 'FACIAL', '4000.00', 75],
  ] as const;
  const services = new Map<string, string>();
  for (const [
    sortOrder,
    [categoryName, name, code, defaultPrice, durationMinutes],
  ] of serviceSeeds.entries()) {
    const categoryId = categories.get(categoryName)!;
    const service = await prisma.catalogService.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code } },
      create: {
        tenantId: tenant.id,
        categoryId,
        name,
        normalizedName: normalized(name),
        code,
        defaultPrice,
        durationMinutes,
        sortOrder,
      },
      update: {
        categoryId,
        name,
        normalizedName: normalized(name),
        defaultPrice,
        durationMinutes,
        sortOrder,
        isActive: true,
        deletedAt: null,
      },
    });
    services.set(name, service.id);
  }
  await prisma.branchService.upsert({
    where: {
      branchId_catalogServiceId: {
        branchId: northBranch.id,
        catalogServiceId: services.get('Bridal Makeup')!,
      },
    },
    create: {
      tenantId: tenant.id,
      branchId: northBranch.id,
      catalogServiceId: services.get('Bridal Makeup')!,
      isAvailable: false,
    },
    update: { isAvailable: false, priceOverride: null },
  });
  await prisma.branchService.upsert({
    where: {
      branchId_catalogServiceId: {
        branchId: mainBranch.id,
        catalogServiceId: services.get('Haircut')!,
      },
    },
    create: {
      tenantId: tenant.id,
      branchId: mainBranch.id,
      catalogServiceId: services.get('Haircut')!,
      isAvailable: true,
      priceOverride: '1750.00',
    },
    update: { isAvailable: true, priceOverride: '1750.00' },
  });
  const providerSeeds = [
    [
      (process.env.SEED_PROVIDER_EMAIL ?? 'provider@example.com').toLowerCase(),
      'Sam Stylist',
      ['Haircut', 'Hair Styling', 'Hair Coloring'],
    ],
    ['provider-two@example.com', 'Maya Artist', ['Bridal Makeup', 'Party Makeup', 'Facial']],
  ] as const;
  for (const [email, displayName, qualificationNames] of providerSeeds) {
    const membership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: tenant.id, user: { email } },
    });
    const profile = await prisma.serviceProviderProfile.upsert({
      where: { membershipId: membership.id },
      create: {
        tenantId: tenant.id,
        membershipId: membership.id,
        displayName,
        normalizedName: normalized(displayName),
        jobTitle: 'Service Provider',
      },
      update: {
        displayName,
        normalizedName: normalized(displayName),
        jobTitle: 'Service Provider',
        isActive: true,
        deletedAt: null,
      },
    });
    for (const name of qualificationNames) {
      const catalogServiceId = services.get(name)!;
      await prisma.providerService.upsert({
        where: {
          providerProfileId_catalogServiceId: { providerProfileId: profile.id, catalogServiceId },
        },
        create: { tenantId: tenant.id, providerProfileId: profile.id, catalogServiceId },
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
