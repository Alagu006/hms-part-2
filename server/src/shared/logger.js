import winston from 'winston';

const { combine, timestamp, json, colorize, simple } = winston.format;

const transports = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'development'
      ? combine(colorize(), simple())
      : combine(timestamp(), json()),
  }),
];

export const logger = winston.createLogger({
  level      : process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'hms-server' },
  transports,
});
