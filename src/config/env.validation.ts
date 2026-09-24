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
}).unknown(true);
