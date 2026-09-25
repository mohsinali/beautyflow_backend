import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  TEST_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .optional(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  ACCESS_TOKEN_TTL: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m'),
  REFRESH_TOKEN_TTL: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('30d'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  TRUST_PROXY: Joi.alternatives().try(Joi.boolean(), Joi.number().integer().min(0)).default(0),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'log', 'info', 'debug', 'verbose').default('log'),
  PROVIDER_PHOTO_UPLOAD_DIR: Joi.string().trim().min(1).default('./uploads/provider-photos'),
  PROVIDER_PHOTO_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().valid(587).default(587),
  SMTP_SECURE: Joi.boolean().valid(false).default(false),
  SMTP_REQUIRE_TLS: Joi.boolean().valid(true).default(true),
  SMTP_USER: Joi.string().trim().required(),
  SMTP_PASSWORD: Joi.string().required(),
  SMTP_FROM: Joi.string().email().required(),
  MAIL_FROM_NAME: Joi.string().trim().min(1).required(),
  APP_PUBLIC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().uri().required(),
      otherwise: Joi.string().uri().default('http://localhost:3001'),
    }),
  INVITATION_EXPIRY_HOURS: Joi.number().integer().min(1).max(168).default(48),
}).unknown(true);
