import http from 'node:http';
import puppeteer from 'puppeteer-core';

const mode = process.argv[2] || 'host';
const callsign = process.argv[3] || 'Pilot-Alpha';
const targetUrl = process.argv[4] || 'http://localhost:30300';
const agentPort = Number(process.argv[5] || 9001);

console.log(`[Agent ${callsign}] Starting in mode: ${mode}, target: ${targetUrl}, port: ${agentPort}`);

let browser = null;
let page = null;
let agentReady = false;

// Start RPC HTTP server immediately
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${agentPort}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, callsign, mode, agentReady }));
    return;
  }

  if (url.pathname === '/state') {
    if (!page) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ inLobby: true, p2pStatus: 'INITIALIZING' }));
      return;
    }
    try {
      const state = await page.evaluate(() => {
        return window.__getGameState ? window.__getGameState() : { inLobby: true, p2pStatus: 'STARTING' };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/webrtc') {
    if (!page) {
      res.writeHead(500);
      res.end('Page not ready');
      return;
    }
    try {
      const info = await page.evaluate(() => {
        const client = window.__p2pClient ? window.__p2pClient() : null;
        const host = window.__p2pHost ? window.__p2pHost() : null;
        if (client) {
          return {
            type: 'client',
            isConnected: client.isConnected,
            connState: client.pc?.connectionState,
            iceConnState: client.pc?.iceConnectionState,
            iceGatheringState: client.pc?.iceGatheringState,
            sigState: client.pc?.signalingState,
            dcReadyState: client.dc?.readyState,
            localDesc: client.pc?.localDescription?.type,
            remoteDesc: client.pc?.remoteDescription?.type
          };
        }
        if (host) {
          const peers = [];
          for (const [id, peer] of host.peers) {
            peers.push({
              id,
              connState: peer.pc?.connectionState,
              iceConnState: peer.pc?.iceConnectionState,
              iceGatheringState: peer.pc?.iceGatheringState,
              dcReadyState: peer.dc?.readyState,
              localDesc: peer.pc?.localDescription?.type,
              remoteDesc: peer.pc?.remoteDescription?.type
            });
          }
          return { type: 'host', peersCount: host.peers.size, peers };
        }
        return { none: true };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(info));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/move') {
    if (!page) {
      res.writeHead(500);
      res.end('Page not ready');
      return;
    }
    try {
      const duration = Number(url.searchParams.get('duration') || 1500);
      console.log(`[${callsign}] Moving forward (W key) for ${duration}ms...`);
      await page.keyboard.down('KeyW');
      await new Promise(r => setTimeout(r, duration));
      await page.keyboard.up('KeyW');
      await new Promise(r => setTimeout(r, 200));

      const state = await page.evaluate(() => window.__getGameState());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ moved: true, state }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/screenshot') {
    if (!page) {
      res.writeHead(500);
      res.end('Page not ready');
      return;
    }
    try {
      const buf = await page.screenshot({ type: 'png' });
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(buf);
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
    return;
  }

  if (url.pathname === '/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(consoleLogs, null, 2));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const consoleLogs = [];

server.listen(agentPort, '0.0.0.0', () => {
  console.log(`[Agent ${callsign}] RPC listening on 0.0.0.0:${agentPort}`);
});

async function run() {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      req.abort();
    } else {
      req.continue();
    }
  });

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
    if (!text.includes('[AudioContext]') && !text.includes('favicon') && !text.includes('GL Driver Message')) {
      console.log(`[${callsign} Browser] ${text}`);
    }
  });
  page.on('pageerror', err => {
    consoleLogs.push(`[PAGEERROR] ${err.message}`);
    console.error(`[${callsign} Browser Error] ${err.message}`);
  });

  console.log(`[${callsign}] Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__getGameState === 'function', { timeout: 30000 });

  // Set pilot callsign
  await page.evaluate((name) => {
    if (window.__setCallsign) {
      window.__setCallsign(name);
    }
  }, callsign);

  if (mode === 'host') {
    console.log(`[${callsign}] Initiating Nostr Room Host...`);
    await page.evaluate(async () => {
      await window.__createNostrRoom();
    });

    await page.waitForFunction(() => {
      const state = window.__getGameState ? window.__getGameState() : null;
      return state && state.p2pStatus === 'HOSTING';
    }, { timeout: 35000 });
    agentReady = true;
    console.log(`[${callsign}] Hosting started successfully!`);
  } else {
    console.log(`[${callsign}] Waiting for Nostr room discovery...`);
    await page.waitForFunction(() => {
      const state = window.__getGameState ? window.__getGameState() : null;
      return state && state.nostrRooms && state.nostrRooms.length > 0;
    }, { timeout: 35000 });

    const rooms = await page.evaluate(() => window.__getGameState().nostrRooms);
    console.log(`[${callsign}] Discovered ${rooms.length} room(s) via Nostr:`, rooms[0].name, 'pubkey:', rooms[0].pubkey);

    console.log(`[${callsign}] Joining Nostr room ${rooms[0].id}...`);
    await page.evaluate(async (room) => {
      await window.__joinNostrRoom(room);
    }, rooms[0]);

    console.log(`[${callsign}] Waiting for P2P connection to Host...`);
    await page.waitForFunction(() => {
      const state = window.__getGameState ? window.__getGameState() : null;
      return state && state.p2pStatus === 'P2P LINKED';
    }, { timeout: 35000 });
    agentReady = true;
    console.log(`[${callsign}] P2P LINKED successfully!`);
  }
}

run().catch(err => {
  console.error(`[Agent ${callsign} Fatal Error]`, err);
  process.exit(1);
});
