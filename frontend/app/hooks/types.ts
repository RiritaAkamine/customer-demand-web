// 各フックおよびコンポーネント間で共有する型定義

export interface AdviceLog {
  id: string;
  time: string;
  emotion: string;
  text: string;
}

export interface AnalysisResult {
  dominant_emotion: string;
  emotion_scores: Record<string, number>;
  live_interest: number;
  voice_interest: number;
  voice_rms: number;
  voice_pitch: number;
  customer_advice: string;
  advice_status: string;
}

// MediaPipe FaceMesh のグローバルスクリプトに対する最低限の型定義
// @types/mediapipe__face_mesh が存在しないため自前で宣言する
export interface FaceMeshLandmark {
  x: number;
  y: number;
  z: number;
}

export interface FaceMeshResults {
  multiFaceLandmarks?: FaceMeshLandmark[][];
}
