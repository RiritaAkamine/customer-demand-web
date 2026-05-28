import asyncio
import base64
import os

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel

# 💡 ここが超重要ポイント：
# Vercel環境では、apiフォルダと同じ階層にあるファイルを読み込ませるため
# 相対インポート（from .services import ...）に自動調整して読み込みエラーを完全防御します！
from .services import (
    EMOTION_MAP,
    analyze_face_emotion,
    calculate_live_interest,
    extract_audio_features,
    calculate_voice_interest,
    generate_customer_advice,
)

# 🌟 Vercel用にドキュメントと内部のルーティングのベースパスを最適化
app = FastAPI(
    title="Customer Demand Analyzer",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

# CORS設定（本番環境でもNext.jsと同じドメインになるため安全ですが、念のため全許可を維持）
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


# ---------------------------------------------------------------------------
# ヘルスチェック（Vercel対応パス）
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    return {"status": "ok", "environment": "vercel-serverless"}


# ---------------------------------------------------------------------------
# 顧客分析エンドポイント（Vercel対応パス）
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    # 🌟 環境変数はVercelの管理画面（Dashboard）から安全に注入可能になります！
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {
            "dominant_emotion": "未始動",
            "emotion_scores": {},
            "live_interest": 50,
            "voice_interest": 0,
            "voice_rms": 0.0,
            "voice_pitch": 0.0,
            "customer_advice": (
                "【設定エラー】\n"
                "VercelのDashboard（Settings > Environment Variables）で\n"
                "GROQ_API_KEY を設定してください。"
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

        # 3. LLM 接客アドバイス生成（スレッドプールで非同期実行）
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