"use client";

import { useCamera } from "./hooks/useCamera";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { useAnalysis } from "./hooks/useAnalysis";

// ---------------------------------------------------------------------------
// 定数 & スタイルマッピング
// ---------------------------------------------------------------------------

const EMOTION_LABELS: Record<string, string> = {
  happy: "笑顔",
  neutral: "真顔",
  sad: "困惑",
  angry: "不満",
  surprise: "驚き",
  fear: "警戒",
  disgust: "嫌悪",
};

const EMOTION_COLORS: Record<string, string> = {
  happy: "#10b981",    
  neutral: "#6b7280",  
  sad: "#3b82f6",      
  angry: "#ef4444",    
  surprise: "#f59e0b", 
  fear: "#6366f1",     
  disgust: "#ec4899",  
};

function parseVerdict(advice: string): { tag: string | null; body: string } {
  const match = advice.match(/【判断[:：]\s*([^】]+)】/);
  if (!match) return { tag: null, body: advice };
  return { tag: match[1].trim(), body: advice.replace(match[0], "").trim() };
}

interface VerdictStyle {
  bg: string;
  text: string;
  border: string;
  dot: string;
  label: string;
}

function verdictStyle(tag: string | null): VerdictStyle {
  if (!tag) return { bg: "#f9fafb", text: "#4b5563", border: "#e5e7eb", dot: "#9ca3af", label: "分析中" };
  if (tag.includes("脈あり")) return { bg: "#ecfdf5", text: "#065f46", border: "#a7f3d0", dot: "#10b981", label: "脈あり" };
  if (tag.includes("脈なし")) return { bg: "#fef2f2", text: "#991b1b", border: "#fecaca", dot: "#ef4444", label: "脈なし" };
  return { bg: "#fffbeb", text: "#92400e", border: "#fde68a", dot: "#f59e0b", label: "様子見" };
}

const interestColor = (v: number): string =>
  v >= 70 ? "#10b981" : v <= 40 ? "#ef4444" : "#f59e0b";

const statusDot = (s: string): string =>
  s === "稼働中" ? "#10b981" : s === "利用不可" ? "#ef4444" : "#f59e0b";

// ---------------------------------------------------------------------------
// サブコンポーネント (UIパーツ)
// ---------------------------------------------------------------------------

interface InterestCardProps {
  label: string;
  value: number;
}

function InterestCard({ label, value }: InterestCardProps) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "12px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", boxSizing: "border-box" }}>
      <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: interestColor(value), tracking: "-0.02em", lineHeight: 1.2 }}>
        {value}<span style={{ fontSize: 13, fontWeight: 600, opacity: 0.5, marginLeft: 2 }}>%</span>
      </div>
      <div style={{ marginTop: 8, height: 4, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: interestColor(value), borderRadius: 99, transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }} />
      </div>
    </div>
  );
}

