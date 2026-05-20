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

from services import (
    EMOTION_JP,
    analyze_face_and_emotion,
    calculate_live_interest,
    calculate_voice_interest,
    extract_audio_features,
    generate_customer_advice,
)

app = FastAPI(title="Customer Demand Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalysisRequest(BaseModel):
    image: str
    audio: str = ""

# ⭕️ 改善：グローバル状態管理を撤廃し、完全にリクエスト内のスコープで処理を実行。
# 同時並行リクエストが発生しても、ユーザー間でデータが混ざるリスクを100%排除しました。

def run_llm_inference(user_api_key, audio_bytes, emotion_scores, current_emotion):
    """別スレッドで安全にGroq APIを叩くための同期ラッパー関数"""
    try:
        # スレッドごとに独立したGroqクライアントを生成
        temp_client = Groq(api_key=user_api_key)
        # services.pyに明示的にclientを引数で渡すように修正（clientの奪い合いを防止）
        return generate_customer_advice(temp_client, audio_bytes, emotion_scores, current_emotion)
    except Exception as e:
        print(f"スレッド内LLM推論エラー: {e}")
        return "（AI分析中に一時的なエラーが発生しました。次のフレームで再試行します）"

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    current_time = time.time()

    # ⭕️ ローカル開発時は環境変数からAPIキーを取得
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

        # 2. 音声特徴量解析
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

        # 3. ⭕️ 非同期（スレッドプール）でのLLM接客アドバイス生成
        # グローバルなロック変数を廃止し、独立したタスクとしてExecutor上で安全に並行実行します。
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
            "dominant_emotion": EMOTION_JP.get(current_emotion, current_emotion),
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