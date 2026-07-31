/// <reference types="w3c-web-serial" />
// ^ must stay on line 1: triple-slash directives are ignored unless they
//   precede all statements (including "use client"). It's needed because the
//   OpenNext template's tsconfig sets an explicit "types" array, which turns
//   off automatic @types/* inclusion — this loads the Web Serial ambient
//   types without touching the upstream tsconfig.
"use client";

/**
 * useSerial — SMM standard Web Serial hook.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SerialStatus = "unsupported" | "disconnected" | "connecting" | "connected" | "error";

export interface UseSerialOptions {
  /** Called once per complete newline-delimited message. */
  onMessage?: (message: string) => void;
  /** Called with only the newest message received since the previous sample.
   *  Intermediate messages are intentionally discarded, making this suitable
   *  for updating React state that displays a live sensor value. */
  onLatestMessage?: (message: string) => void;
  /** Minimum interval between `onLatestMessage` calls. Defaults to 60 ms.
   *  Recommend range: 60-100 */
  latestMessageIntervalMs?: number;
  baudRate?: number;
  /** Connect on mount using getPorts() (no user gesture; used by Stele). */
  autoConnect?: boolean;
}

type SerialWriter = WritableStreamDefaultWriter<Uint8Array>;

const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_LATEST_MESSAGE_INTERVAL_MS = 60;

export function useSerial({
  onMessage,
  onLatestMessage,
  latestMessageIntervalMs = DEFAULT_LATEST_MESSAGE_INTERVAL_MS,
  baudRate = DEFAULT_BAUD_RATE,
  autoConnect = false,
}: UseSerialOptions = {}) {
  const [status, setStatus] = useState<SerialStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [portInfo, setPortInfo] = useState<SerialPortInfo | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<SerialWriter | null>(null);
  const readAbortControllerRef = useRef<AbortController | null>(null);

  const onMessageRef = useRef(onMessage);
  const onLatestMessageRef = useRef(onLatestMessage);
  onMessageRef.current = onMessage;
  onLatestMessageRef.current = onLatestMessage;

  const latestMessageRef = useRef("");
  const hasPendingLatestMessageRef = useRef(false);
  const latestMessageSamplingIsEnabled =
    onLatestMessage !== undefined && latestMessageIntervalMs > 0;

  useEffect(() => {
    if (!latestMessageSamplingIsEnabled) {
      hasPendingLatestMessageRef.current = false;
      return;
    }

    const samplingTimer = window.setInterval(() => {
      if (!hasPendingLatestMessageRef.current) return;

      hasPendingLatestMessageRef.current = false;
      onLatestMessageRef.current?.(latestMessageRef.current);
    }, latestMessageIntervalMs);

    return () => window.clearInterval(samplingTimer);
  }, [latestMessageSamplingIsEnabled, latestMessageIntervalMs]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && !("serial" in navigator)) {
      setStatus("unsupported");
    }
    return () => {
      void disconnectRef.current?.();
    };
  }, []);

  const disconnect = useCallback(async () => {
    readAbortControllerRef.current?.abort();
    hasPendingLatestMessageRef.current = false;

    await closeIgnoringErrors(writerRef.current);
    writerRef.current = null;

    await closeIgnoringErrors(portRef.current);
    portRef.current = null;

    setPortInfo(null);
    setStatus("disconnected");
  }, []);

  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

  const connect = useCallback(async () => {
    if (!("serial" in navigator)) return;

    hasPendingLatestMessageRef.current = false;
    setPortInfo(null);
    setError(null);
    setStatus("connecting");

    try {
      // Prefer already-granted ports (no user gesture). Needed for Stele kiosks.
      const grantedPorts = await navigator.serial.getPorts();
      const port = grantedPorts.find(p => p.getInfo().usbVendorId !== undefined)
        ?? grantedPorts[0]
        ?? await navigator.serial.requestPort();
      setPortInfo(port.getInfo());

      await port.open({ baudRate });
      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      setStatus("connected");

      const readAbortController = new AbortController();
      readAbortControllerRef.current = readAbortController;

      void readLines(port, readAbortController.signal, (message) => {
        onMessageRef.current?.(message);

        if (onLatestMessageRef.current) {
          latestMessageRef.current = message;
          hasPendingLatestMessageRef.current = true;
        }
      }).catch((cause: unknown) => {
        if (!readAbortController.signal.aborted) {
          setError(toErrorMessage(cause));
          setStatus("error");
        }
      });
    } catch (cause) {
      if (isPortPickerCancellation(cause) || isMissingUserGesture(cause)) {
        setStatus("disconnected");
        return;
      }

      setError(toErrorMessage(cause));
      setStatus("error");
    }
  }, [baudRate]);

  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    if (!autoConnect) return;
    if (typeof navigator === "undefined" || !("serial" in navigator)) return;
    void connectRef.current();
  }, [autoConnect]);

  const sendMessage = useCallback(async (message: string) => {
    const writer = writerRef.current;
    if (!writer) throw new Error("Not connected");

    const encodedMessage = new TextEncoder().encode(withTrailingNewline(message));
    await writer.write(encodedMessage);
  }, []);

  return { status, error, portInfo, connect, disconnect, sendMessage };
}

async function readLines(
  port: SerialPort,
  abortSignal: AbortSignal,
  onLine: (line: string) => void,
) {
  const decoder = new TextDecoder();
  let incompleteLine = "";

  while (port.readable && !abortSignal.aborted) {
    const reader = port.readable.getReader();
    const cancelReader = () => void reader.cancel();
    abortSignal.addEventListener("abort", cancelReader);

    try {
      incompleteLine = await readAvailableLines(reader, decoder, incompleteLine, onLine);
    } finally {
      abortSignal.removeEventListener("abort", cancelReader);
      reader.releaseLock();
    }
  }
}

async function readAvailableLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  initialText: string,
  onLine: (line: string) => void,
) {
  let bufferedText = initialText;

  while (true) {
    const { value, done } = await reader.read();
    if (done) return bufferedText;

    bufferedText += decoder.decode(value, { stream: true });
    bufferedText = emitCompleteLines(bufferedText, onLine);
  }
}

function emitCompleteLines(bufferedText: string, onLine: (line: string) => void) {
  let remainingText = bufferedText;
  let newlineIndex = remainingText.indexOf("\n");

  while (newlineIndex >= 0) {
    const line = remainingText.slice(0, newlineIndex).replace(/\r$/, "");
    remainingText = remainingText.slice(newlineIndex + 1);

    if (line) onLine(line);
    newlineIndex = remainingText.indexOf("\n");
  }

  return remainingText;
}

async function closeIgnoringErrors(resource: { close(): Promise<void> } | null) {
  try {
    await resource?.close();
  } catch {
    // The resource may already be closed.
  }
}

function withTrailingNewline(message: string) {
  return message.endsWith("\n") ? message : `${message}\n`;
}

function isPortPickerCancellation(cause: unknown) {
  return cause instanceof DOMException && cause.name === "NotFoundError";
}

function isMissingUserGesture(cause: unknown) {
  return (
    cause instanceof DOMException
    && cause.name === "SecurityError"
    && /user gesture/i.test(cause.message)
  );
}

function toErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
