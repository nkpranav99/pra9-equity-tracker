import pino from 'pino';
import config from '../config.js';

const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
  level: config.log.level,
  ...(!isProd && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
