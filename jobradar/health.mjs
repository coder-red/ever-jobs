#!/usr/bin/env node
/**
 * Bot health check.
 *
 * Deliberately does NOT call getUpdates: that competes for Telegram's single
 * polling slot and can knock the running bot offline. Health is inferred from
 * the process list and the log instead.
 *
 *   node health.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const ok = (s) => `${c.g}✓${c.x} ${s}`;
const bad = (s) => `${c.r}✗${c.x} ${s}`;
const warn = (s) => `${c.y}!${c.x} ${s}`;

console.log(`${c.b}jobradar health${c.x}\n`);

// --- is a bot.mjs process alive? --------------------------------------------
let running = false;
try {
  const out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  running = /bot\.mjs/i.test(out);
} catch { /* fall through to log-based check */ }
console.log(running ? ok('bot.mjs process is running') : bad('bot.mjs is NOT running'));

// --- log freshness ----------------------------------------------------------
const logPath = resolve(HERE, 'data', 'bot.log');
if (existsSync(logPath)) {
  const age = (Date.now() - statSync(logPath).mtimeMs) / 60_000;
  const tail = readFileSync(logPath, 'utf8').trim().split('\n').slice(-3);
  console.log(`${c.d}bot.log last written ${age < 1 ? 'just now' : `${Math.round(age)}m ago`}${c.x}`);
  for (const l of tail) console.log(`${c.d}   ${l}${c.x}`);
  const conflict = tail.some((l) => /409/.test(l));
  if (conflict) console.log(warn('409 conflicts logged — another poller may be competing'));
} else {
  console.log(warn('no bot.log yet'));
}

// --- outreach pipeline ------------------------------------------------------
const outPath = resolve(HERE, 'data', 'outreach.json');
if (existsSync(outPath)) {
  const st = JSON.parse(readFileSync(outPath, 'utf8'));
  const rows = Object.values(st);
  const by = (s) => rows.filter((r) => r.status === s).length;
  console.log(`\n${c.b}outreach pipeline${c.x}`);
  console.log(`   tracked ${rows.length}  ·  ⚪ ${by('new')} waiting  ·  ✅ ${by('dmd')} DM'd  ·  ⏭ ${by('skipped')} skipped  ·  💬 ${by('replied')} replied`);
} else {
  console.log(warn('no outreach.json yet — run radar.mjs once'));
}

// --- last scan --------------------------------------------------------------
const latest = resolve(HERE, 'data', 'latest.json');
if (existsSync(latest)) {
  const d = JSON.parse(readFileSync(latest, 'utf8'));
  const age = (Date.now() - Date.parse(d.generatedAt)) / 3.6e6;
  console.log(`\n${c.b}last scan${c.x}`);
  console.log(`   ${age < 1 ? 'under an hour' : `${age.toFixed(1)}h`} ago  ·  ${d.matched} live roles  ·  ${(d.agencies ?? []).length} agencies stored`);
  if (age > 3) console.log(warn('scan is stale — is the hourly task running?'));
}

console.log(`\n${c.d}Start the bot:  wscript "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\jobradar-bot.vbs"${c.x}`);
console.log(`${c.d}Note: never call getUpdates while the bot runs — it steals the polling slot.${c.x}`);
