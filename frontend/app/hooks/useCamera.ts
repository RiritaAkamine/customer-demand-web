"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceMeshResults } from "./types";

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  faceMeshCanvasRef: React.RefObject<HTMLCanvasElement>;
  cameraStatus: string;
  captureBase64: () => string | null;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceMeshCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  const [cameraStatus, setCameraStatus] = useState("起動中");

  useEffect(() => {
    let cancelled = false;

    const loadScript = (src: string): Promise<void> =>
      new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = src;
        s.crossOrigin = "anonymous";
        s.onload = () => resolve();
        document.head.appendChild(s);
      });

    const setupFaceMesh = async () => {
      try {
        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");

        // MediaPipe はグローバルスクリプトとして提供されるため window 経由でアクセスする
        const mpFaceMesh = (window as Window & { FaceMesh?: new (opts: object) => FaceMeshDetector }).FaceMesh;
        if (!mpFaceMesh) return;

        const detector = new mpFaceMesh({
          locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        detector.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        detector.onResults((results: FaceMeshResults) => {
          if (cancelled) return;
          const canvas = faceMeshCanvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const lms = results.multiFaceLandmarks[0];
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            for (let i = 0; i < lms.length; i += 4) {
              ctx.beginPath();
              ctx.arc(lms[i].x * canvas.width, lms[i].y * canvas.height, 1.5, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        });

        const processFrame = async () => {
          if (cancelled) return;
          if (videoRef.current && videoRef.current.readyState >= 3) {
            await detector.send({ image: videoRef.current });
          }
          animationRef.current = requestAnimationFrame(processFrame);
        };
        animationRef.current = requestAnimationFrame(processFrame);
      } catch (err) {
        console.error("FaceMesh load error:", err);
      }
    };

    const setupCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraStatus("稼働中");
        await setupFaceMesh();
      } catch {
        setCameraStatus("利用不可");
      }
    };

    setupCamera();

    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureBase64 = (): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  };

  return { videoRef, canvasRef, faceMeshCanvasRef, cameraStatus, captureBase64 };
}

// MediaPipe の最低限の型定義（@types/mediapipe が存在しないため自前で定義）
interface FaceMeshDetector {
  setOptions(opts: object): void;
  onResults(callback: (results: FaceMeshResults) => void): void;
  send(inputs: { image: HTMLVideoElement }): Promise<void>;
}
