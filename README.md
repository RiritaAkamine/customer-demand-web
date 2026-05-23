# Customer Demand Analyzer

Customer Demand Analyzer is a real-time sales support dashboard. It captures camera frames and short microphone segments in the browser, analyzes facial emotion on the backend, extracts simple voice features, and generates a short sales hint using an LLM.

This project is intended as a portfolio application that demonstrates a full-stack real-time workflow rather than a production-grade emotion recognition product. The output should be treated as a reference signal for sales staff, not as a definitive judgment of a person's inner state.

## Features

- Real-time webcam preview and face emotion scoring
- Live interest score calculated from expression signals
- Microphone waveform visualization in the browser
- Voice feature extraction from short WAV segments
- LLM-generated concise sales advice (Groq / Llama 3.3)
- Local rule-based fallback when the LLM API is unavailable
- FastAPI backend with non-blocking advice generation via thread pool
- Next.js dashboard UI designed for live monitoring

## Tech Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python
- Computer vision: DeepFace, OpenCV
- Audio processing: librosa, SciPy
- Text generation: Groq API (llama-3.3-70b-versatile)

## Project Structure

```text
customer-demand-web/
  backend/
    main.py              # FastAPI routes
    services.py          # face analysis, audio features, advice generation
    requirements.txt     # Python dependencies
  frontend/
    app/
      page.tsx           # dashboard UI (thin orchestration layer)
      layout.tsx         # metadata and app shell
      hooks/
        useCamera.ts     # webcam stream and MediaPipe FaceMesh overlay
        useAudioRecorder.ts  # microphone capture, waveform, WAV export
        useAnalysis.ts   # API polling and analysis state management
        types.ts         # shared TypeScript type definitions
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
export GROQ_API_KEY="your_groq_api_key"
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The `GROQ_API_KEY` is managed exclusively as a server-side environment variable. It is never sent to or stored on the client side.

When `GROQ_API_KEY` is not set, the backend returns a descriptive error message and skips the LLM call.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` in a browser. Camera and microphone permissions are required.

Optional frontend API URL override:

```bash
cp .env.local.example .env.local
# Edit NEXT_PUBLIC_API_BASE_URL if the backend is not on 127.0.0.1:8000
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
  "dominant_emotion": "笑顔・好意的",
  "emotion_scores": { "happy": 72.3, "neutral": 18.4 },
  "live_interest": 86,
  "voice_interest": 64,
  "voice_rms": 0.0241,
  "voice_pitch": 183.5,
  "customer_advice": "【判断: 脈あり(前向きにご興味ありです)】\n具体的なプランをご案内ください。",
  "advice_status": "安定稼働中"
}
```

## Implementation Notes

### Security

API keys are managed exclusively via server-side environment variables (`os.environ`). Storing credentials in the browser (localStorage, cookies, request bodies) would expose them to XSS attacks, so the backend is the sole owner of all secrets.

### CORS

The backend currently allows all origins (`allow_origins=["*"]`) for local development convenience. **For production deployment, restrict this to the actual frontend origin** (e.g. `allow_origins=["https://your-domain.com"]`).

### Request lifecycle and state management

Each `POST /api/analyze` request is fully self-contained: the client sends the current frame and audio segment, and the response includes all analysis results for that moment. No session state is stored on the server between requests, which makes the backend safe for concurrent access without any per-session synchronization.

The Groq API call runs in a thread pool executor (`loop.run_in_executor`) so the FastAPI event loop is never blocked. A new Groq client is instantiated per request to ensure thread safety.

### Frontend architecture

The dashboard logic is split into three custom hooks:

- `useCamera` — webcam stream lifecycle and MediaPipe FaceMesh overlay
- `useAudioRecorder` — microphone capture, waveform drawing, and WAV encoding
- `useAnalysis` — API polling, state management, and advice log accumulation

`page.tsx` composes these hooks and handles only rendering.

## Limitations

- Emotion and voice analysis are approximate and should not be used for sensitive decision-making.
- The current implementation is optimized for a single local demo user. Multi-user production use would require a deployment with proper process isolation or containerization.
- Browser audio recording support can vary by browser.
- Groq hosted inference may have rate limits or cold starts.

## Portfolio Highlights

- Full-stack integration between browser media APIs and a Python ML backend
- Server-side API key management with no client-side credential exposure
- Real-time dashboard design with visible processing status
- Custom React hooks separating camera, audio, and analysis concerns
- Graceful fallback from remote LLM generation to deterministic local advice
- Practical error handling around media capture, API calls, and model availability
