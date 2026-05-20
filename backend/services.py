# ⭕️ backend/services.py の最下部をこれに差し替え
def generate_customer_advice(client_instance, audio_bytes, emotion_scores, dominant_emotion_en):
    """引数として受け取った独自の client_instance を使用してLLM推論を行います（並行処理対策）"""
    if client_instance is None:
        return "【システムエラー】\nGroqのAPIキーがセットされていません。"

    voice_status = "silent"
    if audio_bytes:
        try:
            mean_rms, mean_pitch = extract_audio_features(audio_bytes)
            if mean_rms >= 0.005:
                voice_status = f"talking(RMS:{mean_rms:.3f},Pitch:{mean_pitch:.0f}Hz)"
        except:
            pass

    metrics_summary = (
        f"FaceMain:{dominant_emotion_en},"
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

    try:
        response = client_instance.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": metrics_summary},
            ],
            model="llama-3.3-70b-versatile",
            max_tokens=80,
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()
    except Exception as err:
        print(f"Groq API分析エラー: {err}")
        return "（ただいまAIがお客様の関心度を慎重に分析しております...）"