function AdviceLogItem({ log }: { log: any }) {
  const lv = verdictStyle(parseVerdict(log.text).tag);
  const { body } = parseVerdict(log.text);
  return (
    <div style={{ padding: "8px 12px", borderRadius: 8, background: lv.bg, border: `1px solid ${lv.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: lv.text, opacity: 0.6, fontWeight: 600 }}>{log.time}</span>
        <span style={{ fontSize: 10, color: lv.text, fontWeight: 700, background: `${lv.dot}15`, padding: "1px 5px", borderRadius: 4 }}>{log.emotion}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: lv.text, lineHeight: 1.4, fontWeight: 500, whiteSpace: "pre-wrap" }}>{body}</p>
    </div>
  );
}

function SpeechLogItem({ log }: { log: any }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,0.01)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9ca3af", fontWeight: 600 }}>{log.time}</span>
        <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700, background: "#eff6ff", padding: "1px 5px", borderRadius: 4 }}>{log.emotion}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#1f2937", fontSpread: "normal", fontWeight: 600, lineHeight: 1.4 }}>「{log.text}」</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// メイン画面
// ---------------------------------------------------------------------------

export default function Home() {
  const { videoRef, canvasRef, faceMeshCanvasRef, cameraStatus, captureBase64 } = useCamera();
  const { audioCanvasRef, audioStatus, currentAudioBase64 } = useAudioRecorder();
  
  const {
    liveInterest,
    voiceInterest,
    dominantEmotion,
    customerAdvice,
    adviceHistory,
    speechHistory,
    emotionScores,
    adviceStatus,
    logContainerRef,
    speechContainerRef,
    handleLogScroll,
    handleSpeechScroll,
  } = useAnalysis({ captureBase64, currentAudioBase64 });

  const { tag, body } = parseVerdict(customerAdvice);
  const vs = verdictStyle(tag);

  return (
    <main style={{ 
      position: "relative",
      height: "100vh", 
      width: "100vw",
      maxHeight: "100vh", 
      maxWidth: "100vw",
      display: "flex", 
      flexDirection: "column", 
      background: "#f4f5f7", 
      color: "#1f2937", 
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', sans-serif", 
      overflow: "hidden" // 👈 画面全体のスクロールを強制ロック
    }}>

      {/* ナビゲーションバー（高さ56px固定） */}
      <header style={{ flexShrink: 0, background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 2px rgba(0,0,0,0.01)", zIndex: 10, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em", color: "#111827" }}>🎯 顧客心理リアルタイム分析</span>
          <span style={{ height: 14, width: 1, background: "#e5e7eb" }} />
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.03em" }}>NEXT-GEN SALES SUPPORT</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {([{ label: "CAMERA", status: cameraStatus }, { label: "MIC", status: audioStatus }, { label: "AI ENGINE", status: adviceStatus }] as const).map(({ label, status }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8f9fa", padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e7eb" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusDot(status), display: "inline-block" }} />
              <span style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, letterSpacing: "0.02em" }}>{label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* メメインダッシュボード領域（高さを安全圏の62pxに調整しスクロールを完全に防止） */}
      <div style={{ height: "calc(100vh - 62px)", flex: 1, overflow: "hidden", maxWidth: 1440, width: "100%", margin: "0 auto", padding: "12px 16px 16px 16px", display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, boxSizing: "border-box" }}>

        {/* 左側：分析メインフィード（スクロールをシャットアウト） */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", height: "100%" }}>

          {/* リアルタイムAIアドバイスパネル */}
          <div style={{ flexShrink: 0, background: vs.bg, border: `1px solid ${vs.border}`, borderRadius: 14, padding: "16px 20px", boxShadow: "0 4px 12px rgba(0,0,0,0.01)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: vs.dot, display: "inline-block", boxShadow: `0 0 0 3px ${vs.dot}20` }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", color: vs.text, opacity: 0.8 }}>AI REAL-TIME ADVICE</span>
              {tag && (
                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#fff", color: vs.text, border: `1px solid ${vs.border}` }}>
                  {vs.label}
                </span>
              )}
            </div>
            {tag && <div style={{ marginBottom: 4 }}><span style={{ fontSize: 20, fontWeight: 900, color: vs.text, letterSpacing: "-0.02em" }}>{tag}</span></div>}
            <p style={{ fontSize: 14, lineHeight: 1.4, color: vs.text, margin: 0, fontWeight: 600, whiteSpace: "pre-wrap" }}>{body || customerAdvice}</p>
            
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${vs.border}aa`, display: "flex", gap: 24 }}>
              <div>
                <span style={{ fontSize: 10, color: vs.text, opacity: 0.5, fontWeight: 700, marginRight: 6 }}>EMOTION:</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: vs.text }}>{dominantEmotion}</span>
              </div>
              <div>
                <span style={{ fontSize: 10, color: vs.text, opacity: 0.5, fontWeight: 700, marginRight: 6 }}>STATUS:</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: vs.text }}>{adviceStatus}</span>
              </div>
            </div>
          </div>

          {/* スコアメーター */}
          <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InterestCard label="表情関心度メーター" value={liveInterest} />
            <InterestCard label="声の熱量関心度メーター" value={voiceInterest} />
          </div>

          {/* タイムライン領域（個別スクロールカード） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, flex: 1, overflow: "hidden" }}>
            
            {/* 接客アドバイスログ */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "12px", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #f3f4f6", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#374151" }}>📋 接客判断ログ履歴</span>
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, background: "#f3f4f6", padding: "1px 5px", borderRadius: 4 }}>{adviceHistory.length} 件</span>
              </div>
              <div ref={logContainerRef} onScroll={handleLogScroll} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, paddingRight: 2 }}>
                {adviceHistory.length === 0 ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 11 }}>待機中...</div>
                ) : (
                  adviceHistory.map((log) => <AdviceLogItem key={log.id} log={log} />)
                )}
              </div>
            </div>

            {/* お客様の会話発言ログ */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "12px", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #f3f4f6", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#374151" }}>🗣️ 会話テキストログ（Whisper）</span>
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, background: "#f3f4f6", padding: "1px 5px", borderRadius: 4 }}>{speechHistory.length} 件</span>
              </div>
              <div ref={speechContainerRef} onScroll={handleSpeechScroll} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, paddingRight: 2 }}>
                {speechHistory.length === 0 ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 11 }}>音声を検知していません</div>
                ) : (
                  speechHistory.map((log) => <SpeechLogItem key={log.id} log={log} />)
                )}
              </div>
            </div>

          </div>
        </div>

        {/* 右側：ハードウェアモニター・映像カラム */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>

          {/* ビデオフィードカード */}
          <div style={{ flexShrink: 0, background: "#111827", borderRadius: 14, overflow: "hidden", position: "relative", aspectRatio: "4/3", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", border: "1px solid #1f2937" }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }} />
            <canvas ref={canvasRef} width={640} height={480} style={{ display: "none" }} />
            <canvas ref={faceMeshCanvasRef} width={640} height={480} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", transform: "scaleX(-1)" }} />
            <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(17,24,39,0.7)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "4px 10px", border: "1px solid rgba(255,255,255,0.1)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.02em" }}>🎯 {dominantEmotion}</span>
            </div>
          </div>

          {/* ディープラーニング感情マトリクス（全7感情フル展開） */}
          <div style={{ flex: 1, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", letterSpacing: "0.05em", marginBottom: 8, flexShrink: 0 }}>LIVE EMOTION DISTRIBUTION</div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, overflow: "hidden", gap: "calc((100% - 150px) / 7)" }}>
              {(["happy", "neutral", "sad", "angry", "surprise", "fear", "disgust"] as const).map((k) => {
                const score = emotionScores[k] ?? 0;
                return (
                  <div key={k} style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontSize: 11, color: "#4b5563", fontWeight: 600 }}>{EMOTION_LABELS[k]}</span>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: EMOTION_COLORS[k], fontWeight: 700 }}>{score.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 4, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${score}%`, background: EMOTION_COLORS[k], borderRadius: 99, transition: "width 0.3s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* オーディオウェーブフォーム */}
          <div style={{ flexShrink: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", letterSpacing: "0.05em", marginBottom: 6 }}>AUDIO WAVEFORM</div>
            <div style={{ background: "#f9fafb", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
              <canvas ref={audioCanvasRef} width={400} height={44} style={{ width: "100%", height: 44, display: "block" }} />
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}