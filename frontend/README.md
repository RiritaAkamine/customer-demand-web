# 顧客心理分析ダッシュボード

## 制作動機

家電量販店でアルバイトをしていたとき、「お客様が今どのくらい興味を持っているか」を読み取るのが難しく、ベテランスタッフとの差がそこだと感じた。表情や声のトーンから購買意欲をリアルタイムで可視化し、新人スタッフでも適切なタイミングで提案できるようなツールを作りたいと思い開発した。

## デモ

> **スクリーンショット**: ダッシュボード全体図（カメラ映像・感情分布・接客ログ）
>
> ![デモ画面](docs/screenshot.png)
>
> ※ローカル起動後 `http://localhost:3000` で確認できます。カメラ・マイクの許可が必要です。

---

ブラウザでカメラ映像と音声を取得し、顔の表情解析・音声特徴量抽出をバックエンドで処理して、LLM によるリアルタイム接客アドバイスを生成するダッシュボードアプリ。

感情認識の精度よりも「フルスタックのリアルタイム処理パイプラインを一人で完結させること」を目的に開発したポートフォリオ作品。出力はあくまで接客スタッフへの参考シグナルであり、人の内面を断定するものではない。

## 機能一覧

- カメラ映像のリアルタイムプレビューと顔の感情スコアリング
- 表情シグナルから算出するライブ関心度スコア
- ブラウザ内でのマイク波形ビジュアライゼーション
- 短い WAV セグメントからの音声特徴量抽出
- Groq / Llama 3.3 による簡潔な接客アドバイス自動生成
- LLM API 不使用時のルールベースフォールバック
- スレッドプールによるノンブロッキング推論（FastAPI）
- ライブモニタリング向けの Next.js ダッシュボード UI

## 技術スタック

- フロントエンド: Next.js / React / TypeScript / Tailwind CSS
- バックエンド: FastAPI / Python
- 画像処理: DeepFace / OpenCV
- 音声処理: librosa / SciPy
- テキスト生成: Groq API（llama-3.3-70b-versatile）

## ディレクトリ構成

```text
customer-demand-web/
  backend/
    main.py              # FastAPI ルート定義
    services.py          # 顔解析・音声特徴量・アドバイス生成ロジック
    test_services.py     # pytest ユニットテスト（純粋関数対象）
    requirements.txt     # Python 依存パッケージ
  frontend/
    app/
      page.tsx           # ダッシュボード UI（フック合成のみ担当）
      layout.tsx         # メタデータとアプリシェル
      hooks/
        useCamera.ts     # カメラストリームと MediaPipe FaceMesh オーバーレイ
        useAudioRecorder.ts  # マイク録音・波形描画・WAV エクスポート
        useAnalysis.ts   # API ポーリングと分析ステート管理
        types.ts         # 共有 TypeScript 型定義
    package.json         # フロントエンド依存パッケージとスクリプト
```

`.next/`・`__pycache__/`・`node_modules/` はバージョン管理対象外。

## セットアップ

### バックエンド

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GROQ_API_KEY="your_groq_api_key"
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

`GROQ_API_KEY` はサーバーサイドの環境変数のみで管理する。クライアント側には一切送信・保存しない。

未設定の場合はバックエンドがエラーメッセージを返し、LLM 呼び出しをスキップする。

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開く。カメラとマイクの許可が必要。

API の向き先を変更したい場合:

```bash
cp .env.local.example .env.local
# バックエンドが 127.0.0.1:8000 以外の場合は NEXT_PUBLIC_API_BASE_URL を編集
```

### テスト実行

```bash
cd backend
pytest test_services.py -v
```

## API 仕様

### `GET /api/health`

ヘルスチェック用エンドポイント。

```json
{ "status": "ok" }
```

### `POST /api/analyze`

リクエストボディ:

```json
{
  "image": "data:image/jpeg;base64,...",
  "audio": "data:audio/wav;base64,..."
}
```

レスポンスボディ:

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

## 設計メモ

### セキュリティ

APIキーはサーバーサイドの環境変数（`os.environ`）のみで管理する。ブラウザ側（localStorage・Cookie・リクエストボディ）に置くと XSS で漏洩するため、バックエンドが秘匿情報の唯一の保持者となる設計にした。

### CORS

ローカル開発の利便性のため現在は `allow_origins=["*"]` にしている。**本番デプロイ時は実際のフロントエンドオリジンのみに制限すること**（例: `allow_origins=["https://your-domain.com"]`）。

### リクエストライフサイクルと状態管理

`POST /api/analyze` は完全にステートレスな設計で、クライアントがその時点のフレームと音声セグメントを送ると、その瞬間の分析結果をすべて返す。サーバー側にはセッション状態を持たないため、並列アクセスでも同期不要。

Groq API 呼び出しはスレッドプールエグゼキュータ（`loop.run_in_executor`）で実行し、FastAPI のイベントループをブロックしない。スレッドセーフティのため Groq クライアントはリクエストごとに新規生成する。

### フロントエンドアーキテクチャ

ダッシュボードのロジックを 3 つのカスタムフックに分離した:

- `useCamera` — カメラストリームのライフサイクルと MediaPipe FaceMesh オーバーレイ
- `useAudioRecorder` — マイク録音・波形描画・WAV エンコード
- `useAnalysis` — API ポーリング・ステート管理・接客ログの蓄積

`page.tsx` はこれらのフックを組み合わせてレンダリングのみを担当する。

## 制約・既知の問題

- 感情・音声解析はあくまで近似値であり、重要な意思決定には使用しないこと
- 現在の実装はローカルでの 1 ユーザー利用を前提としている。マルチユーザー対応には適切なプロセス分離またはコンテナ化が必要
- ブラウザによって音声録音のサポート状況が異なる場合がある
- Groq のホスト型推論はレート制限やコールドスタートが発生することがある

## ポートフォリオとしての見どころ

- ブラウザのメディア API と Python ML バックエンドのフルスタック統合
- クライアント側に認証情報を一切持たないサーバーサイド API キー管理
- 処理状態が常に見えるリアルタイムダッシュボード設計
- カメラ・音声・分析の関心事を分離したカスタム React フック構成
- リモート LLM からローカルルールベースへのグレースフルフォールバック
- メディアキャプチャ・API 呼び出し・モデル可用性への実践的なエラーハンドリング