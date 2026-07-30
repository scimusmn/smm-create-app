"use client";

/**
 * /serial — Arduino / Web Serial debug page.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  READ THIS BEFORE COPYING THE PATTERN INTO YOUR OWN PAGES           │
 * │                                                                     │
 * │  Never write high-speed serial data straight into React state.     │
 * │  An Arduino at 115200 baud can send hundreds of lines per second.  │
 * │  `setLines(prev => [...prev, line])` per message = hundreds of      │
 * │  re-renders per second = the UI chokes, input lags, frames drop.   │
 * │                                                                     │
 * │  The pattern (used below):                                          │
 * │    1. Incoming lines are pushed into a plain ref (no re-render).    │
 * │    2. A requestAnimationFrame loop flushes the ref into state at    │
 * │       most ~10x/second — and only when there's something new.       │
 * │    3. React renders at human speed while data arrives at Arduino    │
 * │       speed. The two are decoupled.                                 │
 * └─────────────────────────────────────────────────────────────────────┘
 */
import { useEffect, useRef, useState } from "react";
import { useSerial } from "../../lib/serial/useSerial";

const MAX_VISIBLE_LINES = 200; // cap what we keep in state; the console is a window, not a database
const FLUSH_INTERVAL_MS = 100; // ~10 UI updates/sec is plenty for human eyes

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

const BAD_EXAMPLE = `const [latestLine, setLatestLine] = useState("");

useSerial({
  onLine: (line) => {
    setLatestLine(line); // Re-renders once per Arduino message
  },
});`;

const GOOD_EXAMPLE = `const pendingRef = useRef<string[]>([]);
const [visibleLines, setVisibleLines] = useState<string[]>([]);
const MAX_BUFFERED_LINES = 200;

useSerial({
  baudRate: 115200,
  onLine: (line) => {
    // Fast lane: store data without rendering.
    pendingRef.current.push(line);
    if (pendingRef.current.length > MAX_BUFFERED_LINES) {
      pendingRef.current.shift();
    }
  },
});

useEffect(() => {
  const timer = window.setInterval(() => {
    if (pendingRef.current.length === 0) return;

    const incoming = pendingRef.current;
    pendingRef.current = [];
    // Slow lane: update the UI in batches.
    setVisibleLines((previous) =>
      [...previous, ...incoming].slice(-200),
    );
  }, 100); // At most 10 React updates per second

  return () => window.clearInterval(timer);
}, []);`;

