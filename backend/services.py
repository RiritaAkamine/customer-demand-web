# backend/services.py
import io
import os
import numpy as np
import librosa
from scipy.io import wavfile
from deepface import DeepFace
from groq import Groq

EMOTION_JP = {
    "happy": "笑顔・好意的",
    "sad": "困惑・戸惑い",
    "angry": "不快・拒絶",
    "surprise": "驚き・興味",
    "neutral": "真顔・冷静",
    "fear": "警戒",
    "disgust": "嫌悪",
}

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

def calculate_live_interest(scores):
    happy = scores.get("happy", 0)
    surprise = scores.get("surprise", 0)
    angry = scores.get("angry", 0)
    return max(0.0, min(100.0, 50.0 + (happy * 1.0) + (surprise * 1.2) - (angry * 1.0)))

def analyze_face_and_emotion(frame):
    result = DeepFace.analyze(frame, actions=["emotion"], enforce_detection=False, silent=True)
    if isinstance(result, list):
        result = result[0]
    return result["emotion"], result["dominant_emotion"]

def calculate_voice_interest(mean_rms, mean_pitch):
    volume_score = min(60.0, max(0.0, mean_rms / 0.05 * 60.0))
    pitch_score = min(40.0, max(0.0, (mean_pitch - 100.0) / 180.0 * 40.0)) if mean_pitch > 0 else 0.0
    return max(0.0, min(100.0, volume_score + pitch_score))

def extract_audio_features(audio_bytes):
    audio_file = io.BytesIO(audio_bytes)
    samplerate, data = wavfile.read(audio_file)

    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float32) / 2147483648.0
    else:
        data = data.astype(np.float32)

    if len(data.shape) > 1:
        data = np.mean(data, axis=1)

    rms = librosa.feature.rms(y=data)[0]
    mean_rms = float(np.mean(rms)) if len(rms) > 0 else 0.0

    pitches, _ = librosa.piptrack(y=data, sr=samplerate)
    valid_pitches = pitches[pitches > 0]
    mean_pitch = float(np.mean(valid_pitches)) if len(valid_pitches) > 0 else 0.0

    return mean_rms, mean_pitch

def generate_customer_advice(audio_bytes, emotion_scores, dominant_emotion_en):
    """【極限トークン節約版】データを英語で最小化し、日本語のですます調で2行出力させます"""
    voice_status = "silent"
    if audio_bytes:
        try:
            mean_rms, mean_pitch = extract_audio_features(audio_bytes)
            if mean_rms >= 0.005:
                voice_status = f"talking(RMS:{mean_rms:.3f},Pitch:{mean_pitch:.0f}Hz)"
        except:
            pass

    # トークン削減のため、生データをコンパクトな文字列に圧縮
    metrics_summary = (
        f"FaceMain:{dominant_emotion_en},"
        f"H:{emotion_scores.get('happy',0):.0f},"
        f"N:{emotion_scores.get('neutral',0):.0f},"
        f"S:{emotion_scores.get('sad',0):.0f},"
        f"A:{emotion_scores.get('angry',0):.0f},"
        f"Surp:{emotion_scores.get('surprise',0):.0f},"
        f"Voice:{voice_status}"
    )

    # システム指示も英語にしてトークンを限界まで節約
    system_prompt = (
        "You are a polite retail sales assistant AI. Analyze customer metrics at a cash register "
        "where the clerk just offered a smartphone/internet discount.\n"
        "Output exactly 2 lines in Japanese (Desu/Masu form). No markdown, no notes.\n"
        "Line 1: 【判断: <脈あり(前向きにご興味ありです) or 脈なし(次の案内は不要のご様子です) or 様子見(冷静にご検討中されています)>】\n"
        "Line 2: One concrete next action for the clerk within 30 Japanese characters."
    )

    if client is None:
        return "【システムエラー】\nGroqのAPIキーがセットされていません。"

    try:
        response = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": metrics_summary},
            ],
            model="llama-3.3-70b-versatile",
            max_tokens=80, # 出力バッファも絞って高速化
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()
    except Exception as err:
        print(f"Groq API分析エラー: {err}")
        return "（ただいまAIがお客様の関心度を慎重に分析しております...）"