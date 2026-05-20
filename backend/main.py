# backend/main.py
import asyncio
import base64
import time
import os

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel
from groq import Groq # ⭕️ 追加

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
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ⭕️ フロントからAPIキーも一緒に送られてくるようにスキーマを拡張
class AnalysisRequest(BaseModel):
    image: str
    audio: str = ""
    apiKey: str = "" # ⭕️ 追加

last_audio_data = ""
last_dominant_emotion = ""
current_customer_advice = "APIキーを入力すると、接客分析が開始されます。"
current_voice_interest = 0.0
current_voice_rms = 0.0
current_voice_pitch = 0.0
is_advice_generation_running = False

last_analysis_time = 0.0
cached_emotion_scores = {}
cached_current_emotion = "neutral"
cached_live_interest = 50.0

# ⭕️ 引数に user_api_key を追加して、リクエストごとにクライアントを生成する形に変更
async def generate_advice_background(audio_bytes, emotion_scores, current_emotion, user_api_key):
    global current_customer_advice, is_advice_generation_running
    try:
        if not user_api_key:
            current_customer_advice = "【設定エラー】\n画面右上の鍵マークからGroqのAPIキーを設定してください。"
            return

        # ⭕️ ユーザーが持参したAPIキーでその都度AIの脳みそを初期化
        temp_client = Groq(api_key=user_api_key)

        loop = asyncio.get_running_loop()
        # services.pyの関数を流用するため、第一引数をtemp_clientにするハック
        def run_with_custom_client():
            import services
            # 一時的にservices側のclientを上書きして実行
            old_client = services.client
            services.client = temp_client
            try:
                return generate_customer_advice(audio_bytes, emotion_scores, current_emotion)
            finally:
                services.client = old_client

        advice = await loop.run_in_executor(None, run_with_custom_client)
        current_customer_advice = advice
    except Exception as err:
        print(f"アドバイス生成エラー: {err}")
        if "rate_limit" in str(err).lower():
            current_customer_advice = "【判定: 制限到達】\n入力されたキーの1分間または1日の上限に達しました。少しお待ちください。"
        else:
            current_customer_advice = "【エラー】\nAPIキーが正しいか確認してください。"
    finally:
        is_advice_generation_running = False

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    global current_customer_advice, current_voice_interest, current_voice_pitch, current_voice_rms, last_audio_data, last_dominant_emotion, is_advice_generation_running
    global last_analysis_time, cached_emotion_scores, cached_current_emotion, cached_live_interest

    current_time = time.time()

    try:
        # 1. 顔画像処理 (キャッシュ防波堤)
        if current_time - last_analysis_time > 1.2:
            last_analysis_time = current_time

            _, encoded = data.image.split(",", 1)
            image_bytes = base64.b64decode(encoded)
            np_array = np.frombuffer(image_bytes, dtype=np.uint8)
            frame = cv2.imdecode(np_array, cv2.IMREAD_COLOR)

            if frame is not None:
                emotion_scores, current_emotion = analyze_face_and_emotion(frame)
                live_interest_pct = calculate_live_interest(emotion_scores)
                
                cached_emotion_scores = emotion_scores
                cached_current_emotion = current_emotion
                cached_live_interest = live_interest_pct
        else:
            emotion_scores = cached_emotion_scores if cached_emotion_scores else {"neutral": 100.0}
            current_emotion = cached_current_emotion
            live_interest_pct = cached_live_interest

        # APIキーがない場合は画像・音声スコアだけ返してAI推論はスキップ
        if not data.apiKey:
            current_customer_advice = "画面右上の鍵マーク 🔑 からGroqのAPIキーを設定してください。"
            return {
                "dominant_emotion": EMOTION_JP.get(current_emotion, current_emotion),
                "emotion_scores": emotion_scores,
                "live_interest": round(live_interest_pct, 0),
                "voice_interest": 0,
                "customer_advice": current_customer_advice,
                "advice_status": "APIキー未設定",
            }

        # 2. 音声処理 ＆ リアルタイム声の関心度計算
        if not data.audio:
            current_voice_interest = max(0.0, current_voice_interest - 10.0)
            current_voice_rms = 0.0
            current_voice_pitch = 0.0
            
            if not is_advice_generation_running and current_emotion != last_dominant_emotion:
                last_dominant_emotion = current_emotion
                last_audio_data = ""
                is_advice_generation_running = True
                asyncio.create_task(generate_advice_background(b"", emotion_scores, current_emotion, data.apiKey))
        
        elif data.audio != last_audio_data and not is_advice_generation_running:
            try:
                _, audio_encoded = data.audio.split(",", 1)
                audio_bytes = base64.b64decode(audio_encoded)

                if len(audio_bytes) > 10000:
                    voice_rms, voice_pitch = extract_audio_features(audio_bytes)
                    current_voice_rms = voice_rms
                    current_voice_pitch = voice_pitch
                    current_voice_interest = calculate_voice_interest(voice_rms, voice_pitch)
                    
                    last_audio_data = data.audio
                    last_dominant_emotion = current_emotion
                    is_advice_generation_running = True
                    asyncio.create_task(generate_advice_background(audio_bytes, emotion_scores, current_emotion, data.apiKey))
            except Exception as audio_err:
                print(f"音声処理失敗: {audio_err}")

        return {
            "dominant_emotion": EMOTION_JP.get(current_emotion, current_emotion),
            "emotion_scores": emotion_scores,
            "live_interest": round(live_interest_pct, 0),
            "voice_interest": round(current_voice_interest, 0),
            "voice_rms": round(current_voice_rms, 4),
            "voice_pitch": round(current_voice_pitch, 1),
            "customer_advice": current_customer_advice,
            "advice_status": "分析中" if is_advice_generation_running else "安定稼働中",
        }
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))