export default function SerialDebugPage() {
  const [baudRate, setBaudRate] = useState(9600);
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, perSecond: 0 });
  const [paused, setPaused] = useState(false);
  const [command, setCommand] = useState("");

  // High-frequency lane: refs only. Nothing here triggers a render.
  const pendingRef = useRef<string[]>([]);
  const totalRef = useRef(0);
  const windowCountRef = useRef(0); // messages since last rate sample
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const { status, error, connect, disconnect, write } = useSerial({
    baudRate,
    // This callback fires per line at wire speed. Note: no setState in here.
    onLine: (line) => {
      totalRef.current += 1;
      windowCountRef.current += 1;
      if (!pausedRef.current) {
        pendingRef.current.push(line);
        // Even the buffer stays bounded — protects against a runaway sender.
        if (pendingRef.current.length > MAX_VISIBLE_LINES) {
          pendingRef.current.splice(0, pendingRef.current.length - MAX_VISIBLE_LINES);
        }
      }
    },
  });

  // Low-frequency lane: a single throttled loop moves data ref -> state.
  useEffect(() => {
    let raf = 0;
    let lastFlush = 0;
    let lastRateSample = performance.now();

    const tick = (now: number) => {
      if (now - lastFlush >= FLUSH_INTERVAL_MS) {
        lastFlush = now;
        if (pendingRef.current.length > 0) {
          const incoming = pendingRef.current;
          pendingRef.current = [];
          setVisibleLines((prev) => [...prev, ...incoming].slice(-MAX_VISIBLE_LINES));
        }
        if (now - lastRateSample >= 1000) {
          const perSecond = Math.round((windowCountRef.current * 1000) / (now - lastRateSample));
          windowCountRef.current = 0;
          lastRateSample = now;
          setStats({ total: totalRef.current, perSecond });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const consoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [visibleLines]);

  async function handleSend() {
    if (!command.trim()) return;
    try {
      await write(command);
      setCommand("");
    } catch {
      /* surfaced via status/error */
    }
  }

  const connected = status === "connected";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 font-mono text-neutral-800">
      <p className="text-xs uppercase tracking-widest text-neutral-400">smm starter · dev tool</p>
      <h1 className="mt-1 text-2xl font-bold">Serial debug</h1>

      <section className="mt-6 rounded-lg border border-sky-200 bg-sky-50 p-5 text-sm leading-6">
        <h2 className="text-base font-bold text-sky-950">Use serial data at two different speeds</h2>
        <p className="mt-2 text-neutral-700">
          <code>onLine</code> runs once for every newline-delimited message from the Arduino. Treat it as the
          <strong> fast data lane</strong>: parse, count, or buffer messages in refs or another non-React store.
          React state is the <strong>slow UI lane</strong>: update it only when the screen needs a new snapshot.
        </p>
        <p className="mt-2 text-neutral-700">
          For a high-rate stream, do not call a state setter for every line. That couples the Arduino&apos;s message
          rate to React&apos;s render rate and can make kiosk controls lag even when no serial data is lost.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="font-bold text-red-700">Avoid: render at wire speed</h3>
            <pre className="mt-2 overflow-x-auto rounded bg-red-950 p-3 text-xs leading-5 text-red-100">
              <code>{BAD_EXAMPLE}</code>
            </pre>
          </div>
          <div>
            <h3 className="font-bold text-emerald-700">Recommended: buffer, then batch</h3>
            <pre className="mt-2 overflow-x-auto rounded bg-neutral-950 p-3 text-xs leading-5 text-emerald-200">
              <code>{GOOD_EXAMPLE}</code>
            </pre>
          </div>
        </div>

        <p className="mt-4 text-neutral-700">
          Choose the flush interval for the UI, not the Arduino. Around 50–100 ms feels live for most kiosk
          displays. Keep buffers bounded, and handle lightweight work that must react immediately inside
          <code> onLine</code> instead of waiting for React to render. The live console below uses the same idea with
          <code> requestAnimationFrame</code>.
        </p>
      </section>

      {status === "unsupported" && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Web Serial isn&apos;t available in this browser. Use Chrome or Edge over HTTPS or localhost.
        </p>
      )}

      {/* Connection controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Baud
          <select
            className="rounded border border-neutral-300 bg-white px-2 py-1"
            value={baudRate}
            disabled={connected}
            onChange={(e) => setBaudRate(Number(e.target.value))}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </label>
        {connected ? (
          <button onClick={() => void disconnect()} className="rounded bg-neutral-800 px-3 py-1 text-white">
            Disconnect
          </button>
        ) : (
          <button
            onClick={() => void connect()}
            disabled={status === "connecting" || status === "unsupported"}
            className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-50"
          >
            {status === "connecting" ? "Connecting…" : "Connect to port"}
          </button>
        )}
        <span
          className={`rounded px-2 py-0.5 text-xs ${connected ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"}`}
        >
          {status}
        </span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {/* Live stats — proof the decoupling works: watch msgs/sec climb while the UI stays smooth */}
      <div className="mt-4 flex gap-6 text-xs text-neutral-500">
        <span>
          received: <strong className="text-neutral-800">{stats.total}</strong>
        </span>
        <span>
          rate: <strong className="text-neutral-800">{stats.perSecond}/s</strong>
        </span>
        <button onClick={() => setPaused((p) => !p)} className="underline">
          {paused ? "resume console" : "pause console"}
        </button>
        <button onClick={() => setVisibleLines([])} className="underline">
          clear
        </button>
      </div>

      {/* RX console */}
      <div
        ref={consoleRef}
        className="mt-3 h-72 overflow-y-auto rounded-lg border border-neutral-300 bg-neutral-950 p-3 text-xs leading-5 text-emerald-300"
      >
        {visibleLines.length === 0 ? (
          <p className="text-neutral-500">
            {connected ? "Waiting for data…" : "Connect a device to see incoming lines."}
          </p>
        ) : (
          visibleLines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        Showing the last {MAX_VISIBLE_LINES} lines, refreshed at ~{Math.round(1000 / FLUSH_INTERVAL_MS)}fps.
        Incoming data is buffered in a ref and flushed on a throttled tick — see the comment at the top of this
        file before rolling your own serial UI.
      </p>

      {/* TX */}
      <div className="mt-4 flex gap-2">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSend()}
          placeholder={connected ? "Send a command (Enter)" : "Connect first"}
          disabled={!connected}
          className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:bg-neutral-100"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!connected}
          className="rounded bg-neutral-800 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </main>
  );
}
