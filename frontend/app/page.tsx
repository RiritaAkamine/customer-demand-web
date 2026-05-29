"use client";

import React, { useEffect, useRef, useState } from "react";

// 感情スコアの型定義
interface EmotionScores {
  neutral: number;
  happy: number;
  sad: number;
  angry: number;
  surprise: number;
}

// サーバーからのレスポンス型定義
interface AnalysisResult {
  dominant_emotion: string;
  emotion_scores: EmotionScores;
  live_interest: number;
  voice_interest: number;
  voice_rms: number;
  voice_pitch: number;
  customer_advice: string;
  advice_status: string;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("システム準備完了");

  // カメラの初期化
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function setupCamera() {
      try {
        setStatusMessage("カメラを起動中...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStatusMessage("カメラ起動成功・分析準備完了");
      } catch (err) {
        console.error("カメラの起動に失敗しました:", err);
        setStatusMessage("エラー: カメラのアクセスを許可してください");
      }
    }

    setupCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 感情分析リクエストの送信処理（メインループ）
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isAnalyzing) {
      setStatusMessage("リアルタイム分析中...");
      
      intervalId = setInterval(async () => {
        if (!videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
          // キャンバスに現在のビデオフレームを描画
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 現在のフレームをBase64画像化
          const imageData = canvas.toDataURL("image/jpeg");

          try {
            // ローカル環境なら8000ポート、本番（Vercel）なら/api/indexを叩く完全設定
            const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
            const apiUrl = isLocal ? "http://localhost:8000/api/analyze" : "/api/index";

            const response = await fetch(apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                image: imageData,
                audio: "", 
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data: AnalysisResult = await response.json();
            setResult(data);
          } catch (error) {
            console.error("分析リクエストエラー:", error);
            setStatusMessage("サーバー通信エラーが発生中");
          }
        }
      }, 1000); // 1秒ごとに送信
    } else {
      setStatusMessage("分析停止中");
    }

    return () => clearInterval(intervalId);
  }, [isAnalyzing]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-3xl font-bold mb-2 text-white">Customer Demand Analyzer</h1>
      <p className="text-sm text-gray-400 mb-6">Status: <span className="text-green-400 font-mono">{statusMessage}</span></p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
        {/* 左側：カメラ映像とコントロール */}
        <div className="flex flex-col items-center bg-gray-800 p-4 rounded-xl shadow-lg">
          <div className="relative w-full max-w-[640px] aspect-video bg-black rounded-lg overflow-hidden mb-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute top-0 left-0 w-full h-full object-cover transform scale-x-[-1]"
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute top-0 left-0 w-full h-full object-cover transform scale-x-[-1] pointer-events-none"
            />
          </div>

          <button
            onClick={() => setIsAnalyzing(!isAnalyzing)}
            className={`w-full max-w-xs py-3 px-6 rounded-lg font-bold text-lg transition-all ${
              isAnalyzing
                ? "bg-red-600 hover:bg-red-700 text-white shadow-red-900/50"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-900/50"
            } shadow-md`}
          >
            {isAnalyzing ? "分析を停止" : "分析を開始"}
          </button>
        </div>

        {/* 右側：分析結果表示ステーション */}
        <div className="flex flex-col bg-gray-800 p-6 rounded-xl shadow-lg justify-between">
          <div>
            <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2 text-blue-400">リアルタイム分析データ</h2>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-700/50 p-3 rounded-lg">
                <span className="text-xs text-gray-400 block">主要感情</span>
                <span className="text-2xl font-bold text-yellow-400">{result?.dominant_emotion || "---"}</span>
              </div>
              <div className="bg-gray-700/50 p-3 rounded-lg">
                <span className="text-xs text-gray-400 block">ライブ関心度</span>
                <span className="text-2xl font-bold text-green-400">{result ? `${result.live_interest}%` : "---"}</span>
              </div>
            </div>

            {/* 各感情のスコアバー */}
            <div className="space-y-2 mb-6">
              <h3 className="text-sm font-semibold text-gray-300">感情分布</h3>
              {["neutral", "happy", "sad", "angry", "surprise"].map((emotion) => {
                const score = result?.emotion_scores[emotion as keyof EmotionScores] || 0;
                return (
                  <div key={emotion} className="flex items-center text-sm">
                    <span className="w-20 capitalize text-gray-400">{emotion}</span>
                    <div className="flex-1 bg-gray-700 h-3 rounded-full overflow-hidden mx-2">
                      <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${score}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-xs">{score.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI接客アドバイス */}
          <div className="bg-blue-950/40 border border-blue-900/60 p-4 rounded-xl mt-auto">
            <h3 className="text-sm font-bold text-blue-300 mb-2">🤖 AI接客アドバイス</h3>
            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
              {result?.customer_advice || "カメラを起動して「分析を開始」を押すと、AIによるリアルタイム接客アドバイスがここに生成されます。"}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}