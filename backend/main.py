import asyncio
import base64
import os

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel

from services import (
    EMOTION_MAP,
    analyze_face_emotion,
    calculate_live_interest,
    extract_audio_features,
    calculate_voice_interest,
    generate_customer_advice,
)

app = FastAPI(title="Customer Demand Analyzer [BYOK Production Mode]")

# 本番仕様のCORS制限
ALLOWED_ORIGINS = [
    "https://customer-demand-web.vercel.app",        # あなたのVercel本番URL（後ほど作成）
    "http://localhost:3000",                          # ローカルテスト用
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ⭕️ フロントからユーザー独自のAPIキー（apiKey）を受け取れるように構造体を拡張
class AnalysisRequest(BaseModel):
    image: str
    audio: str = ""
    apiKey: str = ""  # 👈 ユーザー持参のキーを格納する箱


# ---------------------------------------------------------------------------
# ヘルスチェック (Renderの起動・生存確認用)
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    return {"status": "ok", "environment": "production_byok"}


# ---------------------------------------------------------------------------
# 顧客分析エンドポイント
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    # 【セキュリティ＆BYOK設計】
    # フロントからリクエストごとに送信されたキーを最優先で処理に使用します（サーバーに永続保存しない）。
    # もしフロントからの入力が空の場合は、Renderの環境変数（金庫）から取得する柔軟なハイブリッド設計。
    api_key = data.apiKey or os.environ.get("GROQ_API_KEY")
    
    if not api_key:
        return {
            "dominant_emotion": "未始動",
            "emotion_scores": {},
            "live_interest": 50,
            "voice_interest": 0,
            "voice_rms": 0.0,
            "voice_pitch": 0.0,
            "customer_advice": (
                "【認証エラー】\n"
                "画面上部の「Groq API Key」フォームにあなたのAPIキーを入力するか、\n"
                "Renderの環境変数にキーを設定してください。"
            ),
            "advice_status": "APIキー未設定",
        }

    try:
        # 1. 顔画像デコード・感情解析
        _, encoded = data.image.split(",", 1)
        np_array = np.frombuffer(base64.b64decode(encoded), dtype=np.uint8)
        frame = cv2.imdecode(np_array, cv2.IMREAD_COLOR)

        if frame is not None:
            emotion_scores, current_emotion = analyze_face_emotion(frame)
            live_interest_pct = calculate_live_interest(emotion_scores)
        else:
            emotion_scores = {
                "neutral": 100.0, "happy": 0.0, "sad": 0.0,
                "angry": 0.0, "surprise": 0.0,
            }
            current_emotion = "neutral"
            live_interest_pct = 50.0

        # 2. 音声特徴量解析
        audio_bytes = b""
        voice_interest = 0.0
        voice_rms = 0.0
        voice_pitch = 0.0

        if data.audio:
            try:
                _, audio_encoded = data.audio.split(",", 1)
                audio_bytes = base64.b64decode(audio_encoded)

                if len(audio_bytes) > 10_000:
                    voice_rms, voice_pitch = extract_audio_features(audio_bytes)
                    voice_interest = calculate_voice_interest(voice_rms, voice_pitch)
            except Exception as audio_exc:
                print(f"[Audio] デコードエラー: {audio_exc}")

        # 3. LLM 接客アドバイス生成（スレッドプール非同期）
        # ユーザーから渡された個別のAPIキーを用いてインスタンスを動的生成し、マルチユーザー間でのデータ衝突を防止。
        groq_client = Groq(api_key=api_key)

        loop = asyncio.get_running_loop()
        customer_advice = await loop.run_in_executor(
            None,
            generate_customer_advice,
            groq_client,
            audio_bytes,
            emotion_scores,
            current_emotion,
        )

        return {
            "dominant_emotion": EMOTION_MAP.get(current_emotion, current_emotion),
            "emotion_scores": {k: float(v) for k, v in emotion_scores.items()},
            "live_interest": round(float(live_interest_pct)),
            "voice_interest": round(float(voice_interest)),
            "voice_rms": float(voice_rms),
            "voice_pitch": float(voice_pitch),
            "customer_advice": customer_advice,
            "advice_status": "安定稼働中",
        }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))