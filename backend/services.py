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
# 顔・感情解析（DeepFace）
# ---------------------------------------------------------------------------
def analyze_face_emotion(frame: np.ndarray) -> tuple[dict, str]:
    try:
        results = DeepFace.analyze(
            img_path=frame,
            actions=["emotion"],
            enforce_detection=False,
            detector_backend="opencv"
        )
        if not results:
            return {"neutral": 100.0}, "neutral"
            
        emotion_scores = results[0]["emotion"]
        scaled = {k.lower(): float(v) for k, v in emotion_scores.items()}
        dominant = max(scaled, key=scaled.get)
        return scaled, dominant
    except Exception as exc:
        print(f"[DeepFace] 解析エラー: {exc}")
        return {"neutral": 100.0}, "neutral"

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

# ---------------------------------------------------------------------------
# Groq Whisper による文字起こし処理
# ---------------------------------------------------------------------------
def transcribe_audio_with_whisper(groq_client, audio_bytes: bytes) -> str:
    """音声バイナリからGroq APIを使って文字起こしを行う"""
    if not audio_bytes or groq_client is None:
        return ""
    try:
        # メモリ上のバイナリデータをファイルオブジェクトとして模倣
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = "input.wav"  # Groqが拡張子を判別するために必要

        translation = groq_client.audio.transcriptions.create(
            file=audio_file,
            model="whisper-large-v3",
            language="ja",
            response_format="text"
        )
        return translation.strip()
    except Exception as exc:
        print(f"[Whisper] 文字起こしエラー: {exc}")
        return ""

# ---------------------------------------------------------------------------
# LLM 推論（Groq / Llama 3.3）統合ロジック
# ---------------------------------------------------------------------------
def build_metrics_summary(
    emotion_scores: dict,
    current_emotion: str,
    rms: float,
    pitch: float,
    transcription: str
) -> str:
    """生データと文字起こし文を統合したプロンプト用テキストを生成"""
    voice_status = "silent"
    if rms >= 0.005:
        voice_status = f"talking(RMS:{rms:.4f},Pitch:{pitch:.0f}Hz)"
        
    return (
        f"FaceMain:{current_emotion},"
        f"Happy:{emotion_scores.get('happy',    0):.1f}%,"
        f"Neutral:{emotion_scores.get('neutral', 0):.1f}%,"
        f"Sad:{emotion_scores.get('sad',     0):.1f}%,"
        f"Angry:{emotion_scores.get('angry',   0):.1f}%,"
        f"Surprise:{emotion_scores.get('surprise',0):.1f}%,"
        f"Fear:{emotion_scores.get('fear',    0):.1f}%,"
        f"Disgust:{emotion_scores.get('disgust', 0):.1f}%,\n"
        f"VoiceMetrics:{voice_status},\n"
        f"CustomerSpeech:\"{transcription}\""  # 喋った内容をここに注入！
    )

SYSTEM_PROMPT = (
    "You are a polite retail sales assistant AI. Analyze customer metrics at a cash register.\n"
    "Based on the 7 emotion scores, voice activity, and CustomerSpeech (transcription text), calculate 'Face Interest' (0 to 100) and 'Voice Interest' (0 to 100) holistically.\n"
    "Then judge the total intent as '脈あり', '脈なし', or '様子見'.\n"
    "Output exactly 4 lines in Japanese. No markdown, no notes, no extra letters.\n"
    "Line 1: <Only output an integer between 0 and 100 for Face Interest, e.g., 75>\n"
    "Line 2: <Only output an integer between 0 and 100 for Voice Interest, e.g., 40>\n"
    "Line 3: 【判断: <脈あり(前向きにご興味ありです) or 脈なし(次の案内は不要のご様子です) or 様子見(冷静にご検討中されています)>】\n"
    "Line 4: One concrete next action for the clerk within 30 Japanese characters."
)

def generate_customer_advice_from_ai(
    groq_client,
    audio_bytes: bytes,
    emotion_scores: dict,
    dominant_emotion_en: str,
) -> tuple[float, float, str, str, str]:
    """文字起こしを挟み、AIに出力させてパースする。戻り値の最後にテキストを含める"""
    if groq_client is None:
        return 50.0, 0.0, "【エラー】", "Groq APIキーが設定されていません。", ""

    # 1. 音声特徴量と文字起こしを並行して取得
    rms, pitch = 0.0, 0.0
    if audio_bytes:
        rms, pitch = extract_audio_features(audio_bytes)
    
    transcription = ""
    if rms >= 0.005:  # 一定以上の音量がある場合のみ文字起こしを実行
        transcription = transcribe_audio_with_whisper(groq_client, audio_bytes)

    # 2. 通信簿テキストの組み上げ
    metrics = build_metrics_summary(emotion_scores, dominant_emotion_en, rms, pitch, transcription)

    try:
        response = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": metrics},
            ],
            model="llama-3.3-70b-versatile",
            max_tokens=150,
            temperature=0.2,
        )
        
        lines = [line.strip() for line in response.choices[0].message.content.strip().split("\n") if line.strip()]
        
        if len(lines) < 4:
            return 50.0, 0.0, "【様子見】", "お客様の様子を観察しながら、対応を続けましょう。", transcription

        face_interest = float(lines[0]) if lines[0].isdigit() else 50.0
        voice_interest = float(lines[1]) if lines[1].isdigit() else 0.0
        judgment = lines[2]
        advice = lines[3]

        return face_interest, voice_interest, judgment, advice, transcription

    except Exception as exc:
        print(f"[Groq/Parser] エラー: {exc}")
        return 50.0, 0.0, "【様子見】", "（AIがお客様の関心度を分析しております...）", transcription