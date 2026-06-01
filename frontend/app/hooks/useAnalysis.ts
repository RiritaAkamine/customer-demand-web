"use client";

import { useEffect, useRef, useState } from "react";
import type { AdviceLog, AnalysisResult } from "./types";

const RENDER_API_URL = "https://customer-demand-backend.onrender.com/api/analyze";

const getApiUrl = (): string => {
  if (typeof window !== "undefined") {
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (isLocal) {
      return "http://127.0.0.1:8000/api/analyze";
    }
  }
  return RENDER_API_URL;
};

const POLL_INTERVAL_MS = 1500;

interface UseAnalysisOptions {
  captureBase64: () => string | null;
  currentAudioBase64: string;
}

// 会話ログ用の型定義（接客ログと同じ構造）
interface SpeechLog {
  id: string;
  time: string;
  emotion: string;
  text: string;
}

interface UseAnalysisReturn {
  liveInterest: number;
  voiceInterest: number;
  dominantEmotion: string;
  customerAdvice: string;
  adviceHistory: AdviceLog[];
  speechHistory: SpeechLog[]; // 💡 追加
  emotionScores: Record<string, number>;
  adviceStatus: string;
  logContainerRef: React.RefObject<HTMLDivElement | null>;
  speechContainerRef: React.RefObject<HTMLDivElement | null>; // 💡 追加
  handleLogScroll: () => void;
  handleSpeechScroll: () => void; // 💡 追加
}

export function useAnalysis({ captureBase64, currentAudioBase64 }: UseAnalysisOptions): UseAnalysisReturn {
  const isAnalyzingRef = useRef(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const speechContainerRef = useRef<HTMLDivElement | null>(null); // 💡 追加
  const isUserScrollingRef = useRef(false);
  const isUserScrollingSpeechRef = useRef(false); // 💡 追加

  const [liveInterest, setLiveInterest] = useState(50);
  const [voiceInterest, setVoiceInterest] = useState(0);
  const [dominantEmotion, setDominantEmotion] = useState("真顔・普通");
  const [customerAdvice, setCustomerAdvice] = useState("接客分析を開始しました");
  const [adviceHistory, setAdviceHistory] = useState<AdviceLog[]>([]);
  const [speechHistory, setSpeechHistory] = useState<SpeechLog[]>([]); // 💡 追加
  const [emotionScores, setEmotionScores] = useState<Record<string, number>>({});
  const [adviceStatus, setAdviceStatus] = useState("待機中");

  // 接客ログの自動スクロール
  useEffect(() => {
    const container = logContainerRef.current;
    if (!container || isUserScrollingRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [adviceHistory]);

  // 会話ログの自動スクロール 💡 追加
  useEffect(() => {
    const container = speechContainerRef.current;
    if (!container || isUserScrollingSpeechRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [speechHistory]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (isAnalyzingRef.current) return;

      const base64Image = captureBase64();
      if (!base64Image) return;

      isAnalyzingRef.current = true;
      try {
        const res = await fetch(getApiUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Image, audio: currentAudioBase64 }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);

        const data: AnalysisResult & { transcription?: string } = await res.json();
        setDominantEmotion(data.dominant_emotion);
        setLiveInterest(data.live_interest);
        setVoiceInterest(data.voice_interest ?? 0);
        setEmotionScores(data.emotion_scores || {});
        setAdviceStatus(data.advice_status || "更新済み");

        // 現在の時刻テキストを生成
        const now = new Date();
        const t = [now.getHours(), now.getMinutes(), now.getSeconds()]
          .map((n) => String(n).padStart(2, "0"))
          .join(":");

        // 💡 会話ログの保存ロジックを追加（文字起こしデータがある場合のみ）
        if (data.transcription && data.transcription.trim() !== "") {
          setSpeechHistory((prevSpeech) => {
            // 直前の会話と同じでなければ追加（重複ガード）
            if (prevSpeech.length === 0 || prevSpeech[prevSpeech.length - 1].text !== data.transcription) {
              return [...prevSpeech, {
                id: Math.random().toString(36).slice(2, 9),
                time: t,
                emotion: data.dominant_emotion,
                text: data.transcription,
              }].slice(-20);
            }
            return prevSpeech;
          });
        }

        if (data.customer_advice) {
          setCustomerAdvice((prev) => {
            if (prev !== data.customer_advice && !data.customer_advice.includes("分析中")) {
              setAdviceHistory((h) =>
                [...h, {
                  id: Math.random().toString(36).slice(2, 9),
                  time: t,
                  emotion: data.dominant_emotion,
                  text: data.customer_advice,
                }].slice(-20)
              );
            }
            return data.customer_advice;
          });
        }
      } catch {
        setAdviceStatus("接続待ち");
      } finally {
        isAnalyzingRef.current = false;
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [captureBase64, currentAudioBase64]);

  const handleLogScroll = () => {
    const container = logContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 20;
    isUserScrollingRef.current = !atBottom;
  };

  // 会話ログ用のスクロールハンドラ 💡 追加
  const handleSpeechScroll = () => {
    const container = speechContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 20;
    isUserScrollingSpeechRef.current = !atBottom;
  };

  return {
    liveInterest,
    voiceInterest,
    dominantEmotion,
    customerAdvice,
    adviceHistory,
    speechHistory, // 💡 追加
    emotionScores,
    adviceStatus,
    logContainerRef,
    speechContainerRef, // 💡 追加
    handleLogScroll,
    handleSpeechScroll, // 💡 追加
  };
}