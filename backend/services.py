import io
import numpy as np
from scipy.io import wavfile
import librosa
import cv2
from deepface import DeepFace

# ---------------------------------------------------------------------------
# 感情マップ（英語キー → 日本語ラベル）
# ---------------------------------------------------------------------------
EMOTION_MAP = {
    "happy": "笑顔・好意的",
    "sad": "困惑・戸惑い",
    "angry": "不快・拒嫌",
    "surprise": "驚き・興味",
    "neutral": "真顔・冷静",
    "fear": "警戒",
    "disgust": "嫌悪",
}

# ---------------------------------------------------------------------------
# 顔・感情解析（DeepFace に完全回帰）
# ---------------------------------------------------------------------------

def analyze_face_emotion(frame: np.ndarray) -> tuple[dict, str]:
    try:
        # DeepFaceで感情分析を実行（検出器は軽量なOpenCVを使用）
        results = DeepFace.analyze(
            img_path=frame,
            actions=["emotion"],
            enforce_detection=False,
            detector_backend="opencv"
        )
        
        if not results:
            return {"neutral": 100.0}, "neutral"
            
        # DeepFaceは 0〜100 のパーセンテージでデータを返してくれます
        emotion_scores = results[0]["emotion"]
        
        # データのキーを標準化（DeepFaceのキーをそのまま使用）
        scaled = {k.lower(): float(v) for k, v in emotion_scores.items()}
        
        dominant = max(scaled, key=scaled.get)
        return scaled, dominant
        
    except Exception as exc:
        print(f"[DeepFace] 解析エラー: {exc}")
        return {"neutral": 100.0}, "neutral"


def calculate_live_interest(scores: dict) -> float:
    """
    全7感情のスコアをもとに関心度を 0〜100% でスコアリング。
    """
    happy    = scores.get("happy",   0.0) / 100.0
    surprise = scores.get("surprise",0.0) / 100.0
    angry    = scores.get("angry",   0.0) / 100.0
    fear     = scores.get("fear",    0.0) / 100.0
    disgust  = scores.get("disgust", 0.0) / 100.0

    raw = (
        50.0
        + (happy    * 50.0)
        + (surprise * 60.0)
        - (angry    * 50.0)
        - (fear     * 20.0)
        - (disgust  * 30.0)
    )
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
        f"Happy:{emotion_scores.get('happy',    0):.0f},"
        f"Neutral:{emotion_scores.get('neutral', 0):.0f},"
        f"Sad:{emotion_scores.get('sad',     0):.0f},"
        f"Angry:{emotion_scores.get('angry',   0):.0f},"
        f"Surprise:{emotion_scores.get('surprise',0):.0f},"
        f"Fear:{emotion_scores.get('fear',    0):.0f},"
        f"Disgust:{emotion_scores.get('disgust', 0):.0f},"
        f"Voice:{voice_status}"
    )


SYSTEM_PROMPT = (
    "You are a polite retail sales assistant AI. Analyze customer metrics at a cash register "
    "where the clerk just offered a smartphone/internet discount.\n"
    "You receive ALL 7 emotion scores (Happy/Neutral/Sad/Angry/Surprise/Fear/Disgust) "
    "plus voice activity. Use ALL of them holistically to judge the customer's intent.\n"
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