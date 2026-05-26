"use client";

import { useEffect, useRef, useState } from "react";

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  faceMeshCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraStatus: string;
  captureBase64: () => string | null;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMeshCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraStatus, setCameraStatus] = useState("待機中");

  const isInitializedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    let localStream: MediaStream | null = null;
    const videoElement = videoRef.current;

    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStream = stream;
        if (videoElement) {
          videoElement.srcObject = stream;
          
          // ⭕️ 【本番環境対策】ビデオのメタデータ（解像度等）が完全に読み込まれるのを待ってから稼働状態にする
          videoElement.onloadedmetadata = () => {
            if (!isMounted) return;
            videoElement.play().catch((e) => console.error("Video play failed:", e));
            setCameraStatus("稼働中");
            isInitializedRef.current = true;
          };
        }
      } catch (err) {
        console.error("カメラの初期化に失敗しました:", err);
        if (isMounted) setCameraStatus("利用不可");
      }
    }

    setupCamera();

    return () => {
      isMounted = false;
      isInitializedRef.current = false;
      if (videoElement) {
        videoElement.onloadedmetadata = null;
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 1.5秒ごとの定期ポーリングから実行される画像キャプチャ関数
  const captureBase64 = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return null;

    // ビデオの描画サイズが確定しているかチェック（0の場合はスキップ）
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    // キャンバスサイズをビデオに合わせる
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // 現在のビデオフレームをキャンバスに写し取る
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // JPEGのBase64文字列として排出
    return canvas.toDataURL("image/jpeg", 0.8);
  };

  return { videoRef, canvasRef, faceMeshCanvasRef, cameraStatus, captureBase64 };
}

// ---------------------------------------------------------------------------
// MediaPipe の最低限の型定義
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    FaceMesh: any;
    Camera: any;
  }
}