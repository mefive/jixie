import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 3001);
startServer(port);
console.log(`API listening on http://localhost:${port}`);
