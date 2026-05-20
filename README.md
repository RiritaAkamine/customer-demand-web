# Customer Demand Analyzer

Customer Demand Analyzer is a real-time sales support dashboard. It captures camera frames and short microphone segments in the browser, analyzes facial emotion locally on the backend, extracts simple voice features, and generates a short customer-facing sales hint with an LLM fallback design.

This project is intended as a portfolio application that demonstrates a full-stack real-time workflow rather than a production-grade emotion recognition product. The output should be treated as a reference signal for sales staff, not as a definitive judgment of a person's inner state.

## Features

- Real-time webcam preview and face emotion scoring
- Live interest score calculated from expression signals
- Microphone waveform visualization in the browser
- Voice feature extraction from short WAV segments
- Hugging Face text generation for concise sales advice
- Local rule-based fallback when the LLM API is unavailable
- FastAPI backend with non-blocking background advice generation
- Next.js dashboard UI designed for live monitoring

## Tech Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python
- Computer vision: DeepFace, OpenCV
- Audio processing: librosa, SciPy
- Text generation: Hugging Face Inference API

## Project Structure

```text
customer-demand-web/
  backend/
    main.py              # FastAPI routes and background advice task
    services.py          # face analysis, audio features, advice generation
    requirements.txt     # Python dependencies
  frontend/
    app/page.tsx         # dashboard UI and browser media capture
    app/layout.tsx       # metadata and app shell
    package.json         # frontend dependencies and scripts
```

Generated folders such as `.next/`, `__pycache__/`, and `node_modules/` are excluded from source control.

## Setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Optional Hugging Face token:

```bash
export HF_TOKEN="your_hugging_face_token"
```

When `HF_TOKEN` is not configured, the backend skips remote LLM calls and uses local rule-based advice only. The app also falls back to local advice if the Hugging Face request fails.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` in a browser. Camera and microphone permissions are required.

Optional frontend API URL:

```bash
cp .env.local.example .env.local
# edit NEXT_PUBLIC_API_BASE_URL if the backend is not running on 127.0.0.1:8000
```

## API

### `GET /api/health`

Returns a small health check response.

```json
{ "status": "ok" }
```

### `POST /api/analyze`

Request body:

```json
{
  "image": "data:image/jpeg;base64,...",
  "audio": "data:audio/wav;base64,..."
}
```

Response body:

```json
{
  "dominant_emotion": "笑顔",
  "emotion_scores": { "happy": 72.3, "neutral": 18.4 },
  "live_interest": 100,
  "voice_interest": 64,
  "voice_rms": 0.0241,
  "voice_pitch": 183.5,
  "customer_advice": "【総合分析: 前向きな興味】\n具体例を見せて、次の提案へ進んでください。",
  "advice_status": "更新済み"
}
```

## Implementation Notes

- Face analysis runs on every dashboard polling request.
- Advice generation runs in a background task so the dashboard can continue updating while waiting for the LLM.
- The backend keeps a small in-memory state for the latest advice. This is enough for a local demo, but multi-user production use would need per-session state.
- The frontend explicitly stops camera tracks, microphone tracks, recording, animation frames, and audio contexts during cleanup.

## Limitations

- Emotion and voice analysis are approximate and should not be used for sensitive decision-making.
- The current implementation is optimized for a single local demo user.
- Hugging Face hosted inference may have latency, rate limits, or cold starts.
- Browser audio recording support can vary by browser.

## Portfolio Highlights

- Full-stack integration between browser media APIs and a Python ML backend
- Real-time dashboard design with visible processing status
- Graceful fallback from remote LLM generation to deterministic local advice
- Practical error handling around media capture, API calls, and model availability
