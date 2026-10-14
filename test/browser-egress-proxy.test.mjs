import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import test from "node:test";
import { createBrowserEgressProxy, isGlobalUnicastAddress } from "../dist/security/browser-egress-proxy.js";

const allowedOrigin = "https://approved.example";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function openProxyClient(proxyUrl, authority = "approved.example:443") {
  const proxy = new URL(proxyUrl);
  const socket = connect(Number(proxy.port), proxy.hostname);
  return new Promise((resolve, reject) => {
    let response = "";
    const onData = (chunk) => {
      response += chunk.toString("latin1");
      const boundary = response.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      socket.removeListener("data", onData);
      const statusLine = response.slice(0, response.indexOf("\r\n"));
      resolve({ socket, status: Number(statusLine.split(" ")[1]) });
    };
    socket.once("error", reject);
    socket.on("data", onData);
    socket.once("connect", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
  });
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once("close", resolve);
    socket.destroy();
  });
}

test("global address classifier rejects local, reserved, mapped and documentation addresses", () => {
  for (const address of [
    "0.1.2.3", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.2", "172.16.0.1",
    "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:8.8.8.8", "::ffff:808:808", "fc00::1", "fe80::1", "fe80::1%eth0",
    "2001:10::1", "2001:db8::1", "2002::1", "3fff::1",
  ]) assert.equal(isGlobalUnicastAddress(address), false, address);
  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) assert.equal(isGlobalUnicastAddress(address), true, address);
});

test("proxy accepts only explicitly approved HTTPS CONNECT requests on port 443", async () => {
  let lookupCount = 0;
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    lookupAddresses: async () => { lookupCount += 1; return ["93.184.216.34"]; },
    connectAddress: async () => { throw new Error("connection should not be attempted"); },
  });
  try {
    for (const [authority, expectedStatus] of [
      ["other.example:443", 403],
      ["approved.example:444", 403],
      ["user@approved.example:443", 403],
    ]) {
      const { socket, status } = await openProxyClient(proxy.url, authority);
      assert.equal(status, expectedStatus, authority);
      await closeSocket(socket);
    }
    assert.equal(lookupCount, 0);
  } finally {
    await proxy.close();
  }
});

test("proxy caps lifetime CONNECT attempts including denied requests", async () => {
  let lookupCount = 0;
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    lookupAddresses: async () => { lookupCount += 1; return ["93.184.216.34"]; },
    connectAddress: async () => { throw new Error("no origin should be approved in this test"); },
  });
  try {
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const { socket, status } = await openProxyClient(proxy.url, "denied.example:443");
      assert.equal(status, 403, `attempt ${attempt}`);
      await closeSocket(socket);
    }
    const overflow = await openProxyClient(proxy.url, "approved.example:443");
    assert.equal(overflow.status, 429);
    assert.equal(lookupCount, 0);
    await closeSocket(overflow.socket);
  } finally {
    await proxy.close();
  }
});

test("mixed public/private DNS answers are rejected before connect", async () => {
  let connectCount = 0;
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    lookupAddresses: async () => ["93.184.216.34", "10.0.0.8"],
    connectAddress: async () => { connectCount += 1; throw new Error("private DNS answer must block all connects"); },
  });
  try {
    const { socket, status } = await openProxyClient(proxy.url);
    assert.equal(status, 403);
    assert.equal(connectCount, 0);
    await closeSocket(socket);
  } finally {
    await proxy.close();
  }
});

test("empty DNS answers fail closed without counting a private-address block", async () => {
  let privateBlockCount = 0;
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    lookupAddresses: async () => [],
    connectAddress: async () => { throw new Error("empty DNS answer must not connect"); },
    onPrivateAddressBlocked: () => { privateBlockCount += 1; },
  });
  try {
    const { socket, status } = await openProxyClient(proxy.url);
    assert.equal(status, 502);
    assert.equal(privateBlockCount, 0);
    await closeSocket(socket);
  } finally {
    await proxy.close();
  }
});

