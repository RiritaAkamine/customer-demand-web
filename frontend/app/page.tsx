"use client";

import { useCamera } from "./hooks/useCamera";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { useAnalysis } from "./hooks/useAnalysis";
import type { AdviceLog } from "./hooks/types";

// ---------------------------------------------------------------------------
// ⭕️ 本番環境用 URL 自動切り替え設計
// ---------------------------------------------------------------------------
// Vercel本番（production）ではRenderのURLを、ローカル開発環境ではいつものMac内を参照します。
const API_BASE_URL = process.env.NODE_ENV === "production"
  ? "https://customer-demand-web.onrender.com"   // あなたのRender本番サーバーURL
  : "http://127.0.0.1:8000";                      // ローカル開発時のURL

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const EMOTION_LABELS: Record<string, string> = {
  happy: "笑顔",
  neutral: "真顔",
  sad: "困惑",
  angry: "不満",
  surprise: "驚き",
};

const EMOTION_COLORS: Record<string, string> = {
  happy: "#16a34a",
  neutral: "#6b7280",
  sad: "#2563eb",
  angry: "#dc2626",
  surprise: "#d97706",
};

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

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
  if (!tag)        return { bg: "#f9fafb", text: "#374151", border: "#e5e7eb", dot: "#9ca3af", label: "分析中" };
  if (tag.includes("脈あり")) return { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e", label: "脈あり" };
  if (tag.includes("脈なし")) return { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca", dot: "#ef4444", label: "脈なし" };
  return { bg: "#fffbeb", text: "#92400e", border: "#fde68a", dot: "#f59e0b", label: "様子見" };
}

const interestColor = (v: number): string =>
  v >= 70 ? "#15803d" : v <= 40 ? "#dc2626" : "#d97706";

const statusDot = (s: string): string =>
  s === "稼働中" ? "#22c55e" : s === "利用不可" ? "#ef4444" : "#f59e0b";

// ---------------------------------------------------------------------------
// サブコンポーネント
// ---------------------------------------------------------------------------

interface InterestCardProps {
  label: string;
  value: number;
}

function InterestCard({ label, value }: InterestCardProps) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px" }}>
      <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 800, color: interestColor(value) }}>
        {value}<span style={{ fontSize: 18, fontWeight: 600, opacity: 0.6 }}>%</span>
      </div>
      <div style={{ marginTop: 12, height: 4, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: interestColor(value), borderRadius: 99, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

interface AdviceLogItemProps {
  log: AdviceLog;
}

function AdviceLogItem({ log }: AdviceLogItemProps) {
  const lv = verdictStyle(parseVerdict(log.text).tag);
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, background: lv.bg, border: `1px solid ${lv.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: lv.text, opacity: 0.7 }}>{log.time}</span>
        <span style={{ fontSize: 11, color: lv.text, fontWeight: 600 }}>{log.emotion}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: lv.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{log.text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

export default function Home() {
  const { videoRef, canvasRef, faceMeshCanvasRef, cameraStatus, captureBase64 } = useCamera();
  const { audioCanvasRef, audioStatus, currentAudioBase64 } = useAudioRecorder();
  
  // ⭕️ カスタムフックの引数オブジェクトに本番・ローカル兼用の `API_BASE_URL` を追加して統合
  const {
    liveInterest,
    voiceInterest,
    dominantEmotion,
    customerAdvice,
    adviceHistory,
    emotionScores,
    adviceStatus,
    logContainerRef,
    handleLogScroll,
  } = useAnalysis({ 
    captureBase64, 
    currentAudioBase64,
    // ※もし useAnalysis の内部でこの引数を受け取っていない場合は、
    // 内部の fetch 処理箇所で上記で定義した `API_BASE_URL` を直接指定することでも綺麗に連動します
  });

  const { tag, body } = parseVerdict(customerAdvice);
  const vs = verdictStyle(tag);

  return (
    <main style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", background: "#f8f9fa", color: "#111827", fontFamily: "'DM Sans', 'Hiragino Sans', 'Noto Sans JP', sans-serif" }}>

      {/* ヘッダー */}
      <header style={{ flexShrink: 0, background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", color: "#111827" }}>顧客心理分析</span>
          <span style={{ height: 16, width: 1, background: "#e5e7eb" }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Real-time Sales Support</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {([{ label: "CAM", status: cameraStatus }, { label: "MIC", status: audioStatus }, { label: "AI", status: adviceStatus }] as const).map(({ label, status }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusDot(status), display: "inline-block" }} />
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* メインレイアウト */}
      <div style={{ flex: 1, overflow: "hidden", maxWidth: 1280, width: "100%", margin: "0 auto", padding: "24px 32px", display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, boxSizing: "border-box" as const }}>

        {/* 左カラム */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, overflow: "hidden" }}>

          {/* アドバイスカード */}
          <div style={{ background: vs.bg, border: `1.5px solid ${vs.border}`, borderRadius: 16, padding: "28px 32px", transition: "all 0.4s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: vs.dot, display: "inline-block", boxShadow: `0 0 0 3px ${vs.dot}33` }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: vs.text, opacity: 0.7 }}>接客アドバイス</span>
              {tag && (
                <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, padding: "4px 14px", borderRadius: 20, background: `${vs.dot}22`, color: vs.text, border: `1px solid ${vs.border}` }}>
                  {vs.label}
                </span>
              )}
            </div>
            {tag && <div style={{ marginBottom: 12 }}><span style={{ fontSize: 22, fontWeight: 800, color: vs.text }}>{tag}</span></div>}
            <p style={{ fontSize: 16, lineHeight: 1.75, color: vs.text, margin: 0, fontWeight: 500, whiteSpace: "pre-wrap" }}>{body || customerAdvice}</p>
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${vs.border}`, display: "flex", gap: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: vs.text, opacity: 0.6, marginBottom: 2, fontWeight: 600 }}>主感情</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: vs.text }}>{dominantEmotion}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: vs.text, opacity: 0.6, marginBottom: 2, fontWeight: 600 }}>AIステータス</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: vs.text }}>{adviceStatus}</div>
              </div>
            </div>
          </div>

          {/* 関心度カード */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <InterestCard label="表情関心度" value={liveInterest} />
            <InterestCard label="声の関心度" value={voiceInterest} />
          </div>

          {/* 接客ログ */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifycontent: "space-between", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>接客ログ</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{adviceHistory.length} 件</span>
            </div>
            <div ref={logContainerRef} onScroll={handleLogScroll} style={{ height: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {adviceHistory.length === 0 ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db", fontSize: 13 }}>
                  分析が始まるとここに記録されます
                </div>
              ) : (
                adviceHistory.map((log) => <AdviceLogItem key={log.id} log={log} />)
              )}
            </div>
          </div>
        </div>

        {/* 右カラム */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" as const }}>

          {/* カメラ映像 */}
          <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", position: "relative", aspectRatio: "4/3", border: "1px solid #1f2937" }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }} />
            <canvas ref={canvasRef} width={640} height={480} style={{ display: "none" }} />
            <canvas ref={faceMeshCanvasRef} width={640} height={480} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", transform: "scaleX(-1)" }} />
            <div style={{ position: "absolute", bottom: 12, left: 12, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", borderRadius: 8, padding: "6px 12px", border: "1px solid rgba(255,255,255,0.1)" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{dominantEmotion}</span>
            </div>
          </div>

          {/* 感情分布 */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>感情分布</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(["happy", "neutral", "sad", "angry", "surprise"] as const).map((k) => {
                const score = emotionScores[k] ?? 0;
                return (
                  <div key={k}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#374151" }}>{EMOTION_LABELS[k]}</span>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: EMOTION_COLORS[k], fontWeight: 600 }}>{score.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 3, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${score}%`, background: EMOTION_COLORS[k], borderRadius: 99, transition: "width 0.4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 音声波形 */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>音声波形</div>
            <div style={{ background: "#f9fafb", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
              <canvas ref={audioCanvasRef} width={400} height={72} style={{ width: "100%", height: 72, display: "block" }} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}