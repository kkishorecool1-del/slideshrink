'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');

const BACKEND_PORT = 8000;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
let mainWindow = null;
let backendProcess = null;

function getPythonCommand() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  console.log('[SlideShrink] Starting FastAPI backend from:', backendDir);

  backendProcess = spawn(getPythonCommand(), [
    '-m', 'uvicorn', 'app.main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
  ], {
    cwd: backendDir,
    stdio: 'ignore',
    windowsHide: true,
  });

  backendProcess.unref();

  backendProcess.on('error', (err) => {
    console.error('[SlideShrink] Failed to start backend:', err.message);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[SlideShrink] Backend exited (code=${code}, signal=${signal})`);
    backendProcess = null;
  });
}

function waitForBackend(attempts = 60, delayMs = 500) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get(`${BACKEND_URL}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('[SlideShrink] Backend is healthy.');
          return resolve();
        }
        res.resume();
        onFail(left);
      });
      req.on('error', () => onFail(left));
      req.setTimeout(1000, () => { req.destroy(); onFail(left); });
    };

    const onFail = (left) => {
      if (left <= 0) {
        return reject(new Error('Backend did not become healthy in time.'));
      }
      setTimeout(() => attempt(left - 1), delayMs);
    };

    attempt(attempts);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 850,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'SlideShrink — PowerPoint Compressor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const isDev = process.env.ELECTRON_DEV === '1';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`${BACKEND_URL}/`);
  }
}

app.whenReady().then(async () => {
  startBackend();
  await waitForBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${backendProcess.pid} /T`, { stdio: 'ignore' });
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (e) {
      /* best effort */
    }
  }
});
