#!/usr/bin/env node
'use strict';
/*
 * One-shot data copy: Ghost SQLite -> MySQL (schema must already exist in MySQL,
 * built by `knex-migrator init`). Run ON the Ghost machine (it has the sqlite3 +
 * mysql2 modules, the ghost.db file, and private-network access to MySQL).
 *
 *   MYSQL_PASSWORD=... node scripts/sqlite-to-mysql.cjs
 *
 * Env: MYSQL_HOST (default blogwai-mysql.internal), MYSQL_PORT (3306),
 *      MYSQL_USER (ghost), MYSQL_PASSWORD, MYSQL_DATABASE (ghost_prod),
 *      SQLITE_PATH (/var/lib/ghost/content/data/ghost.db)
 *
 * Idempotent: truncates every MySQL table, then loads all SQLite rows. Safe to
 * re-run (we re-run at cutover for the freshest data). Only SELECTs SQLite;
 * never writes to ghost.db.
 */
const sqlite3 = require('sqlite3');
const mysql = require('mysql2/promise');

const SQLITE_PATH = process.env.SQLITE_PATH || '/var/lib/ghost/content/data/ghost.db';
const cfg = {
  host: process.env.MYSQL_HOST || 'blogwai-mysql.internal',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'ghost',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'ghost_prod',
  charset: 'utf8mb4',
};
const BATCH = 200;

// SQLite stores datetimes as epoch-ms numbers OR strings; MySQL DATETIME wants
// 'YYYY-MM-DD HH:MM:SS' in UTC. (This conversion is also what unbreaks analytics.)
function toMysqlDate(v) {
  if (v == null) return null;
  let d;
  if (typeof v === 'number') {
    d = new Date(v);
  } else {
    const s = String(v).trim();
    if (/^\d+$/.test(s)) d = new Date(Number(s));
    else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) d = new Date(s.replace(' ', 'T').replace(/Z?$/, 'Z'));
    else d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

(async () => {
  const sdb = new sqlite3.Database(SQLITE_PATH); // read-write handle, SELECT-only usage
  const sall = (sql) => new Promise((res, rej) => sdb.all(sql, (e, r) => (e ? rej(e) : res(r))));

  const conn = await mysql.createConnection(cfg);

  const srcTables = (await sall("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
    .map((r) => r.name);

  // MySQL table list + datetime columns, from information_schema
  const [cols] = await conn.query(
    'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA = ?',
    [cfg.database]);
  const mysqlTables = new Set();
  const dateCols = {};
  for (const r of cols) {
    const t = r.TABLE_NAME, c = r.COLUMN_NAME, dt = String(r.DATA_TYPE).toLowerCase();
    mysqlTables.add(t);
    if (dt === 'datetime' || dt === 'timestamp' || dt === 'date') (dateCols[t] = dateCols[t] || new Set()).add(c);
  }

  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  await conn.query('SET UNIQUE_CHECKS=0');

  for (const t of mysqlTables) await conn.query('TRUNCATE TABLE `' + t + '`');

  const summary = [];
  let grandTotal = 0;
  for (const t of srcTables) {
    if (!mysqlTables.has(t)) { summary.push(`${t}: SKIP (no MySQL table)`); continue; }
    const rows = await sall('SELECT * FROM "' + t + '"');
    if (rows.length === 0) { summary.push(`${t}: 0`); continue; }
    const colNames = Object.keys(rows[0]);
    const dc = dateCols[t] || new Set();
    const colSql = colNames.map((c) => '`' + c + '`').join(',');
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(' + colNames.map(() => '?').join(',') + ')').join(',');
      const values = [];
      for (const row of chunk) {
        for (const c of colNames) {
          let v = row[c];
          if (dc.has(c)) v = toMysqlDate(v);
          values.push(v === undefined ? null : v);
        }
      }
      await conn.query('INSERT INTO `' + t + '` (' + colSql + ') VALUES ' + placeholders, values);
    }
    grandTotal += rows.length;
    summary.push(`${t}: ${rows.length}`);
  }

  await conn.query('SET UNIQUE_CHECKS=1');
  await conn.query('SET FOREIGN_KEY_CHECKS=1');

  console.log('=== copy complete (' + grandTotal + ' rows across ' + summary.length + ' tables) ===');
  console.log(summary.sort().join('\n'));
  await conn.end();
  sdb.close();
})().catch((e) => { console.error('COPY FAILED:', e.stack || e.message); process.exit(1); });
