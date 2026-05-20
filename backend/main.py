import asyncio
import base64
import time
import os
import io

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel
from scipy.io import wavfile
import librosa
from deepface import DeepFace
from groq import Groq

app = FastAPI(title="Customer Demand Analyzer")

# ローカル開発環境用にCORSを全面解放
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 感情マップの日本語定義
LOCAL_EMOTION_MAP = {
    "happy": "笑顔・好意的",
    "sad": "困惑・戸惑い",
    "angry": "不快・拒絶",
    "surprise": "驚き・興味",
    "neutral": "真顔・冷静",
    "fear": "警戒",
    "disgust": "嫌悪",
}

class AnalysisRequest(BaseModel):
    image: str
    audio: str = ""

# --- 内部解析ロジック群（services.pyに依存せず自己完結） ---

def local_analyze_face_and_emotion(frame):
    """顔画像から感情スコアと主感情を抽出"""
    try:
        result = DeepFace.analyze(frame, actions=["emotion"], enforce_detection=False, silent=True)
        if isinstance(result, list):
            result = result[0]
        return result["emotion"], result["dominant_emotion"]
    except Exception as e:
        print(f"DeepFaceエラー: {e}")
        return {"neutral": 100.0}, "neutral"

def local_calculate_live_interest(scores):
    """感情分布から顧客の総合関心度を計算"""
    happy = scores.get("happy", 0)
    surprise = scores.get("surprise", 0)
    angry = scores.get("angry", 0)
    return max(0.0, min(100.0, 50.0 + (happy * 1.0) + (surprise * 1.2) - (angry * 1.0)))

def local_extract_audio_features(audio_bytes):
    """音声バイナリからRMS（音量）とピッチ（高さ）を抽出"""
    try:
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
    except Exception as e:
        print(f"音声特徴量抽出エラー: {e}")
        return 0.0, 0.0

def local_calculate_voice_interest(mean_rms, mean_pitch):
    """声のトーンから関心度を計算"""
    volume_score = min(60.0, max(0.0, mean_rms / 0.05 * 60.0))
    pitch_score = min(40.0, max(0.0, (mean_pitch - 100.0) / 180.0 * 40.0)) if mean_pitch > 0 else 0.0
    return max(0.0, min(100.0, volume_score + pitch_score))

def run_llm_inference(user_api_key, audio_bytes, emotion_scores, current_emotion):
    """独立したGroqクライアントを生成し、スレッドセーフにLLM推論を実行"""
    try:
        client = Groq(api_key=user_api_key)
        
        voice_status = "silent"
        if audio_bytes:
            mean_rms, mean_pitch = local_extract_audio_features(audio_bytes)
            if mean_rms >= 0.005:
                voice_status = f"talking(RMS:{mean_rms:.3f},Pitch:{mean_pitch:.0f}Hz)"

        metrics_summary = (
            f"FaceMain:{current_emotion},"
            f"H:{emotion_scores.get('happy',0):.0f},"
            f"N:{emotion_scores.get('neutral',0):.0f},"
            f"S:{emotion_scores.get('sad',0):.0f},"
            f"A:{emotion_scores.get('angry',0):.0f},"
            f"Surp:{emotion_scores.get('surprise',0):.0f},"
            f"Voice:{voice_status}"
        )

        system_prompt = (
            "You are a polite retail sales assistant AI. Analyze customer metrics at a cash register "
            "where the clerk just offered a smartphone/internet discount.\n"
            "Output exactly 2 lines in Japanese (Desu/Masu form). No markdown, no notes.\n"
            "Line 1: 【判断: <脈あり(前向きにご興味ありです) or 脈なし(次の案内は不要のご様子です) or 様子見(冷静にご検討中されています)>】\n"
            "Line 2: One concrete next action for the clerk within 30 Japanese characters."
        )

        response = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": metrics_summary},
            ],
            model="llama-3.3-70b-versatile",
            max_tokens=80,
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq APIエラー: {e}")
        return "（AIが音声波長と表情から次の接客アクションを構築中...）"

# --- API エンドポイント ---

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    local_api_key = os.environ.get("GROQ_API_KEY")
    if not local_api_key:
        return {
            "dominant_emotion": "未始動",
            "emotion_scores": {},
            "live_interest": 50,
            "voice_interest": 0,
            "voice_rms": 0.0,
            "voice_pitch": 0.0,
            "customer_advice": "【設定エラー】\nMacのターミナルで export GROQ_API_KEY='キー' を設定して再起動してください。",
            "advice_status": "APIキー未設定"
        }

    try:
        # 1. 顔画像処理
        _, encoded = data.image.split(",", 1)
        image_bytes = base64.b64decode(encoded)
        np_array = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_array, cv2.IMREAD_COLOR)

        if frame is not None:
            emotion_scores, current_emotion = local_analyze_face_and_emotion(frame)
            live_interest_pct = local_calculate_live_interest(emotion_scores)
        else:
            emotion_scores = {"neutral": 100.0, "happy": 0.0, "sad": 0.0, "angry": 0.0, "surprise": 0.0}
            current_emotion = "neutral"
            live_interest_pct = 50.0

        # 2. リアルタイム音声特徴量解析
        current_voice_interest = 0.0
        current_voice_rms = 0.0
        current_voice_pitch = 0.0
        audio_bytes_payload = b""

        if data.audio:
            try:
                _, audio_encoded = data.audio.split(",", 1)
                audio_bytes_payload = base64.b64decode(audio_encoded)

                if len(audio_bytes_payload) > 10000:
                    voice_rms, voice_pitch = local_extract_audio_features(audio_bytes_payload)
                    current_voice_rms = voice_rms
                    current_voice_pitch = voice_pitch
                    current_voice_interest = local_calculate_voice_interest(voice_rms, voice_pitch)
            except Exception as audio_err:
                print(f"音声特徴量抽出失敗: {audio_err}")

        # 3. 非同期スレッドプールでのLLM接客アドバイス生成（完全並行リクエスト対応）
        loop = asyncio.get_running_loop()
        customer_advice = await loop.run_in_executor(
            None, 
            run_llm_inference, 
            local_api_key, 
            audio_bytes_payload, 
            emotion_scores, 
            current_emotion
        )

        return {
            "dominant_emotion": LOCAL_EMOTION_MAP.get(current_emotion, current_emotion),
            "emotion_scores": emotion_scores,
            "live_interest": round(live_interest_pct, 0),
            "voice_interest": round(current_voice_interest, 0),
            "voice_rms": float(current_voice_rms),
            "voice_pitch": float(current_voice_pitch),
            "customer_advice": customer_advice,
            "advice_status": "安定稼働中",
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))