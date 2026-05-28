import io
import numpy as np
from scipy.io import wavfile
import librosa
from deepface import DeepFace


# ---------------------------------------------------------------------------
# 感情マップ（英語キー → 日本語ラベル）
# ---------------------------------------------------------------------------
EMOTION_MAP = {
    "happy": "笑顔・好意的",
    "sad": "困惑・戸惑い",
    "angry": "不快・拒絶",
    "surprise": "驚き・興味",
    "neutral": "真顔・冷静",
    "fear": "警戒",
    "disgust": "嫌悪",
}

# ---------------------------------------------------------------------------
# 顔・感情解析
# ---------------------------------------------------------------------------

def analyze_face_emotion(frame: np.ndarray) -> tuple[dict, str]:
    try:
        result = DeepFace.analyze(
            frame,
            actions=["emotion"],
            enforce_detection=False,
            silent=True,
        )
        if isinstance(result, list):
            result = result[0]
        return result["emotion"], result["dominant_emotion"]
    except Exception as exc:
        print(f"[DeepFace] 解析エラー: {exc}")
        return {"neutral": 100.0}, "neutral"


def calculate_live_interest(scores: dict) -> float:
    """
    顧客の関心度を 0〜100% でスコアリングする。

    DeepFace の各感情スコアは 0〜100 の値（合計が概ね100になる割合）であるため、
    加算前に 0.0〜1.0 の比率へ正規化し、係数を乗じることで
    結果が 0〜100% の範囲に収まるよう設計している。

    重み付けの根拠（レジ前でのディスカウント提案を想定）:
    - 基準値: 50%（真顔・ニュートラルな状態）
    - 驚き (surprise × 0.60): 提案へのフックを示す最重要シグナルとして最高係数
    - 笑顔  (happy   × 0.50): 好意的な受容を示すが、驚きより控えめに評価
    - 不快  (angry   × 0.50): 拒絶・クレームリスクとして減点

    理論上の範囲:
    - 上限: 50 + (1.0 × 50) + (1.0 × 60) − 0        = 160（クリップ → 100）
    - 下限: 50 + 0           + 0           − (1.0 × 50) =   0（クリップ →   0）
    各係数の入力は 0.0〜1.0 に正規化済みのため、
    surprise が 100% なら +60、happy が 100% なら +50、angry が 100% なら −50 となる。
    max/min で [0, 100] にクリッピングして安全性を担保。
    """
    happy   = scores.get("happy", 0.0)   / 100.0
    surprise = scores.get("surprise", 0.0) / 100.0
    angry   = scores.get("angry", 0.0)   / 100.0

    raw = 50.0 + (happy * 50.0) + (surprise * 60.0) - (angry * 50.0)
    return max(0.0, min(100.0, raw))


# ---------------------------------------------------------------------------
# 音声特徴量抽出
# ---------------------------------------------------------------------------

def extract_audio_features(audio_bytes: bytes) -> tuple[float, float]:
    try:
        samplerate, data = wavfile.read(io.BytesIO(audio_bytes))
        if data.dtype == np.int16:
            data = data.astype(np.float32) / 32768.0
        elif data.dtype == np.int32:
            data = data.astype(np.float32) / 2147483648.0
        else:
            data = data.astype(np.float32)
        if data.ndim > 1:
            data = np.mean(data, axis=1)
        mean_rms = float(np.mean(librosa.feature.rms(y=data)))
        pitches, _ = librosa.piptrack(y=data, sr=samplerate)
        valid_pitches = pitches[pitches > 0]
        mean_pitch = float(np.mean(valid_pitches)) if valid_pitches.size > 0 else 0.0
        return mean_rms, mean_pitch
    except Exception as exc:
        print(f"[Audio] 特徴量抽出エラー: {exc}")
        return 0.0, 0.0


def calculate_voice_interest(mean_rms: float, mean_pitch: float) -> float:
    volume_score = min(60.0, max(0.0, mean_rms / 0.05 * 60.0))
    pitch_score = (
        min(40.0, max(0.0, (mean_pitch - 100.0) / 180.0 * 40.0))
        if mean_pitch > 0
        else 0.0
    )
    return max(0.0, min(100.0, volume_score + pitch_score))


# ---------------------------------------------------------------------------
# LLM 推論（Groq / Llama 3.3）
# ---------------------------------------------------------------------------

def build_metrics_summary(
    emotion_scores: dict,
    current_emotion: str,
    audio_bytes: bytes,
) -> str:
    voice_status = "silent"
    if audio_bytes:
        rms, pitch = extract_audio_features(audio_bytes)
        if rms >= 0.005:
            voice_status = f"talking(RMS:{rms:.3f},Pitch:{pitch:.0f}Hz)"
    return (
        f"FaceMain:{current_emotion},"
        f"H:{emotion_scores.get('happy', 0):.0f},"
        f"N:{emotion_scores.get('neutral', 0):.0f},"
        f"S:{emotion_scores.get('sad', 0):.0f},"
        f"A:{emotion_scores.get('angry', 0):.0f},"
        f"Surp:{emotion_scores.get('surprise', 0):.0f},"
        f"Voice:{voice_status}"
    )


SYSTEM_PROMPT = (
    "You are a polite retail sales assistant AI. Analyze customer metrics at a cash register "
    "where the clerk just offered a smartphone/internet discount.\n"
    "Output exactly 2 lines in Japanese (Desu/Masu form). No markdown, no notes.\n"
    "Line 1: 【判断: <脈あり(前向きにご興味ありです) or 脈なし(次の案内は不要のご様子です) "
    "or 様子見(冷静にご検討中されています)>】\n"
    "Line 2: One concrete next action for the clerk within 30 Japanese characters."
)

FALLBACK_MESSAGE = "（AIがお客様の関心度を分析しております...）"


def generate_customer_advice(
    groq_client,
    audio_bytes: bytes,
    emotion_scores: dict,
    dominant_emotion_en: str,
) -> str:
    if groq_client is None:
        return "【システムエラー】\nGroq APIキーが設定されていません。"

    metrics = build_metrics_summary(emotion_scores, dominant_emotion_en, audio_bytes)

    try:
        response = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": metrics},
            ],
            model="llama-3.3-70b-versatile",
            max_tokens=80,
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        print(f"[Groq] API エラー: {exc}")
        return FALLBACK_MESSAGE