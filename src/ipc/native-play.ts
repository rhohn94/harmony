// Native play IPC (v0.21 "Bedrock" W214). A native libretro core session
// runs entirely in the Rust backend; the frontend starts/stops it and polls
// decoded RGBA frames to paint onto a <canvas> (NativePlayer.tsx). Mirrors
// docs/design/native-emulation-design.md §3/§4.

import { invoke } from "./invoke";

/** Mirrors the Rust `NativeFrameDto` (commands::native_play). */
export interface NativeFrame {
  width: number;
  height: number;
  /** Base64-encoded RGBA8888 bytes, `width * height * 4` long once decoded. */
  rgbaBase64: string;
}

/** Starts a native session for `gameId`, replacing any session already running. */
export function startNativePlay(gameId: number): Promise<void> {
  return invoke<void>("start_native_play", { gameId });
}

/** Stops the in-flight native session, if any. */
export function stopNativePlay(): Promise<void> {
  return invoke<void>("stop_native_play");
}

/** The most recently produced frame, or `null` if none is available yet. */
export function getNativeFrame(): Promise<NativeFrame | null> {
  return invoke<NativeFrame | null>("get_native_frame");
}
