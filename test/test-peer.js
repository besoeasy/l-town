import puppeteer from 'puppeteer-core';

async function test() {
  const browser = await puppeteer.launch({
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

  const targetUrl = process.argv[2] || 'http://l-town:30300';
  const page1 = await browser.newPage();
  const page2 = await browser.newPage();

  for (const p of [page1, page2]) {
    await p.setRequestInterception(true);
    p.on('request', req => {
      if (req.url().includes('fonts.google')) req.abort();
      else req.continue();
    });
  }

  page1.on('console', msg => console.log('[Host Browser]', msg.type(), msg.text()));
  page1.on('pageerror', err => console.error('[Host PageError]', err));

  page2.on('console', msg => console.log('[Client Browser]', msg.type(), msg.text()));
  page2.on('pageerror', err => console.error('[Client PageError]', err));

  console.log(`1. Loading Host on ${targetUrl}...`);
  await page1.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page1.waitForFunction(() => typeof window.__createPeerRoom === 'function', { timeout: 15000 });

  console.log('2. Host creating peer room...');
  await page1.evaluate(() => {
    window.__createPeerRoom();
  });

  // Wait for roomCode to be generated
  await page1.waitForFunction(() => {
    const s = window.__getGameState ? window.__getGameState() : null;
    return s && s.roomCode;
  }, { timeout: 15000 });

  const state1 = await page1.evaluate(() => window.__getGameState());
  const roomCode = state1.roomCode;
  console.log('-> Host Room Code is:', roomCode);

  console.log(`3. Loading Client on ${targetUrl}/#room=${roomCode}...`);
  await page2.goto(`${targetUrl}/#room=${roomCode}`, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => typeof window.__joinPeerRoom === 'function', { timeout: 15000 });

  console.log('4. Client joining room', roomCode, '...');
  await page2.evaluate((code) => {
    window.__joinPeerRoom(code);
  }, roomCode);

  // Wait 10 seconds and inspect state on both sides
  for (let i = 1; i <= 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s1 = await page1.evaluate(() => window.__getGameState());
    const s2 = await page2.evaluate(() => window.__getGameState());
    console.log(`[Tick ${i}s] Host peers: ${s1?.playersCount}, Client peers: ${s2?.playersCount}, Host link: ${s1?.p2pStatus}, Client link: ${s2?.p2pStatus}`);
    if (s1?.playersCount > 1 && s2?.playersCount > 1) {
      console.log('SUCCESS: Mutual player presence detected!');
      break;
    }
  }

  // Let frames render for 3 seconds
  await new Promise(r => setTimeout(r, 3000));

  await page1.bringToFront();
  await new Promise(r => setTimeout(r, 1500));
  const finalHost = await page1.evaluate(() => window.__getGameState());
  await page1.screenshot({ path: '/app/test/host-view.png' });
  console.log('Saved /app/test/host-view.png');

  await page2.bringToFront();
  await new Promise(r => setTimeout(r, 1500));
  const finalClient = await page2.evaluate(() => window.__getGameState());
  await page2.screenshot({ path: '/app/test/client-view.png' });
  console.log('Saved /app/test/client-view.png');

  console.log('Final Host State:', JSON.stringify(finalHost, null, 2));
  console.log('Final Client State:', JSON.stringify(finalClient, null, 2));

  // Compute distance between Host and Client from Host's perspective
  const hostPlayer = finalHost.localPlayer;
  const remoteOnHost = finalHost.remotePlayers?.[0];
  if (hostPlayer && remoteOnHost) {
    const distOnHost = Math.hypot(hostPlayer.x - remoteOnHost.x, hostPlayer.z - remoteOnHost.z);
    console.log(`\n=== VERIFICATION RESULTS ===`);
    console.log(`Host Position: (${hostPlayer.x}, ${hostPlayer.y}, ${hostPlayer.z})`);
    console.log(`Client Position (on Host): (${remoteOnHost.x}, ${remoteOnHost.y}, ${remoteOnHost.z})`);
    console.log(`Distance Between Host and Client: ${distOnHost.toFixed(2)} meters`);
    console.log(`Host Remote Meshes in 3D Scene: ${finalHost.remoteMeshesCount}`);
    console.log(`Client Remote Meshes in 3D Scene: ${finalClient.remoteMeshesCount}`);
    
    if (distOnHost > 50) {
      throw new Error(`Distance too large: ${distOnHost}m! Players are not in arena view!`);
    }
    if (finalHost.remoteMeshesCount < 1) {
      throw new Error(`Host has 0 remote meshes in 3D scene!`);
    }
    console.log(`ALL CHECKS PASSED: Host clearly sees Client at ${distOnHost.toFixed(2)}m!`);
  } else {
    throw new Error('Could not find remote player on host!');
  }

  await browser.close();
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
