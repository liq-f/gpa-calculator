'use strict';
/*
 * 测试公共库：定位本机浏览器 + 一个极简的 Chrome DevTools Protocol 客户端。
 * 只依赖 Node 内置模块，不需要 npm install。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const TMP = path.join(__dirname, '.tmp');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 找本机可用的 Chromium 内核浏览器 */
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 继续找 */ }
  }
  return null;
}

/* 极简 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        const c = new CDP(ws);
        ws.onmessage = ev => {
          const msg = JSON.parse(ev.data);
          if (msg.id && c.pending.has(msg.id)) {
            const { res, rej } = c.pending.get(msg.id);
            c.pending.delete(msg.id);
            msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
          }
        };
        resolve(c);
      };
      ws.onerror = () => reject(new Error('无法连接浏览器的调试端口'));
    });
  }
  send(method, params, timeoutMs) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { res: resolve, rej: reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 调用超时: ' + method)); }
      }, timeoutMs || 120000);
    });
  }
  async eval(expression, timeoutMs) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true
    }, timeoutMs);
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception;
      throw new Error('页面脚本报错: ' + ((ex && (ex.description || ex.value)) || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* 忽略 */ } }
}

async function waitForDevTools(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('浏览器调试端口未就绪');
}

/*
 * 打开一个页面并返回 CDP 连接。
 * 用法：const page = await openPage(filePath); ... page.cdp.eval(...); page.close();
 */
async function openPage(filePath, options) {
  const opts = options || {};
  const exe = opts.executable || findBrowser();
  if (!exe) throw new Error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指向浏览器可执行文件');

  fs.mkdirSync(TMP, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = path.join(TMP, 'profile-' + process.pid + '-' + port);
  fs.rmSync(profile, { recursive: true, force: true });

  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  const url = /^https?:|^file:/.test(filePath) ? filePath : pathToFileURL(filePath).href;
  let cdp = null;
  try {
    await waitForDevTools(port);
    const res = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    const target = await res.json();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await sleep(opts.settleMs || 800);
  } catch (err) {
    try { child.kill(); } catch (e) { /* 忽略 */ }
    throw err;
  }

  return {
    cdp,
    browser: exe,
    async waitForText(selector, timeoutMs) {
      const deadline = Date.now() + (timeoutMs || 60000);
      while (Date.now() < deadline) {
        const v = await cdp.eval('(function(){var e=document.querySelector(' + JSON.stringify(selector) + ');return e?e.textContent:null;})()');
        if (v) return v;
        await sleep(300);
      }
      throw new Error('等待元素超时: ' + selector);
    },
    close() {
      try { cdp && cdp.close(); } catch (e) { /* 忽略 */ }
      try { child.kill(); } catch (e) { /* 忽略 */ }
      setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows 上可能被占用，忽略 */ } }, 600);
    }
  };
}

module.exports = { ROOT, APP, TMP, sleep, findBrowser, openPage, CDP };
