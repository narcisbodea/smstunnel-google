/**
 * A synchronous fetch for the tests, like UrlFetchApp.fetch in Apps Script: a worker thread makes the real request
 * while this thread waits on Atomics.wait, then reads the answer with receiveMessageOnPort.
 */
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';

export function createSyncFetch({ timeoutMs = 30000 } = {}) {
  const signal = new SharedArrayBuffer(4);
  const flag = new Int32Array(signal);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL('./fetch-worker.cjs', import.meta.url), { workerData: { port: port2, signal }, transferList: [port2] });
  worker.unref();
  return {
    /** {url, method, headers, body, redirect} → {status, headers, body} or {error}. */
    fetch(request) {
      Atomics.store(flag, 0, 0);
      worker.postMessage({ timeoutMs, redirect: 'follow', ...request });
      const waited = Atomics.wait(flag, 0, 0, timeoutMs + 5000);
      if (waited === 'timed-out') return { error: 'Timeout' };
      const message = receiveMessageOnPort(port1);
      return message ? message.message : { error: 'No answer from the fetch worker' };
    },
    close() {
      port1.close();
      return worker.terminate();
    },
  };
}
