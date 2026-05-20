"use client";

import { useEffect, useRef, useState } from "react";
// @ts-ignore: audiobuffer-to-wav does not ship TypeScript declarations.
import toWav from "audiobuffer-to-wav";

type EmotionScores = Record<string, number>;

interface AdviceLog {
  id: string;
  time: string;
  emotion: string;
  text: string;
}

const getApiBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  if (typeof window === "undefined") {
    return "http://127.0.0.1:8000";
  }
  return `http://${window.location.hostname}:8000`;
};

const EMOTION_LABELS: Record<string, string> = {
  happy: "笑顔",
  neutral: "真顔",
  sad: "困惑",
  angry: "不満",
  surprise: "驚き",
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCanvasRef = useRef<HTMLCanvasElement>(null);
  const faceMeshCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isAnalyzingRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  const [liveInterest, setLiveInterest] = useState(50);
  const [voiceInterest, setVoiceInterest] = useState(0);
  const [dominantEmotion, setDominantEmotion] = useState("真顔・普通");
  const [customerAdvice, setCustomerAdvice] = useState("接客分析を開始しました");
  const [adviceHistory, setAdviceHistory] = useState<AdviceLog[]>([]);
  const [emotionScores, setEmotionScores] = useState<EmotionScores>({});
  const [currentAudioBase64, setCurrentAudioBase64] = useState("");
  const [cameraStatus, setCameraStatus] = useState("起動中");
  const [audioStatus, setAudioStatus] = useState("起動中");
  const [adviceStatus, setAdviceStatus] = useState("待機中");

  const [apiKey, setApiKey] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputKey, setInputKey] = useState("");

  useEffect(() => {
    const savedKey = localStorage.getItem("EDION_ANALYZE_GROQ_KEY");
    if (savedKey) {
      setApiKey(savedKey);
      setInputKey(savedKey);
    } else {
      setIsModalOpen(true);
    }
  }, []);

  const handleSaveApiKey = () => {
    const trimmed = inputKey.trim();
    localStorage.setItem("EDION_ANALYZE_GROQ_KEY", trimmed);
    setApiKey(trimmed);
    setIsModalOpen(false);
  };

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;
    if (!isUserScrollingRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [adviceHistory]);

  const handleLogScroll = () => {
    const container = logContainerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 20;
    isUserScrollingRef.current = !isAtBottom;
  };

  useEffect(() => {
    let cancelled = false;
    let audioTimer: ReturnType<typeof setInterval> | null = null;
    let faceMeshDetector: any = null;

    const setupFaceMesh = async () => {
      const loadScript = (src: string) => {
        return new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = src;
          script.crossOrigin = "anonymous";
          script.onload = resolve;
          document.head.appendChild(script);
        });
      };

      try {
        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");
        
        // @ts-ignore
        const mpFaceMesh = window.FaceMesh;
        if (!mpFaceMesh) return;

        faceMeshDetector = new mpFaceMesh({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMeshDetector.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMeshDetector.onResults((results: any) => {
          if (cancelled) return;
          const canvas = faceMeshCanvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            ctx.fillStyle = "rgba(52, 211, 153, 0.85)";
            
            for (let i = 0; i < landmarks.length; i += 4) {
              const pt = landmarks[i];
              const x = pt.x * canvas.width;
              const y = pt.y * canvas.height;
              ctx.beginPath();
              ctx.arc(x, y, 2, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        });
      } catch (err) {
        console.error("MediaPipe Face Meshのロードに失敗:", err);
      }
    };

    const setupCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        videoStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraStatus("稼働中");

        await setupFaceMesh();
        const processVideoFrame = async () => {
          if (cancelled) return;
          if (videoRef.current && videoRef.current.readyState >= 3 && faceMeshDetector) {
            await faceMeshDetector.send({ image: videoRef.current });
          }
          requestAnimationFrame(processVideoFrame);
        };
        requestAnimationFrame(processVideoFrame);

      } catch (err) {
        console.error("カメラ起動エラー:", err);
        setCameraStatus("利用不可");
      }
    };

    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        audioStreamRef.current = stream;
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 1024;
        source.connect(analyzer);

        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const drawWave = () => {
          const canvas = audioCanvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;

          animationRef.current = requestAnimationFrame(drawWave);
          analyzer.getByteTimeDomainData(dataArray);

          ctx.fillStyle = "rgb(15, 23, 42)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgb(52, 211, 153)";
          ctx.beginPath();

          const sliceWidth = canvas.width / bufferLength;
          let x = 0;

          for (let index = 0; index < bufferLength; index += 1) {
            const value = dataArray[index] / 128.0;
            const y = (value * canvas.height) / 2;
            if (index === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth;
          }
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
        };

        drawWave();

        const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          if (cancelled) return;
          if (audioChunksRef.current.length === 0) {
            setCurrentAudioBase64("");
            return;
          }

          const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
          audioChunksRef.current = [];

          try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            if (arrayBuffer.byteLength >= 5000) {
              const decodeContext = new AudioContextClass({ sampleRate: 16000 });
              const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
              const wavBuffer = toWav(audioBuffer);
              const wavBlob = new Blob([new DataView(wavBuffer)], { type: "audio/wav" });
              await decodeContext.close();

              const reader = new FileReader();
              reader.onloadend = () => {
                if (!cancelled && reader.result) {
                  setCurrentAudioBase64(reader.result as string);
                }
              };
              reader.readAsDataURL(wavBlob);
            } else {
              setCurrentAudioBase64("");
            }
          } catch (err) {
            console.error("音声変換エラー:", err);
            setCurrentAudioBase64("");
          }

          if (!cancelled && mediaRecorderRef.current?.state === "inactive") {
            try {
              mediaRecorderRef.current.start();
            } catch (err) {
              console.error("録音再開エラー:", err);
            }
          }
        };

        mediaRecorder.start();
        audioTimer = setInterval(() => {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
          }
        }, 2000);

        setAudioStatus("稼働中");
      } catch (err) {
        console.error("マイク起動エラー:", err);
        setAudioStatus("利用不可");
      }
    };

    setupCamera();
    setupAudio();

    return () => {
      cancelled = true;
      if (audioTimer) clearInterval(audioTimer);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      videoStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (isAnalyzingRef.current || !videoRef.current || !canvasRef.current) return;
      if (videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      isAnalyzingRef.current = true;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const base64Image = canvas.toDataURL("image/jpeg", 0.75);

      try {
        const res = await fetch(`${getApiBaseUrl()}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            image: base64Image, 
            audio: currentAudioBase64,
            apiKey: apiKey
          }),
        });

        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const data = await res.json();
        setDominantEmotion(data.dominant_emotion);
        setLiveInterest(data.live_interest);
        setVoiceInterest(data.voice_interest ?? 0);
        setEmotionScores(data.emotion_scores || {});
        setAdviceStatus(data.advice_status || "更新済み");

        if (data.customer_advice) {
          setCustomerAdvice((prev) => {
            if (prev !== data.customer_advice && !data.customer_advice.includes("分析中")) {
              const now = new Date();
              const timeString = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
              
              setAdviceHistory((history) => {
                const newLog: AdviceLog = {
                  id: Math.random().toString(36).substring(2, 9),
                  time: timeString,
                  emotion: data.dominant_emotion,
                  text: data.customer_advice,
                };
                return [...history, newLog].slice(-20);
              });
            }
            return data.customer_advice;
          });
        }
      } catch (err) {
        console.error("サーバー通信エラー:", err);
        setAdviceStatus("接続待ち");
      } finally {
        isAnalyzingRef.current = false;
      }
    }, 1500);

    return () => clearInterval(timer);
    // ⭕️ 原因だった問題のコメント行をJavaScriptの正しい記述（//）に修正、絵文字を除去しました
  }, [currentAudioBase64, apiKey]);

  const getMeterColor = (value: number) => {
    if (value >= 70) return "text-green-400 border-green-500 bg-green-950/30";
    if (value <= 40) return "text-red-400 border-red-500 bg-red-950/30";
    return "text-amber-400 border-amber-500 bg-amber-950/30";
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 md:p-8 font-sans relative">
      
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-md p-6 bg-slate-900 border border-indigo-500/40 rounded-xl shadow-2xl space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <span className="text-xl">🔑</span>
              <h3 className="text-lg font-black text-white">Groq APIキーの設定</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              エディオンのレジ前でAI（Llama 3.3）を動かすための個人のAPIキーを入力してください。キーはあなたのPC内にのみ安全に保存されます。
            </p>
            <input 
              type="password" 
              placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxx"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm text-emerald-400 font-mono focus:outline-none focus:border-emerald-500"
            />
            <div className="flex justify-end gap-2 pt-2 text-xs font-bold">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-slate-700 rounded text-slate-400 hover:bg-slate-800"
              >
                閉じる
              </button>
              <button 
                onClick={handleSaveApiKey}
                className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-indigo-600 rounded text-white shadow-md hover:opacity-90"
              >
                保存して接続
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="mb-6 border-b border-slate-800 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-emerald-400">Real-time sales support</p>
            <h1 className="mt-2 text-3xl font-black text-white">リアルタイム顧客心理分析システム</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsModalOpen(true)}
              className={`px-3 py-1.5 border rounded text-xs font-bold flex items-center gap-1.5 transition-all ${apiKey ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20' : 'border-indigo-500 text-indigo-400 bg-indigo-950/20 animate-pulse'}`}
            >
              <span>{apiKey ? "🔑 キー設定済み" : "🔑 APIキーを設定"}</span>
            </button>

            <div className="grid grid-cols-3 gap-2 text-xs font-bold text-slate-300">
              <span className="rounded border border-slate-700 bg-slate-900 px-3 py-2">CAM {cameraStatus}</span>
              <span className="rounded border border-slate-700 bg-slate-900 px-3 py-2">MIC {audioStatus}</span>
              <span className="rounded border border-slate-700 bg-slate-900 px-3 py-2">AI {adviceStatus}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-900 shadow-2xl aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            <canvas ref={canvasRef} width={640} height={480} className="hidden" />
            
            <canvas 
              ref={faceMeshCanvasRef} 
              width={640} 
              height={480} 
              className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none scale-x-[-1]" 
            />

            <div className="absolute top-4 left-4 bg-slate-950/80 px-4 py-2 rounded border border-slate-700 z-10">
              <span className="text-sm font-bold text-slate-300">主感情: {dominantEmotion}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`p-4 rounded-lg border ${getMeterColor(liveInterest)} transition-colors duration-300`}>
              <div className="text-xs font-bold uppercase tracking-widest opacity-80">リアルタイム表情関心度</div>
              <div className="text-4xl font-black mt-1">{liveInterest}%</div>
            </div>

            <div className={`p-4 rounded-lg border ${getMeterColor(voiceInterest)} transition-colors duration-300`}>
              <div className="text-xs font-bold uppercase tracking-widest opacity-80">リアルタイム声の関心度</div>
              <div className="text-4xl font-black mt-1">{voiceInterest}%</div>
            </div>
          </div>

          {/* 最新の接客アドバイス */}
          <section className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 border border-indigo-500/40 rounded-lg shadow-xl">
            <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-2">
              <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                最新の接客アドバイス（リアルタイム）
              </h2>
              <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded font-bold">Llama 3.3 推論</span>
            </div>
            <p className="mt-3 text-2xl font-black text-white whitespace-pre-wrap leading-relaxed tracking-wide">
              {customerAdvice}
            </p>
          </section>

          {/* 接客ログ */}
          <section className="p-5 bg-slate-900 border border-slate-800 rounded-lg shadow-xl">
            <div className="border-b border-slate-800 pb-2 mb-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">これまでの接客ログ（会話の流れ）</h2>
            </div>
            <div 
              ref={logContainerRef}
              onScroll={handleLogScroll}
              className="h-[260px] overflow-y-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-slate-800"
            >
              {adviceHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500 italic">
                  レジでの対話が始まると、ここに心理分析ログがストックされます。
                </div>
              ) : (
                adviceHistory.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-950/60 border border-slate-800 rounded-md transition-all duration-200 hover:border-slate-700">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-1.5">
                      <span className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-bold">{log.time}</span>
                      <span className="text-slate-500">検知感情: {log.emotion}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {log.text}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* サイドバー */}
        <aside className="space-y-4">
          <section className="p-4 bg-slate-900 border border-slate-800 rounded-lg shadow-xl">
            <h2 className="text-sm font-bold text-slate-300 mb-3 border-b border-slate-800 pb-2">感情分布</h2>
            <div className="space-y-3">
              {["happy", "neutral", "sad", "angry", "surprise"].map((emotion) => {
                const score = emotionScores[emotion] || 0;
                return (
                  <div key={emotion} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">{EMOTION_LABELS[emotion]}</span>
                      <span className="font-mono">{score.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded overflow-hidden">
                      <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${score}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="p-4 bg-slate-900 border border-slate-800 rounded-lg shadow-xl">
            <h2 className="text-sm font-bold text-emerald-400 mb-3 border-b border-slate-800 pb-2">音声波形</h2>
            <div className="rounded overflow-hidden border border-slate-800 bg-slate-950 p-2">
              <canvas ref={audioCanvasRef} width={400} height={100} className="w-full h-[100px] bg-slate-950" />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
              <span>LOW</span>
              <span>LIVE WAVEFORM</span>
              <span>HIGH</span>
            </div>
          </section>

          <section className="p-4 bg-slate-900 border border-slate-800 rounded-lg shadow-xl">
            <h2 className="text-sm font-bold text-slate-300 mb-3 border-b border-slate-800 pb-2">処理ステータス</h2>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-slate-500">カメラ</dt>
              <dd className="text-right font-bold text-slate-200">{cameraStatus}</dd>
              <dt className="text-slate-500">マイク</dt>
              <dd className="text-right font-bold text-slate-200">{audioStatus}</dd>
              <dt className="text-slate-500">アドバイス</dt>
              <dd className="text-right font-bold text-slate-200">{adviceStatus}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}