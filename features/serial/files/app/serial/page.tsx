"use client";

/**
 * /serial — Arduino / Web Serial development page.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  READ THIS BEFORE COPYING THE PATTERN INTO YOUR OWN PAGES           │
 * │                                                                     │
 * │  Never write high-speed serial data straight into React state.     │
 * │  An Arduino at 115200 baud can send hundreds of lines per second.  │
 * │  `setLines(prev => [...prev, line])` per message = hundreds of      │
 * │  re-renders per second = the UI chokes, input lags, frames drop.   │
 * │                                                                     │
 * │  Application code should use `onLatestMessage` for high-speed      │
 * │  displays. The buffering below exists only because this developer  │
 * │  console must preserve multiple lines for inspection; it is not    │
 * │  the pattern junior developers should copy into kiosk pages.       │
 * └─────────────────────────────────────────────────────────────────────┘
 */
import { useEffect, useRef, useState } from "react";
import { useSerial } from "../../lib/serial/useSerial";

const MAX_VISIBLE_LINES = 200; // cap what we keep in state; the console is a window, not a database
const FLUSH_INTERVAL_MS = 100; // ~10 UI updates/sec is plenty for human eyes

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

function formatUsbId(value: number | undefined) {
  if (value === undefined) return "Unavailable";
  return `${value} (0x${value.toString(16).padStart(4, "0")})`;
}

const MINIMUM_SETUP_EXAMPLE = `"use client";

import { useSerial } from "@/lib/serial/useSerial";

export default function SerialExample() {
  const { status, error, connect, disconnect, sendMessage } = useSerial({
    onMessage: (message) => {
      console.log("Received:", message);
    },
  });

  const connected = status === "connected";

  return (
    <>
      <button onClick={() => void connect()} disabled={connected}>
        Connect
      </button>
      <button onClick={() => void sendMessage("LED_ON")} disabled={!connected}>
        Send LED_ON
      </button>
      <button onClick={() => void disconnect()} disabled={!connected}>
        Disconnect
      </button>
      <p>Status: {status}</p>
      {error && <p>{error}</p>}
    </>
  );
}`;

const ON_MESSAGE_EXAMPLE = `const [buttonPressed, setButtonPressed] = useState(false);

useSerial({
  onMessage: (message) => {
    if (message === "BUTTON_PRESSED") setButtonPressed(true);
    if (message === "BUTTON_RELEASED") setButtonPressed(false);
  },
});`;

const LATEST_VALUE_EXAMPLE = `const [distance, setDistance] = useState(0);

useSerial({
  baudRate: 9600,
  // Receives only the freshest reading, at most once every 60 ms.
  onLatestMessage: (message) => {
    const nextDistance = Number.parseFloat(message);
    if (Number.isFinite(nextDistance)) {
      setDistance(nextDistance);
    }
  },
});`;

const SEND_MESSAGE_EXAMPLE = `const { sendMessage } = useSerial();

async function turnLedOn() {
  await sendMessage("LED_ON"); // A newline is added automatically.
}`;

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

  const { status, error, portInfo, connect, disconnect, sendMessage } = useSerial({
    baudRate,
    // This callback fires per line at wire speed. Note: no setState in here.
    onMessage: (line) => {
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
      await sendMessage(command);
      setCommand("");
    } catch {
      /* surfaced via status/error */
    }
  }

  const connected = status === "connected";

  return (
    <main className="min-h-screen bg-white text-neutral-800">
      <div className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-2xl font-bold">Serial dev page</h1>

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

      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
        <h2 className="font-bold text-neutral-800">Selected device</h2>
        {portInfo ? (
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-neutral-500">USB vendor ID</dt>
              <dd className="font-mono text-neutral-900">{formatUsbId(portInfo.usbVendorId)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">USB product ID</dt>
              <dd className="font-mono text-neutral-900">{formatUsbId(portInfo.usbProductId)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-1 text-neutral-500">Connect a device to view its identifiers.</p>
        )}
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
        className="mt-3 h-72 overflow-y-auto rounded-lg border border-neutral-300 bg-neutral-950 p-3 font-mono text-xs leading-5 text-emerald-300"
      >
        {visibleLines.length === 0 ? (
          <p className="text-neutral-500">
            {connected ? "Waiting for data…" : "Connect a device to see incoming lines."}
          </p>
        ) : (
          visibleLines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
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

      <details className="mt-8 rounded-lg border border-sky-200 bg-sky-50 text-sm leading-6">
        <summary className="cursor-pointer select-none px-5 py-4 text-base font-bold text-sky-950">
          How to use the <code>useSerial</code> hook.
        </summary>
        <section className="border-t border-sky-200 px-5 pb-5 pt-4">
          <h2 className="text-base font-bold text-sky-950">Bare Minimum Setup</h2>
          <p className="mt-2 text-neutral-700">
            Call <code>connect</code> from a button before listening for or sending messages. The browser requires a
            user action before it can open the serial-port picker.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-5 text-emerald-200">
            <code>{MINIMUM_SETUP_EXAMPLE}</code>
          </pre>

          <h2 className="mt-6 text-base font-bold text-sky-950">Three Message APIs</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded border border-neutral-200 bg-white p-3">
              <code className="font-bold">sendMessage</code>
              <p className="mt-1 text-neutral-700">Send a message to the Arduino or other serial device.</p>
            </div>
            <div className="rounded border border-neutral-200 bg-white p-3">
              <code className="font-bold">onMessage</code>
              <p className="mt-1 text-neutral-700">Receive every complete message as soon as it arrives.</p>
            </div>
            <div className="rounded border border-neutral-200 bg-white p-3">
              <code className="font-bold">onLatestMessage</code>
              <p className="mt-1 text-neutral-700">Receive only the freshest message at a safe UI update rate.</p>
            </div>
          </div>

          <h2 className="mt-6 text-base font-bold text-sky-950">A Tale of Two Callbacks</h2>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-sky-200 bg-white p-4">
              <h3 className="font-bold text-sky-950">
                🐢 <code>onMessage</code>: occasional events
              </h3>
              <p className="mt-2 text-neutral-700">
                Use this for messages that are singular and relatively infrequent, such as button presses, switch
                changes, RFID scans, commands, or errors.
              </p>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-4">
              <h3 className="font-bold text-emerald-800">
                🐇 <code>onLatestMessage</code>: continuous data streams
              </h3>
              <p className="mt-2 text-neutral-700">
                Use this for fast, continuous streams such as proximity, pressure, light, temperature, or position
                sensors. It delivers only the freshest unread message, at most once every 60 ms by default, so you
                can update React state without rendering at the device&apos;s message rate.
              </p>
            </div>
          </div>

          <h2 className="mt-6 text-base font-bold text-sky-950">Examples</h2>

          <h3 className="mt-4 font-bold text-emerald-800">
            <code>onLatestMessage</code>
          </h3>
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-5 text-emerald-200">
            <code>{LATEST_VALUE_EXAMPLE}</code>
          </pre>

          <h3 className="mt-5 font-bold text-sky-950">
            <code>onMessage</code>
          </h3>
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-5 text-sky-200">
            <code>{ON_MESSAGE_EXAMPLE}</code>
          </pre>

          <h3 className="mt-5 font-bold text-sky-950">Sending a message</h3>
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-5 text-sky-200">
            <code>{SEND_MESSAGE_EXAMPLE}</code>
          </pre>

          <p className="mt-5 text-sm font-bold text-red-700">
            Avoid: using <code>onMessage</code> for high-frequency data tied to React state. This can overwhelm
            rendering and make the application lag or crash.
          </p>
        </section>
      </details>
      </div>
    </main>
  );
}