test("proxy connects to a validated numeric address and relays the tunnel", async () => {
  const echoServer = createServer((socket) => socket.on("data", (chunk) => socket.write(chunk)));
  const echoPort = await listen(echoServer);
  const connected = [];
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    lookupAddresses: async (hostname) => {
      assert.equal(hostname, "approved.example");
      return ["93.184.216.34", "2606:4700:4700::1111"];
    },
    connectAddress: async (address, port) => {
      connected.push({ address, port });
      return new Promise((resolve, reject) => {
        const socket = connect(echoPort, "127.0.0.1");
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
      });
    },
  });
  try {
    const { socket, status } = await openProxyClient(proxy.url);
    assert.equal(status, 200);
    assert.deepEqual(connected, [{ address: "93.184.216.34", port: 443 }]);
    const echoed = new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.once("data", (chunk) => resolve(chunk.toString()));
    });
    socket.write("fixture-only tunnel bytes");
    assert.equal(await echoed, "fixture-only tunnel bytes");
    await closeSocket(socket);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) => echoServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("proxy enforces one aggregate transferred-byte limit across concurrent tunnels", async () => {
  let bytesReceived = 0;
  let resolveFirstWrite;
  const firstWrite = new Promise((resolve) => { resolveFirstWrite = resolve; });
  const sinkServer = createServer((socket) => socket.on("data", (chunk) => {
    bytesReceived += chunk.length;
    if (bytesReceived >= 10) resolveFirstWrite();
  }));
  const sinkPort = await listen(sinkServer);
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    maxAggregateBytes: 20,
    lookupAddresses: async () => ["93.184.216.34"],
    connectAddress: async () => new Promise((resolve, reject) => {
      const socket = connect(sinkPort, "127.0.0.1");
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.removeListener("error", reject);
        resolve(socket);
      });
    }),
  });
  try {
    const firstTunnel = await openProxyClient(proxy.url);
    const secondTunnel = await openProxyClient(proxy.url);
    assert.equal(firstTunnel.status, 200);
    assert.equal(secondTunnel.status, 200);
    const firstClosed = new Promise((resolve) => firstTunnel.socket.once("close", resolve));
    const secondClosed = new Promise((resolve) => secondTunnel.socket.once("close", resolve));
    firstTunnel.socket.write("1234567890");
    await firstWrite;
    secondTunnel.socket.write("abcdefghijk");
    await Promise.all([firstClosed, secondClosed]);
    assert.equal(firstTunnel.socket.destroyed, true);
    assert.equal(secondTunnel.socket.destroyed, true);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) => sinkServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("proxy rejects excess concurrent tunnels and times out pending DNS", async () => {
  let resolveLookup;
  const pendingLookup = new Promise((resolve) => { resolveLookup = resolve; });
  const proxy = await createBrowserEgressProxy({
    approvedOrigins: [allowedOrigin],
    maxConcurrentTunnels: 1,
    tunnelTimeoutMs: 100,
    lookupAddresses: async () => pendingLookup,
    connectAddress: async () => { throw new Error("lookup should time out first"); },
  });
  try {
    const first = openProxyClient(proxy.url);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await openProxyClient(proxy.url);
    assert.equal(second.status, 503);
    await closeSocket(second.socket);
    const firstResult = await first;
    assert.equal(firstResult.status, 504);
    await closeSocket(firstResult.socket);
    resolveLookup(["93.184.216.34"]);
  } finally {
    await proxy.close();
  }
});

test("proxy requires canonical HTTPS origins and positive bounds", async () => {
  for (const approvedOrigins of [[], ["http://approved.example"], ["https://approved.example/path"]]) {
    await assert.rejects(createBrowserEgressProxy({ approvedOrigins }), TypeError);
  }
  await assert.rejects(createBrowserEgressProxy({ approvedOrigins: [allowedOrigin], maxAggregateBytes: 0 }), TypeError);
});
