# Windows integration: Open with, Play with MAKAN, taskbar buttons, sleep timer

## Open files from Explorer (any number of files)
Explorer cannot give thousands of files to a program on its command line (about 32,000 characters) and starts one
copy of the program per file for a normal "open". Windows Media Player avoids this with a *DropTarget*: Explorer
hands the whole selection to a COM object. MAKAN does the same.

Parts:
- `native/src/makan-open.c` -> `desktop/bin/makan-open.dll` (built by `node scripts/build-native-helper.js`, needs gcc like the audio helper).
  It implements `IDropTarget::Drop`, writes every selected path (UTF-8, one per line) to `%TEMP%\makan-open-<pid>-<tick>.lst`
  and starts `"<MAKAN exe>" --open-list "<list file>"`.
- `build/installer.nsh` (set in `package.json` -> `build.nsis.include`) registers, for the current user only:
  the file types mp3, flac, wav, m4a, aac, ogg, opus ("Open with" and Windows Settings -> Default apps),
  the verb "Play with MAKAN AI Music Player" for those files and for folders, the DLL as the DropTarget,
  and the path of the app (`HKCU\Software\MAKAN\MusicPlayer\ExePath`). Everything is removed on uninstall.
- `desktop/cli-args.js` `collectOpenTargets()` understands `--open-list <file>`, files, folders and .m3u/.m3u8 playlists.
  The helper's own list file is deleted after it is read (only files named `makan-open-<digits>-<digits>.lst`).
- `media/components/app-shell.js` `MakanAppShell.pickOpened()`: when several files, a folder or a playlist are opened,
  the queue is exactly those songs (files in the order given; a folder gives every song below it); one file keeps the old
  behaviour (the library queue starting at that song).
- If MAKAN is already running, the single-instance code forwards the list to it.

Windows does not let a program make itself the default player. Once: right-click an mp3 -> Open with -> Choose another app
-> MAKAN AI Music Player -> Always. After that Enter / double-click / right-click on any selection of mp3 files plays them all.
On Windows 11 the right-click entry is under "Show more options". Portable builds have no installer, so no Explorer entries.

Tests: `tests/support/test-open-targets.js` (list/folder/playlist handling and queue picking, 3,000 files), 
`tests/support/test-open-helper.js` (installer entries and, on Windows with gcc, the DLL end to end: it builds a test
program that makes the same call Explorer makes and a stand-in app that records how it was started).
The DLL was also run once under Wine with Persian and accented file names.

Not tested here: Explorer itself (needs a real Windows desktop). Hand check: build the installer (`npm run dist:installer`),
install, select 2,000+ mp3 files, press Enter (after choosing MAKAN under Open with -> Always) and right-click a folder.

## Taskbar thumbnail buttons
`desktop/thumbar.js`: Previous / Play-Pause / Next under the taskbar preview (Windows), same messages as the media keys.
Test: `tests/support/test-thumbar.js`.

## Sleep timer
`media/components/sleep-timer.js` (pure logic, tested with a fake clock in `tests/support/test-sleep-timer.js`).
Settings -> Playback -> "Sleep timer": 15 / 30 / 45 / 60 / 90 / 120 minutes or "At the end of this song". The last 15 seconds fade out,
then the music pauses and the volume is put back.
