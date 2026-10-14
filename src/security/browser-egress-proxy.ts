import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import { createConnection, type Socket } from "node:net";
import type { Duplex } from "node:stream";

const DEFAULT_MAX_CONCURRENT_TUNNELS = 8;
const DEFAULT_TUNNEL_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TUNNEL_BYTES = 16 * 1024 * 1024;
const MAX_CONNECT_ATTEMPTS = 100;

export interface BrowserEgressProxyOptions {
  readonly approvedOrigins: readonly string[];
  readonly maxConcurrentTunnels?: number;
  readonly tunnelTimeoutMs?: number;
  readonly maxAggregateBytes?: number;
  readonly lookupAddresses?: (hostname: string) => Promise<readonly string[]>;
  readonly connectAddress?: (address: string, port: number) => Promise<Socket>;
  readonly onPrivateAddressBlocked?: () => void;
  readonly onConnectRequest?: (authority: string | undefined) => void;
}

export interface BrowserEgressProxy {
  readonly url: string;
  /** Add one exact HTTPS origin after explicit owner approval. */
  approveOrigin(origin: string): void;
  close(): Promise<void>;
}

function isWithinIpv4Range(address: string, network: string, prefixLength: number): boolean {
  const addressParts = address.split(".").map(Number);
  const networkParts = network.split(".").map(Number);
  if (addressParts.length !== 4 || networkParts.length !== 4) return false;
  const addressNumber = addressParts.reduce((result, part) => (result * 256) + part, 0);
  const networkNumber = networkParts.reduce((result, part) => (result * 256) + part, 0);
  const mask = prefixLength === 0 ? 0 : (0xffff_ffff << (32 - prefixLength)) >>> 0;
  return ((addressNumber >>> 0) & mask) === ((networkNumber >>> 0) & mask);
}

function ipv6Words(address: string): readonly number[] | undefined {
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized === undefined || normalized.length === 0 || normalized.includes(".")) return undefined;
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0]?.length ? halves[0].split(":") : [];
  const right = halves[1]?.length ? halves[1].split(":") : [];
  if (left.some((word) => !/^[0-9a-f]{1,4}$/u.test(word)) || right.some((word) => !/^[0-9a-f]{1,4}$/u.test(word))) return undefined;
  const explicitWords = [...left, ...right].map((word) => Number.parseInt(word, 16));
  const missingWords = 8 - explicitWords.length;
  if ((halves.length === 1 && missingWords !== 0) || (halves.length === 2 && missingWords < 1)) return undefined;
  return [...left.map((word) => Number.parseInt(word, 16)), ...Array.from({ length: halves.length === 2 ? missingWords : 0 }, () => 0), ...right.map((word) => Number.parseInt(word, 16))];
}

/** Accept only globally routed unicast addresses; deny special-purpose ranges conservatively. */
export function isGlobalUnicastAddress(address: string): boolean {
  if (address.includes("%")) return false;
  const version = isIP(address);
  if (version === 4) {
    const deniedRanges: readonly (readonly [string, number])[] = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !deniedRanges.some(([network, prefix]) => isWithinIpv4Range(address, network, prefix));
  }
  if (version !== 6) return false;
  const words = ipv6Words(address);
  if (words === undefined) return false;
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff) return false;
  // Global unicast is 2000::/3. Deny transition, documentation, and protocol-assignment blocks.
  const first = words[0] ?? 0;
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2001) {
    const second = words[1] ?? 0;
    // Deny 2001::/23 protocol assignments, ORCHID v1/v2, and documentation space.
    if ((second & 0xfe00) === 0 || (second & 0xfff0) === 0x0010 || second === 0x0db8 || (second & 0xfff0) === 0x0020) return false;
  }
  if (first === 0x2002 || (first === 0x3fff && ((words[1] ?? 0) & 0xf000) === 0)) return false;
  return true;
}

function normalizeApprovedOrigins(origins: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const value of origins) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("Browser proxy approval must contain valid HTTPS origins.");
    }
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.port.length > 0 || url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
      throw new TypeError("Browser proxy approval must contain HTTPS origins on port 443 only.");
    }
    normalized.add(url.origin);
  }
  if (normalized.size === 0) throw new TypeError("Browser proxy requires at least one approved HTTPS origin.");
  return normalized;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) throw new TypeError(`${name} must be a positive safe integer.`);
  return selected;
}

function defaultLookupAddresses(hostname: string): Promise<readonly string[]> {
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) return Promise.resolve([hostname]);
  return dnsLookup(hostname, { all: true, verbatim: true }).then((answers) => answers.map((answer) => answer.address));
}

