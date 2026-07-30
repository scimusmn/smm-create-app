/// <reference types="w3c-web-serial" />
// ^ must stay on line 1: triple-slash directives are ignored unless they
//   precede all statements (including "use client"). It's needed because the
//   OpenNext template's tsconfig sets an explicit "types" array, which turns
//   off automatic @types/* inclusion — this loads the Web Serial ambient
//   types without touching the upstream tsconfig.
"use client";

/**
 * useSerial — SMM standard Web Serial hook.
 *
 * Design rule (important): this hook deliberately separates two kinds of data:
 *
 *   1. LOW-frequency connection state (disconnected/connected/error) — fine
 *      to keep in React state; it changes a few times per session.
 *   2. HIGH-frequency incoming data — delivered via the `onLine` callback and
 *      NEVER stored in React state by this hook. An Arduino can happily send
 *      hundreds of lines per second; calling setState for each one will
 *      re-render your component into the ground. Buffer in a ref and flush on
 *      a throttled tick. See app/serial/page.tsx for the reference pattern.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SerialStatus = "unsupported" | "disconnected" | "connecting" | "connected" | "error";

export interface UseSerialOptions {
  /** Called once per received line (newline-delimited). Runs OUTSIDE React
   *  rendering — do not call setState in here for high-rate streams. */
  onLine?: (line: string) => void;
  baudRate?: number;
}

type SerialWriter = WritableStreamDefaultWriter<Uint8Array>;

const DEFAULT_BAUD_RATE = 9600;

export function useSerial({ onLine, baudRate = DEFAULT_BAUD_RATE }: UseSerialOptions = {}) {
  const [status, setStatus] = useState<SerialStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const writerRef = useRef<SerialWriter | null>(null);
  const readAbortControllerRef = useRef<AbortController | null>(null);

  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

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

    await closeIgnoringErrors(writerRef.current);
    writerRef.current = null;

    await closeIgnoringErrors(portRef.current);
    portRef.current = null;

    setStatus("disconnected");
  }, []);

  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

  const connect = useCallback(async () => {
    if (!("serial" in navigator)) return;

    setError(null);
    setStatus("connecting");

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate });

      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      setStatus("connected");

      const readAbortController = new AbortController();
      readAbortControllerRef.current = readAbortController;

      void readLines(port, readAbortController.signal, (line) => onLineRef.current?.(line)).catch(
        (cause: unknown) => {
          if (readAbortController.signal.aborted) return;

          setError(toErrorMessage(cause));
          setStatus("error");
        },
      );
    } catch (cause) {
      if (isPortPickerCancellation(cause)) {
        setStatus("disconnected");
        return;
      }

      setError(toErrorMessage(cause));
      setStatus("error");
    }
  }, [baudRate]);

  const write = useCallback(async (text: string) => {
    const writer = writerRef.current;
    if (!writer) throw new Error("Not connected");

    const encodedText = new TextEncoder().encode(withTrailingNewline(text));
    await writer.write(encodedText);
  }, []);

  return { status, error, connect, disconnect, write };
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

function withTrailingNewline(text: string) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function isPortPickerCancellation(cause: unknown) {
  return cause instanceof DOMException && cause.name === "NotFoundError";
}

function toErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
