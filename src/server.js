import { createServer } from 'node:http';

import { createRequestHandler } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const host = process.env.HOST ?? '0.0.0.0';

const server = createServer(createRequestHandler());

server.listen(port, host, () => {
  console.log(`slimweb-mcp listening on ${host}:${port}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