function defaultConnectAddress(address: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address, port });
    const onError = (error: Error): void => {
      socket.removeListener("connect", onConnect);
      reject(error);
    };
    const onConnect = (): void => {
      socket.removeListener("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

function hostWithoutBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function writeRejection(socket: Duplex, status: number, label: string): void {
  if (socket.destroyed || socket.writableEnded) return;
  socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  onLateResult?: (value: T) => void,
): Promise<T> {
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const guardedOperation = operation.then((value) => {
    if (expired) onLateResult?.(value);
    return value;
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      onTimeout();
      reject(new Error("Browser proxy tunnel timed out."));
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([guardedOperation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function createBrowserEgressProxy(options: BrowserEgressProxyOptions): Promise<BrowserEgressProxy> {
  const approvedOrigins = normalizeApprovedOrigins(options.approvedOrigins);
  const maxConcurrentTunnels = positiveInteger(options.maxConcurrentTunnels, DEFAULT_MAX_CONCURRENT_TUNNELS, "maxConcurrentTunnels");
  const tunnelTimeoutMs = positiveInteger(options.tunnelTimeoutMs, DEFAULT_TUNNEL_TIMEOUT_MS, "tunnelTimeoutMs");
  const maxAggregateBytes = positiveInteger(options.maxAggregateBytes, DEFAULT_MAX_TUNNEL_BYTES, "maxAggregateBytes");
  const lookupAddresses = options.lookupAddresses ?? defaultLookupAddresses;
  const connectAddress = options.connectAddress ?? defaultConnectAddress;
  const tunnels = new Set<Duplex>();
  const clients = new Set<Duplex>();
  const activeTunnelClients = new Set<Duplex>();
  let pendingTunnels = 0;
  let aggregateTransferredBytes = 0;
  let connectAttempts = 0;
  let closed = false;
  let server: Server;

  server = createServer((_request, response) => {
    response.writeHead(405, { connection: "close", "content-length": "0" });
    response.end();
  });
  server.headersTimeout = tunnelTimeoutMs;
  server.requestTimeout = tunnelTimeoutMs;
  server.on("connection", (socket) => {
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
  });
  server.on("connect", (request, clientSocket, head) => {
    options.onConnectRequest?.(request.url);
    // Count every CONNECT request handled, including malformed, denied, and over-cap attempts.
    connectAttempts += 1;
    if (connectAttempts > MAX_CONNECT_ATTEMPTS) {
      writeRejection(clientSocket, 429, "Too Many Requests");
      return;
    }
    if (head.length > 0 || closed) {
      writeRejection(clientSocket, 400, "Bad Request");
      return;
    }
    if (activeTunnelClients.size + pendingTunnels >= maxConcurrentTunnels) {
      writeRejection(clientSocket, 503, "Service Unavailable");
      return;
    }
    let destination: URL;
    try {
      destination = new URL(`https://${request.url ?? ""}`);
    } catch {
      writeRejection(clientSocket, 400, "Bad Request");
      return;
    }
    if (destination.protocol !== "https:" || (destination.port.length > 0 && destination.port !== "443") || destination.username.length > 0 || destination.password.length > 0 || destination.pathname !== "/" || destination.search.length > 0 || destination.hash.length > 0 || !approvedOrigins.has(destination.origin)) {
      writeRejection(clientSocket, 403, "Forbidden");
      return;
    }
    const hostname = hostWithoutBrackets(destination.hostname);
    pendingTunnels += 1;
    const timer = setTimeout(() => {
      writeRejection(clientSocket, 504, "Gateway Timeout");
      clientSocket.destroy();
    }, tunnelTimeoutMs);
    timer.unref();
    const deadline = Date.now() + tunnelTimeoutMs;
    void (async () => {
      let upstream: Socket | undefined;
      let tunnelEstablished = false;
      try {
        const addresses = await withTimeout(
          lookupAddresses(hostname),
          Math.max(1, deadline - Date.now()),
          () => writeRejection(clientSocket, 504, "Gateway Timeout"),
        );
        if (closed || clientSocket.destroyed) return;
        if (addresses.length === 0) {
          writeRejection(clientSocket, 502, "Bad Gateway");
          return;
        }
        if (addresses.some((address) => !isGlobalUnicastAddress(address))) {
          options.onPrivateAddressBlocked?.();
          writeRejection(clientSocket, 403, "Forbidden");
          return;
        }
        const selectedAddress = addresses[0];
        if (selectedAddress === undefined) {
          writeRejection(clientSocket, 502, "Bad Gateway");
          return;
        }
        upstream = await withTimeout(
          connectAddress(selectedAddress, 443),
          Math.max(1, deadline - Date.now()),
          () => writeRejection(clientSocket, 504, "Gateway Timeout"),
          (lateSocket) => lateSocket.destroy(),
        );
        if (closed || clientSocket.destroyed) {
          upstream.destroy();
          return;
        }
        activeTunnelClients.add(clientSocket);
        tunnels.add(clientSocket);
        tunnels.add(upstream);
        const connectedSocket = upstream;
        const countBytes = (chunk: Buffer | string): void => {
          aggregateTransferredBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
          if (aggregateTransferredBytes > maxAggregateBytes) {
            for (const tunnelSocket of tunnels) tunnelSocket.destroy();
          }
        };
        clientSocket.on("data", countBytes);
        upstream.on("data", countBytes);
        const clear = (): void => {
          clearTimeout(timer);
          tunnels.delete(clientSocket);
          tunnels.delete(connectedSocket);
          activeTunnelClients.delete(clientSocket);
          if (!clientSocket.destroyed) clientSocket.destroy();
          if (!connectedSocket.destroyed) connectedSocket.destroy();
        };
        clientSocket.once("error", clear);
        upstream.once("error", clear);
        clientSocket.once("close", clear);
        upstream.once("close", clear);
        tunnelEstablished = true;
        clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: TaskForge\r\n\r\n");
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      } catch {
        if (upstream !== undefined && !upstream.destroyed) upstream.destroy();
        writeRejection(clientSocket, 502, "Bad Gateway");
      } finally {
        pendingTunnels -= 1;
        if (!tunnelEstablished) clearTimeout(timer);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Browser egress proxy failed to bind a loopback TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    approveOrigin(origin: string): void {
      const approved = normalizeApprovedOrigins([origin]);
      for (const value of approved) approvedOrigins.add(value);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const socket of clients) socket.destroy();
      for (const socket of tunnels) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
