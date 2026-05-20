# リアルタイム心理分析接客支援システム (Multi-Modal Customer Analytics)

Webカメラの映像から「顧客の表情・主感情」を、マイクの音声から「声の振幅（波長）と周波数（トーン）」を1.5秒ごとに同時パースし、AIが次の最適な接客アクションをリアルタイムに構築してナビゲートする、次世代店舗向けのマルチモーダルAI接客支援システムです。

---

## 🚀 1. プロジェクト概要

本システムは、接客業における店員のスキル平準化や、顧客満足度の可視化を目的とした開発プロトタイプです。
ブラウザの「Web Audio API」を用いた生音声波長のバッファリングと、軽量化したカメラフレームデータをローカルのFastAPI（Python）へ同時送信。バックエンド側では `DeepFace` による感情抽出と `librosa` による音声トーン解析をハイブリッドで実行し、その結果をもとに `Llama 3.3 (Groq API)` が超低遅延で具体的な現場向け接客アドバイスを出力します。

---

## 🛠 2. 技術スタック

### フロントエンド (Frontend)
- **Framework:** Next.js 14+ (App Router / Static Export 仕様)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **API 通信 / デバイス制御:** Web Audio API (16kHz PCMバッファリング), 擬似WAVバイナリエンコーダー, Navigator.mediaDevices (Webcam/Mic)

### バックエンド (Backend)
- **Framework:** FastAPI (Python 3.10+)
- **Asynchronous:** asyncio / Concurrent Executor (LLM推論の非同期バックグラウンド処理)
- **AI / 解析ライブラリ:**
  - `DeepFace` (顔画像からのリアルタイム感情分布・主感情の抽出)
  - `OpenCV` (`cv2` による画像デコード・フレーム処理)
  - `librosa` (音声バイナリからの RMS/音量振幅 および ピッチ/周波数の抽出)
  - `Groq SDK` (Llama 3.3 による超高速・低遅延な接客アドバイス生成)

---

## 💻 3. 起動方法 (ローカル開発環境推奨)

本システムは、画像・音声のハイブリッド解析という極めて高負荷なマルチモーダル処理を1.5秒サイクルで回すため、マシンスペックを最大限に活かせる**ローカル（Mac等）での動作を推奨**しています。

### 事前準備
1. [Groq Console](https://console.groq.com/) 等から Groq API キー（`gsk_...`）を発行しておきます。

### 🐍 バックエンドの起動
```bash
cd backend

# 依存関係のインストール
pip install -r requirements.txt

# Groq APIキーを環境変数にセット
export GROQ_API_KEY="あなたの本物のgsk_キー"

# FastAPIサーバーをポート8000で起動
uvicorn main:app --reload --port 8000