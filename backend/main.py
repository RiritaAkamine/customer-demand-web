import os
import base64
import pydantic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
import cv2
import numpy as np

from services import (
    analyze_face_emotion,
    EMOTION_MAP,
    generate_customer_advice_from_ai
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

class AnalyzeRequest(BaseModel):
    image: str
    audio: str

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "engine": "DeepFace + Whisper (AI-Driven)"}

@app.post("/api/analyze")
async def analyze_customer(request: AnalyzeRequest):
    try:
        img_data = request.image
        if "," in img_data:
            img_data = img_data.split(",")[1]
            
        img_bytes = base64.b64decode(img_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Failed to decode image.")

        audio_bytes = b""
        if request.audio:
            audio_data = request.audio
            if "," in audio_data:
                audio_data = audio_data.split(",")[1]
            audio_bytes = base64.b64decode(audio_data)

        emotion_scores, dominant_en = analyze_face_emotion(img)
        dominant_ja = EMOTION_MAP.get(dominant_en, "真顔・冷静")

        # 拡張：戻り値の最後に transcription（文字起こし結果）が追加されます
        face_interest, voice_interest, judgment, advice, transcription = generate_customer_advice_from_ai(
            groq_client,
            audio_bytes,
            emotion_scores,
            dominant_en
        )

        # 会話ログが残せるよう、アドバイスの前に客の発言テキストをドッキングする
        if transcription:
            full_advice = f"【お客様の発言: 「{transcription}」】\n{judgment}\n{advice}"
        else:
            full_advice = f"{judgment}\n{advice}"

        return {
            "success": True,
            "dominant_emotion": dominant_ja,
            "emotion_scores": {
                "笑顔": emotion_scores.get("happy", 0.0),
                "真顔": emotion_scores.get("neutral", 0.0),
                "困惑": emotion_scores.get("sad", 0.0),
                "不満": emotion_scores.get("angry", 0.0),
                "驚き": emotion_scores.get("surprise", 0.0),
                "警戒": emotion_scores.get("fear", 0.0),
                "嫌悪": emotion_scores.get("disgust", 0.0),
                "happy": emotion_scores.get("happy", 0.0),
                "neutral": emotion_scores.get("neutral", 0.0),
                "sad": emotion_scores.get("sad", 0.0),
                "angry": emotion_scores.get("angry", 0.0),
                "surprise": emotion_scores.get("surprise", 0.0),
                "fear": emotion_scores.get("fear", 0.0),
                "disgust": emotion_scores.get("disgust", 0.0),
            },
            "emotion_distribution": {
                "笑顔": emotion_scores.get("happy", 0.0),
                "真顔": emotion_scores.get("neutral", 0.0),
                "困惑": emotion_scores.get("sad", 0.0),
                "不満": emotion_scores.get("angry", 0.0),
                "驚き": emotion_scores.get("surprise", 0.0),
                "警戒": emotion_scores.get("fear", 0.0),
                "嫌悪": emotion_scores.get("disgust", 0.0),
            },
            "live_interest": face_interest,
            "voice_interest": voice_interest,
            "customer_advice": full_advice, # ここに文字起こしログが綺麗に含まれます！
            "transcription": transcription,  # 将来的な拡張用に単体でも返却
            "advice_status": "分析完了"
        }

    except Exception as e:
        print(f"[Server Error] {e}")
        return {
            "success": False,
            "dominant_emotion": "真顔・冷静",
            "emotion_scores": {},
            "emotion_distribution": {},
            "live_interest": 50.0,
            "voice_interest": 0.0,
            "customer_advice": "分析中にエラーが発生しました。",
            "advice_status": "エラー"
        }