"use client";

import { useEffect, useRef, useState } from "react";
import toWav from "audiobuffer-to-wav";

interface UseAudioRecorderReturn {
  audioCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  audioStatus: string;
  currentAudioBase64: string;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const audioCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [audioStatus, setAudioStatus] = useState("待機中");
  const [currentAudioBase64, setCurrentAudioBase64] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // 音声波形のリアルタイム描画ループ
  const drawWaveform = () => {
    if (!analyserRef.current || !audioCanvasRef.current) return;
    const canvas = audioCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f9fafb";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#3b82f6";
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    animationFrameRef.current = requestAnimationFrame(drawWaveform);
  };

  useEffect(() => {
    let isMounted = true;

    async function initAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isMounted) return;

        // Web Audio APIの初期化（描画用）
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;
        setAudioStatus("稼働中");
        drawWaveform();

        // サーバーに送る録音用のMediaRecorder
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          audioChunksRef.current = [];

          try {
            // Web Audio APIを使ってWAV形式に変換
            const arrayBuffer = await blob.arrayBuffer();
            const decodedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await decodedCtx.decodeAudioData(arrayBuffer);
            const wavArrayBuffer = toWav(audioBuffer);
            
            // Base64にエンコードして状態更新
            const uint8 = new Uint8Array(wavArrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8.length; i++) {
              binary += String.fromCharCode(uint8[i]);
            }
            const base64 = btoa(binary);
            setCurrentAudioBase64(`data:audio/wav;base64,${base64}`);
          } catch (err) {
            print("[AudioRecorder] WAV変換失敗:", err);
          }

          if (mediaRecorderRef.current && audioStatus === "稼働中") {
            mediaRecorderRef.current.start();
          }
        };

        mediaRecorderRef.current = recorder;
        recorder.start();

        // 1.5秒ごとに区切って音声をチャンク化（useAnalysisのタイマーと同期するため自動フラッシュ）
        const interval = setInterval(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
          }
        }, 1500);

        return () => clearInterval(interval);
      } catch (err) {
        console.error("マイクの初期化に失敗しました:", err);
        if (isMounted) setAudioStatus("利用不可");
      }
    }

    initAudio();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return { audioCanvasRef, audioStatus, currentAudioBase64 };
}

// 内部ログ用の簡易ダミー
function print(...args: any[]) {
  console.log(...args);
}