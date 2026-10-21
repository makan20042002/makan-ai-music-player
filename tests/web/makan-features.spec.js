const { test, expect } = require('@playwright/test');

test.describe('MAKAN Music Player Core Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/index.html');
    await page.waitForSelector('#mk-app-root');

    // Populate mock 100 tracks for feature testing
    await page.evaluate(() => {
      const tracks = [];
      const artists = ['Queen', 'Led Zeppelin', 'Pink Floyd', 'The Beatles', 'Miles Davis'];
      const genres = ['Rock', 'Classic Rock', 'Progressive Rock', 'Pop', 'Jazz'];
      for (let i = 1; i <= 100; i++) {
        const artist = artists[(i - 1) % artists.length];
        const genre = genres[(i - 1) % genres.length];
        const pad = String(i).padStart(3, '0');
        tracks.push({
          id: 'trk-' + pad,
          title: 'Track ' + pad + ' - ' + artist + ' Anthem',
          artist: artist,
          album: 'Album ' + Math.ceil(i / 10),
          duration: 180 + (i * 2),
          track_num: ((i - 1) % 10) + 1,
          genre: genre,
          codec: i % 2 === 0 ? 'flac' : 'mp3',
          bitrate: i % 2 === 0 ? 921000 : 320000,
          sample_rate: 44100,
          folder_path: 'C:\\Music\\' + artist
        });
      }
      window.makanApp.state.tracks = tracks;
      window.makanApp.state.totalTracksDisplay = tracks.length;
      window.makanApp.state.emit('libraryUpdated');
    });
  });

  test('Ctrl+K focuses search, Esc clears search, syntax queries filter and highlight text', async ({ page }) => {
    const searchInput = page.locator('#mk-global-search-input');

    // Press Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(searchInput).toBeFocused();

    // Type query "Queen"
    await searchInput.fill('Queen');
    // Wait for 80ms debounce
    await page.waitForTimeout(150);

    // Verify filtered count badge (Queen is 20 out of 100 tracks)
    await expect(page.locator('#mk-lib-count')).toHaveText('20 / 100 tracks');

    // Verify highlighted text exists in DOM
    const highlight = page.locator('.mk-highlight').first();
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveText(/queen/i);

    // Test syntax query: "genre:jazz" (should find 20 Jazz tracks)
    await searchInput.fill('genre:jazz');
    await page.waitForTimeout(150);
    await expect(page.locator('#mk-lib-count')).toHaveText('20 / 100 tracks');

    // Press Escape to clear
    await searchInput.press('Escape');
    await page.waitForTimeout(150);
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('#mk-lib-count')).toHaveText('100 tracks');
  });

  test('Ctrl+A selects all visible tracks, Shift-click selects range', async ({ page }) => {
    // Focus table and press Ctrl+A
    const row1 = page.locator('.mk-track-row[data-id="trk-001"]');
    await row1.click();
    await page.keyboard.press('Control+a');

    // Verify selected visual class on visible rows
    const selectedRows = page.locator('.mk-row-selected');
    const selectedCount = await selectedRows.count();
    expect(selectedCount).toBeGreaterThan(10);

    // Single click deselects others
    await row1.click();
    expect(await page.locator('.mk-row-selected').count()).toBe(1);

    // Shift click row 4 selects range 1 to 4
    const row4 = page.locator('.mk-track-row[data-id="trk-004"]');
    await row4.click({ modifiers: ['Shift'] });
    expect(await page.locator('.mk-row-selected').count()).toBe(4);
  });

  test('Context menu options: Play, Play Next, Add to Queue', async ({ page }) => {
    const row1 = page.locator('.mk-track-row[data-id="trk-001"]');
    await row1.click({ button: 'right' });

    const menu = page.locator('#mk-table-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="play"]')).toBeVisible();
    await expect(menu.locator('[data-action="play-next"]')).toBeVisible();
    await expect(menu.locator('[data-action="add-queue"]')).toBeVisible();

    // Click "Play Next"
    await menu.locator('[data-action="play-next"]').click();
    await expect(menu).toBeHidden();

    // Verify queue badge updated
    await expect(page.locator('#mk-queue-count')).toHaveText('1');
  });

  test('True shuffle toggles and updates UI state', async ({ page }) => {
    const shuffleBtn = page.locator('#mk-shuffle-btn');
    await expect(shuffleBtn).toBeVisible();

    // Initial shuffle is off
    const isShuffleActiveInitially = await page.evaluate(() => window.makanApp.state.shuffle);
    expect(isShuffleActiveInitially).toBe(false);

    // Click 1: Turn on True Shuffle
    await shuffleBtn.click();
    const modeAfter1 = await page.evaluate(() => window.makanApp.state.shuffleMode);
    const isShuffleActive1 = await page.evaluate(() => window.makanApp.state.shuffle);
    expect(modeAfter1).toBe('tracks');
    expect(isShuffleActive1).toBe(true);
    await expect(shuffleBtn).toHaveClass(/mk-active/);

    // Click 2: Cycle to Shuffle Albums
    await shuffleBtn.click();
    const modeAfter2 = await page.evaluate(() => window.makanApp.state.shuffleMode);
    const isShuffleActive2 = await page.evaluate(() => window.makanApp.state.shuffle);
    expect(modeAfter2).toBe('albums');
    expect(isShuffleActive2).toBe(true);
    await expect(shuffleBtn).toHaveClass(/mk-active/);
    await expect(shuffleBtn).toHaveClass(/mk-shuffle-albums/);

    // Click 3: Cycle to Shuffle Off
    await shuffleBtn.click();
    const modeAfter3 = await page.evaluate(() => window.makanApp.state.shuffleMode);
    const isShuffleActiveFinal = await page.evaluate(() => window.makanApp.state.shuffle);
    expect(modeAfter3).toBe('off');
    expect(isShuffleActiveFinal).toBe(false);
    await expect(shuffleBtn).not.toHaveClass(/mk-active/);
  });

  test('Queue drawer opens and displays real queued tracks', async ({ page }) => {
    // Add track to queue via evaluate
    await page.evaluate(() => {
      window.makanApp.controller.addToQueue({
        id: 'queued-1',
        title: 'Priority Queued Song',
        artist: 'Special Artist',
        duration: 240
      });
    });

    // Open queue drawer
    const queueNav = page.locator('.mk-nav-item[data-nav="queue"]');
    await queueNav.click();

    const queueDrawer = page.locator('#mk-queue-drawer');
    await expect(queueDrawer).toBeVisible();

    // Check item in queue list
    await expect(page.locator('.mk-queue-title').first()).toHaveText('Priority Queued Song');
  });
});
