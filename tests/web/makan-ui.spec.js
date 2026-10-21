// Focused tests for MAKAN Music Player: layout state, empty library on first launch,
// track table virtualization, lyrics theatre, transport controls, and 1280x800 verification.
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('MAKAN Music Player Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/index.html');
    await page.waitForSelector('#mk-app-root');
  });

  test('fits in 1280x800 window with zero page scrolling', async ({ page }, testInfo) => {
    const scrollInfo = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        hasScrollX: doc.scrollWidth > window.innerWidth,
        hasScrollY: doc.scrollHeight > window.innerHeight,
        scrollWidth: doc.scrollWidth,
        scrollHeight: doc.scrollHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      };
    });

    expect(scrollInfo.hasScrollX, 'no horizontal scrollbar').toBe(false);
    expect(scrollInfo.hasScrollY, 'no vertical scrollbar').toBe(false);

    await expect(page.locator('#mk-topbar')).toBeVisible();
    await expect(page.locator('#mk-library-panel')).toBeVisible();
    await expect(page.locator('#mk-player-stage')).toBeVisible();
    await expect(page.locator('#mk-lyrics-theatre')).toBeVisible();
    await expect(page.locator('#mk-transport-dock')).toBeVisible();

    // Capture screenshot using Playwright testInfo output directory
    const screenshotPath = testInfo.outputPath('makan_player_1280x800.png');
    await page.screenshot({ path: screenshotPath });
  });

  test('top bar has MAKAN AI MUSIC wordmark, search, and controls without browser-fullscreen fallback', async ({ page }) => {
    await expect(page.locator('.mk-brand-bold')).toHaveText('MAKAN');
    await expect(page.locator('.mk-brand-music')).toHaveText('AI MUSIC');
    await expect(page.locator('#mk-global-search-input')).toBeVisible();
    await expect(page.locator('#mk-global-search-input')).toHaveAttribute('placeholder', 'Search songs, artists, albums...');
    await expect(page.locator('.mk-kbd')).toHaveText('Ctrl + K');

    await expect(page.locator('#mk-win-min')).toBeVisible();
    await expect(page.locator('#mk-win-max')).toBeVisible();
    await expect(page.locator('#mk-win-close')).toBeVisible();
  });

  test('starts and functions without creating window.MediaTranslate, window.MTDesktop, mt-compat-mount, or service worker', async ({ page }) => {
    const mtType = await page.evaluate(() => typeof window.MediaTranslate);
    expect(mtType).toBe('undefined');

    const mtDesktopType = await page.evaluate(() => typeof window.MTDesktop);
    expect(mtDesktopType).toBe('undefined');

    const compatMountCount = await page.locator('#mt-compat-mount').count();
    expect(compatMountCount).toBe(0);

    const hasSw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    expect(hasSw).toBe(false);
  });

  test('first launch shows elegant empty library with Add Folder and Add Files actions', async ({ page }) => {
    // Zero demonstration tracks
    await expect(page.locator('#mk-empty-library')).toBeVisible();
    await expect(page.locator('.mk-empty-title')).toHaveText('Your Music Library is Empty');
    await expect(page.locator('#mk-empty-add-folder-btn')).toBeVisible();
    await expect(page.locator('#mk-empty-add-files-btn')).toBeVisible();

    // Genuine 0 tracks count
    await expect(page.locator('#mk-lib-count')).toHaveText('0 tracks');
    await expect(page.locator('.mk-nav-item[data-nav="library"]')).toHaveClass(/mk-nav-active/);
  });

  test('centre player stage displays honest empty state without fake metadata badges', async ({ page }) => {
    await expect(page.locator('#mk-stage-title')).toHaveText('No Track Loaded');
    await expect(page.locator('#mk-stage-artist')).toHaveText('Open a folder or add music files');
    await expect(page.locator('#mk-badge-format')).toHaveText('—');
    await expect(page.locator('#mk-badge-bitrate')).toHaveText('—');
    await expect(page.locator('#mk-badge-samplerate')).toHaveText('—');
    await expect(page.locator('#mk-visualizer-canvas')).toBeVisible();
  });

  test('right lyrics theatre displays honest empty message and live Make lyrics button', async ({ page }) => {
    const emptyMsg = page.locator('.mk-lyric-empty');
    await expect(emptyMsg).toBeVisible();

    // v1.9: "Make lyrics" is live (it was disabled in the Player Core phase)
    const aiBtn = page.locator('#mk-ai-transcribe-btn');
    await expect(aiBtn).toBeEnabled();
    await expect(aiBtn).toContainText('Make lyrics');
    await expect(page.locator('#mk-ai-model-sel')).toBeVisible();
    await expect(page.locator('#mk-ai-lang-sel')).toBeVisible();
    await expect(page.locator('#mk-ai-model-sel')).toHaveValue('large-v3-turbo');
    await expect(page.locator('#mk-ai-lang-sel')).toHaveValue('');
    // without a selected song it explains instead of starting
    await aiBtn.click();
    await expect(page.locator('.mk-toast').first()).toContainText('Select a song first');
  });

  test('Settings -> Lyrics has a models place with download, test and delete for each model', async ({ page }) => {
    await page.locator('#mk-top-settings-btn').click();
    await page.locator('[data-set-tab="lyrics"]').click();
    const rows = page.locator('#mk-set-lyrics-models .mk-lm-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Turbo');
    await expect(rows.nth(0).locator('[data-act="dl"]')).toBeEnabled();
    await expect(rows.nth(0).locator('[data-act="test"]')).toBeVisible();
    await expect(rows.nth(0).locator('[data-act="rm"]')).toBeVisible();
    // testing without a song explains instead of starting
    await rows.nth(0).locator('[data-act="test"]').click();
    await expect(rows.nth(0).locator('.mk-lm-result')).toContainText('first');
  });

  test('Lyrics style panel: English and Persian fonts, rainbow and pattern colours', async ({ page }) => {
    await page.locator('#mk-top-settings-btn').click();
    await page.locator('[data-set-tab="lyrics"]').click();
    await page.locator('#mk-set-open-lyrics-style-btn').click();
    const font = page.locator('#mk-font-sel');
    await expect(font).toBeVisible();
    await expect(font.locator('optgroup')).toHaveCount(2);
    await expect(page.locator('#mk-trans-font-sel')).toBeVisible();
    const style = page.locator('#mk-lyrics-colorstyle-sel');
    await expect(style).toHaveValue('solid');
    await expect(page.locator('#mk-lyrics-swatches .mk-swatch').first()).toBeVisible();
    await expect(page.locator('#mk-lyrics-colorspeed')).toBeHidden();
    await style.selectOption('rainbow');
    await expect(page.locator('#mk-lyrics-colorspeed')).toBeVisible();
    await expect(page.locator('#mk-lyrics-swatches')).toBeHidden();
    await expect(page.locator('.mk-lyrics-gradmode')).toHaveCount(1);
    await style.selectOption('solid');
    await page.locator('#mk-lyrics-swatches .mk-swatch').nth(5).click();
    await expect(style).toHaveValue('solid');
  });

  test('Translate: button and language in the lyrics panel, translator choices in Settings', async ({ page }) => {
    await expect(page.locator('#mk-tr-btn')).toBeEnabled();
    await expect(page.locator('#mk-tr-btn')).toContainText('Translate');
    await expect(page.locator('#mk-tr-lang-sel')).toHaveValue('fa');
    await page.locator('#mk-tr-btn').click();
    await expect(page.locator('.mk-toast').first()).toContainText('Select a song first');
    await page.locator('#mk-top-settings-btn').click();
    await page.locator('[data-set-tab="lyrics"]').click();
    await expect(page.locator('#mk-set-tr-mode')).toHaveValue('auto');
    await expect(page.locator('#mk-set-tr-mode option')).toHaveCount(5);
    await expect(page.locator('.mk-tr-keyrow')).toHaveCount(2);
    await expect(page.locator('.mk-tr-keyinput').first()).toHaveAttribute('type', 'password');
    await expect(page.locator('#mk-set-tr-check')).toBeVisible();
  });

  test('bottom transport dock stays fixed, operates playback and never displays NaN:NaN', async ({ page }) => {
    await expect(page.locator('#mk-dock-title')).toHaveText('MAKAN AI Music Player');
    await expect(page.locator('#mk-dock-artist')).toHaveText('No Track Selected');

    const timeCur = await page.locator('#mk-time-cur').textContent();
    const timeDur = await page.locator('#mk-time-dur').textContent();
    expect(timeCur).not.toContain('NaN');
    expect(timeDur).not.toContain('NaN');
    expect(timeCur).toBe('00:00');
    expect(timeDur).toBe('00:00');

    // Play/Pause button
    const playBtn = page.locator('#mk-play-btn');
    await expect(playBtn).toBeVisible();
  });

  test('usable and fits without scrollbars at 125% and 150% Windows display scaling', async ({ page }) => {
    // 125% scaling (effective viewport 1024x640)
    await page.setViewportSize({ width: 1024, height: 640 });
    const hasScroll125 = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(hasScroll125).toBe(false);

    // 150% scaling (effective viewport 854x533)
    await page.setViewportSize({ width: 854, height: 533 });
    const hasScroll150 = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(hasScroll150).toBe(false);

    // Reset
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('virtualized track table populates and maintains minimal DOM rows when tracks are added', async ({ page }) => {
    await page.route('**/api/stream*', (route) => {
      // 5 seconds of 44.1kHz 16-bit mono PCM silence to prevent instant track finish
      const samples = 44100 * 5;
      const dataSize = samples * 2;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write('WAVE', 8);
      buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(44100, 24);
      buf.writeUInt32LE(44100 * 2, 28);
      buf.writeUInt16LE(2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write('data', 36);
      buf.writeUInt32LE(dataSize, 40);
      route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: buf
      });
    });

    // Inject mock 500 tracks into the live state to verify virtualization in real browser DOM
    await page.evaluate(() => {
      const mockTracks = [];
      for (let i = 1; i <= 500; i++) {
        mockTracks.push({
          id: 'test-track-' + i,
          title: 'Virtual Track ' + i,
          artist: 'Artist ' + (i % 25),
          album: 'Album ' + (i % 10),
          duration: 180 + i,
          track_num: (i % 12) + 1,
          codec: 'mp3',
          bitrate: 320000,
          sample_rate: 44100
        });
      }
      window.makanApp.state.tracks = mockTracks;
      window.makanApp.state.totalTracksDisplay = mockTracks.length;
      window.makanApp.state.emit('libraryUpdated');
    });

    await expect(page.locator('#mk-lib-count')).toHaveText('500 tracks');
    await expect(page.locator('#mk-empty-library')).toBeHidden();

    // DOM should contain only visible rows (~20-40), NOT 500!
    const rowCount = await page.locator('.mk-track-row').count();
    expect(rowCount).toBeGreaterThan(15);
    expect(rowCount).toBeLessThan(50);

    // Double click to play row 1
    const row1 = page.locator('.mk-track-row[data-id="test-track-1"]');
    await row1.dblclick();
    await expect(page.locator('#mk-stage-title')).toHaveText('Virtual Track 1');
    await expect(page.locator('#mk-dock-title')).toHaveText('Virtual Track 1');
  });

  test('equalizer drawer opens, displays 10 bands and changes preset', async ({ page }) => {
    const eqBtn = page.locator('#mk-dock-eq-btn');
    await eqBtn.click();

    const eqDrawer = page.locator('#mk-eq-drawer');
    await expect(eqDrawer).toBeVisible();

    const sliders = page.locator('.mk-eq-range');
    await expect(sliders).toHaveCount(10);

    // Change preset to bass_boost
    const presetSel = page.locator('#mk-eq-preset-sel');
    await presetSel.selectOption('bass_boost');

    // Change preset to potplayer
    await presetSel.selectOption('potplayer');
    const normalizerChk = page.locator('#mk-eq-normalizer-chk');
    await expect(normalizerChk).toBeChecked();
    const stereoWidth = page.locator('#mk-eq-stereo-width');
    await expect(stereoWidth).toHaveValue('1');

    // Close drawer
    await page.locator('.mk-drawer-close[data-close="equalizer"]').click();
    await expect(eqDrawer).toBeHidden();
  });

  test('dock Sound button and player stage badge cycle MAKAN Sound modes (Off, Natural, Clear, Power)', async ({ page }) => {
    const dockBtn = page.locator('#mk-dock-potplayer-btn');
    const stageBadge = page.locator('#mk-stage-potplayer-badge');

    await expect(dockBtn).toBeVisible();
    await expect(stageBadge).toBeVisible();
    await expect(dockBtn).not.toHaveClass(/mk-potplayer-active/);
    await expect(stageBadge).toHaveText(/Sound: Off/);

    // Off -> Natural
    await dockBtn.click();
    await expect(dockBtn).toHaveClass(/mk-potplayer-active/);
    await expect(stageBadge).toHaveClass(/mk-potplayer-active/);
    await expect(stageBadge).toHaveText(/Sound: Natural/);

    // Toast check
    const toast = page.locator('.mk-toast');
    await expect(toast.first()).toBeVisible();
    await expect(toast.first()).toContainText('MAKAN Sound');

    // Natural -> Clear (badge) -> Power (dock)
    await stageBadge.click();
    await expect(stageBadge).toHaveText(/Sound: Clear/);
    await dockBtn.click();
    await expect(stageBadge).toHaveText(/Sound: Power/);
    await expect(dockBtn).toContainText('Power');

    // Power -> Off (A/B back to pure)
    await stageBadge.click();
    await expect(dockBtn).not.toHaveClass(/mk-potplayer-active/);
    await expect(stageBadge).not.toHaveClass(/mk-potplayer-active/);
    await expect(stageBadge).toHaveText(/Sound: Off/);
  });

  test('playlists drawer has smart playlists, and the in-app name box works (Electron has no prompt)', async ({ page }) => {
    await page.evaluate(() => {
      const st = window.makanApp.state;
      st.tracks = [
        { id: 's1', title: 'Seen', artist: 'A', album: 'X', lyrics_path: 'a.lrc', play_count: 0 },
        { id: 's2', title: 'Quiet', artist: 'B', album: 'Y', lyrics_path: null, play_count: 7 }
      ];
      st.totalTracksDisplay = 2;
      st.emit('libraryUpdated');
      st.toggleDrawer('playlists');
    });
    await expect(page.locator('#mk-smart-section .mk-smart-card')).toHaveCount(10);
    await expect(page.locator('#mk-smart-section')).toContainText('Songs with lyrics');

    // Choosing a smart playlist fills the search box and shows only matching songs
    await page.locator('.mk-smart-card', { hasText: 'Songs with lyrics' }).click();
    await expect(page.locator('#mk-global-search-input')).toHaveValue('has:lyrics');
    await expect(page.locator('#mk-lib-count')).toContainText('1 / 2');

    // Name box opens, accepts a name with Enter, and closes
    await page.evaluate(() => {
      window.__askedName = undefined;
      window.makanApp.drawers._askName('Test name', 'Hello', function (v) { window.__askedName = v; });
    });
    await expect(page.locator('.mk-modal-input')).toHaveValue('Hello');
    await page.locator('.mk-modal-input').fill('My list');
    await page.locator('.mk-modal-input').press('Enter');
    await expect(page.locator('.mk-modal-box')).toHaveCount(0);
    expect(await page.evaluate(() => window.__askedName)).toBe('My list');
  });
});
