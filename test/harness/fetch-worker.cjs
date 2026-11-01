/* The worker behind sync-fetch.mjs: makes the real request and hands the answer back. */
const { parentPort, workerData } = require('node:worker_threads');

const { port, signal } = workerData;
const flag = new Int32Array(signal);

parentPort.on('message', async (request) => {
  let answer;
  try {
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: request.redirect,
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const headers = {};
    res.headers.forEach((value, name) => {
      headers[name] = value;
    });
    answer = { status: res.status, headers, body: await res.text() };
  } catch (err) {
    answer = { error: String((err && err.cause && err.cause.code) || (err && err.message) || err) };
  }
  port.postMessage(answer);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
