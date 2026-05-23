"use client";

import { useEffect, useRef, useState } from "react";
// audiobuffer-to-wav に @types が存在しないため module 宣言で型付け
import toWav from "audiobuffer-to-wav";

declare module "audiobuffer-to-wav" {
  function toWav(buffer: AudioBuffer): ArrayBuffer;
  export = toWav;
}

interface UseAudioRecorderReturn {
  audioCanvasRef: React.RefObject<HTMLCanvasElement | null>; // 型安全のために修正
  audioStatus: string;
  currentAudioBase64: string;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const audioCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const waveAnimationRef = useRef<number | null>(null);

  const [audioStatus, setAudioStatus] = useState("起動中");
  const [currentAudioBase64, setCurrentAudioBase64] = useState("");

  useEffect(() => {
    let cancelled = false;
    let audioTimer: ReturnType<typeof setInterval> | null = null;

    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioStreamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) throw new Error("AudioContext not supported");

        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const src = ctx.createMediaStreamSource(stream);
        const analyzer = ctx.createAnalyser();
        analyzer.fftSize = 1024;
        src.connect(analyzer);

        // 波形描画ループ
        const buf = new Uint8Array(analyzer.frequencyBinCount);
        
        const drawWave = () => {
          if (cancelled) return;

          const canvas = audioCanvasRef.current;
          const c = canvas?.getContext("2d");
          if (!canvas || !c) {
            // まだCanvasの準備ができていない場合は次のフレームを待つ
            waveAnimationRef.current = requestAnimationFrame(drawWave);
            return;
          }

          waveAnimationRef.current = requestAnimationFrame(drawWave);
          analyzer.getByteTimeDomainData(buf);

          const w = canvas.width;
          const h = canvas.height;

          // ⭕ 変更点1: clearRect ではなく、親要素の背景色 (#f9fafb) でしっかり塗りつぶす
          c.fillStyle = "#f9fafb";
          c.fillRect(0, 0, w, h);

          // ⭕ 変更点2: 完全に無音のときでも中央に綺麗な「一本の静寂線」を引くための処理
          c.lineWidth = 2.0;       // 少し線を太くして視認性を向上
          c.strokeStyle = "#2563eb"; // 黒(#111827)から、きれいなプライマリーブルーに変更
          c.lineCap = "round";
          c.lineJoin = "round";
          
          c.beginPath();

          const sliceWidth = w / buf.length;
          let x = 0;

          for (let i = 0; i < buf.length; i++) {
            // 音声データがフラット(128)の時、ちょうど h / 2 (真ん中) になる
            const v = buf[i] / 128.0;
            const y = v * (h / 2);

            if (i === 0) {
              c.moveTo(x, y);
            } else {
              c.lineTo(x, y);
            }
            x += sliceWidth;
          }

          // 最後の帳尻合わせ
          c.lineTo(w, h / 2);
          c.stroke();
        };

        // Canvas要素がDOMに配置されるのをほんの少しだけ待ってから描画ループを開始
        setTimeout(() => {
          drawWave();
        }, 100);

        // 録音・WAV変換ループ
        const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          if (cancelled) return;
          if (!audioChunksRef.current.length) {
            setCurrentAudioBase64("");
            return;
          }
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          audioChunksRef.current = [];

          try {
            const ab = await blob.arrayBuffer();
            if (ab.byteLength >= 5000) {
              const decodeCtx = new AudioCtx({ sampleRate: 16000 });
              const decoded = await decodeCtx.decodeAudioData(ab.slice(0));
              const wavBuf = toWav(decoded);
              const wavBlob = new Blob([new DataView(wavBuf)], { type: "audio/wav" });
              await decodeCtx.close();

              const reader = new FileReader();
              reader.onloadend = () => {
                if (!cancelled && reader.result) {
                  setCurrentAudioBase64(reader.result as string);
                }
              };
              reader.readAsDataURL(wavBlob);
            } else {
              setCurrentAudioBase64("");
            }
          } catch (e) {
            console.error("[Audio] WAV変換エラー:", e);
            setCurrentAudioBase64("");
          }

          // 次の録音セグメントを開始
          if (!cancelled && mediaRecorderRef.current?.state === "inactive") {
            try {
              mediaRecorderRef.current.start();
            } catch (e) {
              console.error("[Audio] 再起動エラー:", e);
            }
          }
        };

        recorder.start();
        audioTimer = setInterval(() => {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
          }
        }, 2000);

        setAudioStatus("稼働中");
      } catch (err) {
        console.error("[Audio] マイク初期化エラー:", err);
        setAudioStatus("利用不可");
      }
    };

    setupAudio();

    return () => {
      cancelled = true;
      if (audioTimer) clearInterval(audioTimer);
      if (waveAnimationRef.current) cancelAnimationFrame(waveAnimationRef.current);
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
    };
  }, []);

  return { audioCanvasRef, audioStatus, currentAudioBase64 };
}