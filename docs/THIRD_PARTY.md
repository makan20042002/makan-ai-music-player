# THIRD PARTY NOTICES & OPEN-SOURCE LICENSES

MAKAN Music Player incorporates open-source libraries, decoders, and audio frameworks.

---

## 1. Native Pure Audio Engine Components (v1.8.0 / v1.8.1)

### FFmpeg (libavcodec, libavformat, libavutil, libswresample)
- **Version:** FFmpeg 9.0.2 / git-2026-04-18
- **License:** GNU Lesser General Public License (LGPL) v2.1 or later
- **Website:** https://ffmpeg.org
- **Usage & Compliance Notice:**
  MAKAN dynamically links to unmodified shared libraries (`avcodec-63.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll`).
  Under the terms of the LGPL v2.1, users are permitted to inspect, reverse engineer for debugging modifications, or replace these shared library binaries with compatible alternative builds of FFmpeg.
  Complete source code for FFmpeg is available at https://ffmpeg.org/download.html.

```
GNU LESSER GENERAL PUBLIC LICENSE
Version 2.1, February 1999

Copyright (C) 1991, 1999 Free Software Foundation, Inc.
51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
Everyone is permitted to copy and distribute verbatim copies
of this license document, but changing it is not allowed.
```

---

### miniaudio
- **Author:** David Reid
- **Version:** 0.11.21
- **License:** MIT-0 or Public Domain (Dual-Licensed)
- **Website:** https://github.com/mackron/miniaudio

```
Choice of Public Domain (www.unlicense.org) or MIT-0 (No Attribution)

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

### cJSON
- **Author:** Dave Gamble and cJSON contributors
- **Version:** 1.7.18
- **License:** MIT License
- **Website:** https://github.com/DaveGamble/cJSON

```
Copyright (c) 2009-2017 Dave Gamble and cJSON contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 2. Desktop & Application Runtime Dependencies

### music-metadata
- **License:** MIT
- **Purpose:** Audio tag parsing, album artwork extraction, and duration probing.

### sql.js
- **License:** MIT
- **Purpose:** In-memory and persistent SQLite WebAssembly engine.

### Electron
- **License:** MIT
- **Purpose:** Cross-platform desktop runtime framework.

### Node.js
- **License:** MIT
- **Purpose:** JavaScript runtime engine.

### @playwright/test
- **License:** Apache-2.0
- **Purpose:** Automated browser, UI, and integration testing harness.
