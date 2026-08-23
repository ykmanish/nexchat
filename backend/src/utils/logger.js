const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

const stamp = () => new Date().toISOString().slice(11, 23);
const line = (color, tag, msg) =>
  console.log(`${c.dim}${stamp()}${c.reset} ${color}${tag}${c.reset} ${msg}`);

export const logger = {
  info: (m) => line(c.cyan, 'info   ', m),
  success: (m) => line(c.green, 'ready  ', m),
  warn: (m) => line(c.yellow, 'warn   ', m),
  error: (m) => line(c.red, 'error  ', m),
  debug: (m) => process.env.NODE_ENV !== 'production' && line(c.magenta, 'debug  ', m),
  socket: (m) => line(c.blue, 'socket ', m),
};
