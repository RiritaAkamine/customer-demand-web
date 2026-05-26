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

app = FastAPI(title="Customer Demand Analyzer [Production Mode]")

# ⭕️ 本番仕様：CORS（接続許可）をあなたのVercel本番URLとローカル環境のみに厳格に制限
# ※「customer-demand-web.vercel.app」の部分は、後ほど作成するVercelの実際のプロジェクト名に合わせて調整可能です
ALLOWED_ORIGINS = [
    "https://customer-demand-web.vercel.app",        # あなたのVercel本番ドメイン
    "http://localhost:3000",                          # ローカルでのテスト用
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    image: str
    audio: str = ""


# ---------------------------------------------------------------------------
# ヘルスチェック (Renderの生存確認・デプロイ時の起動完了検知用)
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    return {"status": "ok", "environment": "production"}


# ---------------------------------------------------------------------------
# 顧客分析エンドポイント
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
async def analyze_customer(data: AnalysisRequest):
    # 【セキュリティ設計】
    # フロントエンド（LocalStorageなど）でのAPIキー管理はXSSによる漏洩リスクが高いため、
    # 完全にサーバーサイドの環境変数（os.environ）のみで秘匿情報を管理する堅牢な設計を採用。
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
                "【環境変数エラー】\n"
                "RenderのDashboard -> Environment設定に 'GROQ_API_KEY' が登録されているか確認してください。"
            ),
            "advice_status": "APIキー未設定",
        }

    try:
        # ------------------------------------------------------------------
        # 1. 顔画像デコード・感情解析
        # ------------------------------------------------------------------
        _, encoded = data.image.split(",", 1)
        np_array = np.frombuffer(base64.b64decode(encoded), dtype=np.uint8)
        frame = cv2.imdecode(np_array, cv2.IMREAD_COLOR)

        if frame is not None:
            emotion_scores, current_emotion = analyze_face_emotion(frame)
            
            # 【関心度計算（calculate_live_interest）のアルゴリズム設計根拠】
            # レジ前でのディスカウント提案に対する顧客の心理変容を以下のようにモデル化。
            # 1. フラットな状態（真顔・ニュートラル）を基準値「50%」とする加算・減算モデル。
            # 2. 提案に対する強い関心やフックを意味する「驚き(surprise)」を、
            #    笑顔(happy * 1.0)よりも高い「1.2倍」の重み付けで最優先評価。
            # 3. 顧客離れやクレームに直直結する「不快・拒絶(angry)」は明確な減点要素として処理。
            # これにより、接客現場の購買意欲トリガーに即した高精度なスコアリングを実現。
            live_interest_pct = calculate_live_interest(emotion_scores)
        else:
            emotion_scores = {
                "neutral": 100.0, "happy": 0.0, "sad": 0.0,
                "angry": 0.0, "surprise": 0.0,
            }
            current_emotion = "neutral"
            live_interest_pct = 50.0

        # ------------------------------------------------------------------
        # 2. 音声特徴量解析
        # ------------------------------------------------------------------
        audio_bytes = b""
        voice_interest = 0.0
        voice_rms = 0.0
        voice_pitch = 0.0

        if data.audio:
            try:
                _, audio_encoded = data.audio.split(",", 1)
                audio_bytes = base64.b64decode(audio_encoded)

                # 十分なデータ量がある場合のみ解析（ノイズ除去）
                if len(audio_bytes) > 10_000:
                    voice_rms, voice_pitch = extract_audio_features(audio_bytes)
                    voice_interest = calculate_voice_interest(voice_rms, voice_pitch)
            except Exception as audio_exc:
                print(f"[Audio] デコードエラー: {audio_exc}")

        # ------------------------------------------------------------------
        # 3. LLM 接客アドバイス生成（スレッドプールで非同期実行）
        #    リクエストごとに独立した Groq クライアントを生成して並列安全性を確保
        # ------------------------------------------------------------------
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
            # フロント側での型エラー防止のため、すべての数値を明示的にキャスト
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