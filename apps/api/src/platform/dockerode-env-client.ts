import Docker from 'dockerode';
import { platform } from 'node:os';
import { createConnection, createServer } from 'node:net';

// Cached bridge port — reused across all Dockerode instances
let _bridgePort: number | null = null;

/**
 * Start a local TCP server that bridges connections to a Windows named pipe.
 *
 * Bun on Windows doesn't support HTTP-over-named-pipe: both `socketPath` in
 * `http.request()` and custom `Agent.createConnection()` are silently ignored.
 * However, `net.createConnection({ path })` works correctly for named pipes.
 *
 * This bridge listens on a random TCP port and transparently proxies each
 * connection to the Docker named pipe, letting Dockerode talk to Docker
 * Desktop through standard TCP.
 */
function ensureWindowsPipeBridge(pipePath: string): number {
  if (_bridgePort !== null) return _bridgePort;

  // Use Bun.listen when available (synchronous, returns port immediately).
  // Fall back to net.createServer for non-Bun runtimes.
  if (typeof (globalThis as any).Bun !== 'undefined') {
    const server = (globalThis as any).Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(socket: any) {
          const pipe = createConnection({ path: pipePath });
          socket.data = { pipe, pending: [] as Buffer[], ready: false };
          pipe.on('connect', () => {
            socket.data.ready = true;
            for (const chunk of socket.data.pending) pipe.write(chunk);
            socket.data.pending = [];
          });
          pipe.on('data', (chunk: Buffer) => socket.write(chunk));
          pipe.on('close', () => socket.end());
          pipe.on('error', () => socket.end());
        },
        data(socket: any, data: Buffer) {
          if (socket.data.ready) {
            socket.data.pipe.write(data);
          } else {
            socket.data.pending.push(Buffer.from(data));
          }
        },
        close(socket: any) { socket.data?.pipe?.destroy(); },
        error(socket: any) { socket.data?.pipe?.destroy(); },
      },
    });
    _bridgePort = server.port;
    console.log(`[docker-bridge] TCP→pipe bridge on port ${_bridgePort} (Bun.listen)`);
    return _bridgePort;
  }

  // Non-Bun fallback (synchronous via deasync-like busy-wait — rare path)
  let port: number | null = null;
  const server = createServer((client) => {
    const pipe = createConnection({ path: pipePath });
    client.pipe(pipe);
    pipe.pipe(client);
    client.on('error', () => pipe.destroy());
    pipe.on('error', () => client.destroy());
  });
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : null;
  });

  const deadline = Date.now() + 5000;
  while (port === null && Date.now() < deadline) {
    // Busy-wait for the server to start (only used in non-Bun runtimes on Windows)
  }
  if (port === null) throw new Error('[docker-bridge] Failed to start TCP bridge');
  _bridgePort = port;
  console.log(`[docker-bridge] TCP→pipe bridge on port ${_bridgePort} (net.createServer)`);
  return _bridgePort;
}

/**
 * Build a Dockerode client for a Unix socket or Windows named pipe.
 *
 * On Windows under Bun, `http.request({ socketPath })` silently falls back to
 * `http://localhost` because Bun doesn't support HTTP-over-named-pipe. We work
 * around this with a local TCP bridge that proxies connections to the named pipe.
 */
export function createDockerodeFromSocketPath(socketPath: string): Docker {
  const unixStyle = socketPath.startsWith('/') && !socketPath.startsWith('//');
  const windowsPipe =
    socketPath.startsWith('//./pipe/') ||
    socketPath.startsWith('\\\\.\\pipe\\') ||
    (platform() === 'win32' && socketPath.startsWith('//./'));

  if (unixStyle) {
    process.env.DOCKER_HOST = `unix://${socketPath}`;
    return new Docker({ socketPath });
  }

  let resolved: string;

  if (windowsPipe) {
    resolved = socketPath.startsWith('\\\\.\\pipe\\')
      ? '//./pipe/' + socketPath.slice('\\\\.\\pipe\\'.length).replace(/\\/g, '/')
      : socketPath;
  } else if (platform() === 'win32') {
    resolved = socketPath;
  } else {
    const normalized = socketPath.replace(/^\/+/, '/');
    process.env.DOCKER_HOST = `unix://${normalized}`;
    return new Docker({ socketPath: normalized });
  }

  // Windows: bridge TCP → named pipe, then connect Dockerode via TCP
  process.env.DOCKER_HOST = `npipe://${resolved}`;
  const bridgePort = ensureWindowsPipeBridge(resolved);
  return new Docker({ host: '127.0.0.1', port: bridgePort });
}
