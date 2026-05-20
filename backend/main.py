import asyncio
import base64
import time
import os

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel
from groq import Groq

# ⭕️ インポートから感情マップの辞書を除外（競合を永久に封印）
from services import (
    analyze_face_and_emotion,
    calculate_live_interest,
    calculate_voice_interest,
    extract_audio_features,
    generate_customer_advice,
)

app = FastAPI(title="Customer Demand Analyzer")

# ローカル開発環境用にCORSを全面解放
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ⭕️ main.py 側で安全に感情マップを固定定義
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

def run_llm_inference(user_api_key, audio_bytes, emotion_scores, current_emotion):
    """別スレッドで安全にGroq APIを叩くための同期ラッパー関数"""
    try:
        temp_client = Groq(api_key=user_api_key)
        return generate_customer_advice(temp_client, audio_bytes, emotion_scores, current_emotion)
    except Exception as e:
        print(f"スレッド内LLM推論エラー: {e}")
        return "（AI分析中に一時的なエラーが発生しました。次のフレームで再試行します）"

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    current_time = time.time()

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
            emotion_scores, current_emotion = analyze_face_and_emotion(frame)
            live_interest_pct = calculate_live_interest(emotion_scores)
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
                    voice_rms, voice_pitch = extract_audio_features(audio_bytes_payload)
                    current_voice_rms = voice_rms
                    current_voice_pitch = voice_pitch
                    current_voice_interest = calculate_voice_interest(voice_rms, voice_pitch)
            except Exception as audio_err:
                print(f"音声特徴量抽出失敗: {audio_err}")

        # 3. 非同期（スレッドプール）でのLLM接客アドバイス生成
        loop = asyncio.get_running_loop()
        customer_advice = await loop.run_in_executor(
            None, 
            run_llm_inference, 
            local_api_key, 
            audio_bytes_payload, 
            emotion_scores, 
            current_emotion
        )

        # フロントエンドがアニメーション表示するための全パラメータをまとめて返却
        return {
            # ⭕️ インポートに頼らず、内部の強固なマップから安全に取得
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