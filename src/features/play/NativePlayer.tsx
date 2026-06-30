// NativePlayer — runs a game via Harmony's native libretro core host
// (v0.21 "Bedrock") instead of EmulatorJS. The Rust backend owns the entire
// emulation loop and the audio device (play::native::NativeRuntime); this
// component's only job is starting/stopping that session and painting
// whatever frame it last produced onto a <canvas> via `putImageData`.
//
// Scope is deliberately narrow (W214 — frame delivery only): no overlay, no
// fullscreen chrome, no controller input wiring. The runtime switch that
// decides whether to mount this or InPagePlayer (W215), and real input
// (W216), build on top of this.

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getNativeFrame, startNativePlay, stopNativePlay } from "../../ipc/native-play";
import { decodeRgba, isWellFormedRgba } from "./nativeFrame";

export interface NativePlayerProps {
  gameId: number;
  gameName: string;
  /** Called once if the native session fails to start — the caller (the
   * future runtime-switch component, W215) decides what to do (typically:
   * fall back to InPagePlayer rather than show an error state). */
  onStartFailed?: () => void;
}

/** Mounts a native libretro core session for one game; auto-starts on load. */
export function NativePlayer({ gameId, gameName, onStartFailed }: NativePlayerProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let frameHandle = 0;

    const paintNextFrame = () => {
      if (cancelled) return;
      getNativeFrame()
        .then((frame) => {
          const canvas = canvasRef.current;
          if (!frame || !canvas) return;
          const bytes = decodeRgba(frame.rgbaBase64);
          if (!isWellFormedRgba(frame, bytes)) return; // a truncated/corrupt frame — skip, try again next tick
          if (canvas.width !== frame.width) canvas.width = frame.width;
          if (canvas.height !== frame.height) canvas.height = frame.height;
          canvas.getContext("2d")?.putImageData(new ImageData(bytes, frame.width, frame.height), 0, 0);
        })
        .catch(() => {
          /* a poll failing isn't fatal — try again next tick */
        })
        .finally(() => {
          if (!cancelled) frameHandle = requestAnimationFrame(paintNextFrame);
        });
    };

    startNativePlay(gameId)
      .then(() => {
        if (!cancelled) frameHandle = requestAnimationFrame(paintNextFrame);
      })
      .catch(() => {
        if (!cancelled) onStartFailed?.();
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameHandle);
      void stopNativePlay();
    };
  }, [gameId]); // intentionally re-subscribes per gameId only — onStartFailed is a stable callback in intended usage

  return (
    <div className="harmony-player">
      <div className="harmony-player__frame">
        <canvas ref={canvasRef} className="harmony-native-player__canvas" aria-label={`Play ${gameName}`} />
      </div>
      <div className="harmony-player__bar">
        <button type="button" className="harmony-player__fs" onClick={() => navigate(-1)}>
          ✕ Exit
        </button>
      </div>
    </div>
  );
}
