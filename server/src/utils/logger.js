function timestamp() {
  return new Date().toISOString();
}

function format(level, message, meta) {
  const base = `[${timestamp()}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

export const logger = {
  info(message, meta) {
    console.log(format('INFO', message, meta));
  },
  warn(message, meta) {
    console.warn(format('WARN', message, meta));
  },
  error(message, meta) {
    console.error(format('ERROR', message, meta));
  },
  debug(message, meta) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(format('DEBUG', message, meta));
    }
  },
};
