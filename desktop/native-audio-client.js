'use strict';
/*
 * desktop/native-audio-client.js
 * Manages the out-of-process makan-audio-helper.exe instance.
 * Handles newline-delimited JSON IPC over stdin/stdout.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

class NativeAudioClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.app = options.app || null;
    this.process = null;
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
    this.isReady = false;
    this.audioPath = null;
    this.lastError = null;
    this.lineBuffer = '';
  }

  getHelperPath() {
    if (this.app && this.app.isPackaged) {
      return path.join(process.resourcesPath, 'app.asar.unpacked', 'desktop', 'bin', 'makan-audio-helper.exe');
    }
    return path.join(__dirname, 'bin', 'makan-audio-helper.exe');
  }

  isSupported() {
    return process.platform === 'win32' && fs.existsSync(this.getHelperPath());
  }

  start() {
    if (this.process) {
      return Promise.resolve(true);
    }

    const helperPath = this.getHelperPath();
    if (!fs.existsSync(helperPath)) {
      const err = new Error(`Native audio helper not found at: ${helperPath}`);
      this.lastError = err;
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      try {
        this.process = spawn(helperPath, [], {
          stdio: ['pipe', 'pipe', 'inherit'],
          windowsHide: true
        });

        this.process.stdout.on('data', (chunk) => {
          this.handleStdoutData(chunk);
        });

        this.process.on('error', (err) => {
          this.lastError = err;
          this.emit('error', { event: 'error', fatal: true, message: err.message, code: 'SPAWN_ERROR' });
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });

        this.process.on('exit', (code, signal) => {
          this.isReady = false;
          this.process = null;
          // Reject all pending requests
          for (const [id, req] of this.pendingRequests.entries()) {
            req.reject(new Error(`Helper exited with code ${code} (${signal})`));
            this.pendingRequests.delete(id);
          }
          this.emit('exit', { code, signal });
        });

        // Wait for 'ready' event
        const onReady = (evt) => {
          if (evt.event === 'ready') {
            this.isReady = true;
            if (!resolved) {
              resolved = true;
              this.removeListener('event', onReady);
              resolve(true);
            }
          }
        };
        this.on('event', onReady);

        // Timeout guard (5 seconds)
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.removeListener('event', onReady);
            reject(new Error('Timed out waiting for native audio helper ready signal'));
          }
        }, 5000);

      } catch (err) {
        this.lastError = err;
        reject(err);
      }
    });
  }

  handleStdoutData(chunk) {
    this.lineBuffer += chunk.toString('utf8');
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && msg.id !== null) {
          const req = this.pendingRequests.get(msg.id);
          if (req) {
            this.pendingRequests.delete(msg.id);
            if (msg.success) {
              req.resolve(msg.data);
            } else {
              req.reject(new Error(msg.error || 'Native helper command failed'));
            }
          }
        } else if (msg.event) {
          if (msg.event === 'audioPathChanged') {
            this.audioPath = msg.audioPath || msg;
          }
          this.emit('event', msg);
        }
      } catch (err) {
        // Ignored unparseable line
      }
    }
  }

  sendCommand(command, payload = {}) {
    if (!this.process) {
      return Promise.reject(new Error('Native audio helper is not running'));
    }

    if (command === 'setVolume') {
      const vol = payload && payload.volume;
      if (typeof vol !== 'number' || Number.isNaN(vol) || vol < 0.0 || vol > 1.0) {
        return Promise.reject(new Error('Volume must be a normalized float between 0.0 and 1.0'));
      }
    }

    const id = this.nextRequestId++;
    const message = Object.assign({ id, command }, payload);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Command '${command}' timed out after 5000ms`));
        }
      }, 5000);

      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      try {
        this.process.stdin.write(JSON.stringify(message) + '\n');
      } catch (err) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  stop() {
    if (!this.process) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const p = this.process;
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(killTimer);
          this.process = null;
          resolve();
        }
      };

      p.once('exit', done);

      const killTimer = setTimeout(() => {
        try {
          // On Windows, forceful abnormal termination invokes the Win32 TerminateProcess() API
          p.kill();
        } catch (e) {}
        done();
      }, 1500);

      this.sendCommand('shutdown').catch(() => {}).finally(() => {
        try {
          p.stdin.end();
        } catch (e) {}
      });
    });
  }
}

module.exports = { NativeAudioClient };
