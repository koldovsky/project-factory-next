import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function startFixtureServer({ port = 0 } = {}) {
  const html = await readFile(new URL('./fixture.html', import.meta.url), 'utf8');
  const state = { broken: false };
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(state.broken ? html.replace('</style>', 'h1 { font-size: 24px; color: #5c1450; }</style>') : html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { state, baseURL: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixtureServer({ port: Number(process.env.PORT ?? 4173) });
  process.stdout.write(`Visual fixture ready at ${fixture.baseURL}\n`);
}
