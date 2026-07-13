function stamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(msg: string, ...rest: unknown[]) {
    console.log(`[${stamp()}] INFO  ${msg}`, ...rest);
  },
  warn(msg: string, ...rest: unknown[]) {
    console.warn(`[${stamp()}] WARN  ${msg}`, ...rest);
  },
  error(msg: string, ...rest: unknown[]) {
    console.error(`[${stamp()}] ERROR ${msg}`, ...rest);
  },
  debug(msg: string, ...rest: unknown[]) {
    if (process.env.DEBUG) {
      console.log(`[${stamp()}] DEBUG ${msg}`, ...rest);
    }
  },
};
