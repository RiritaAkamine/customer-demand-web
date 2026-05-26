// JavaScriptライブラリに外側から型を教え込む専用ファイル
declare module "audiobuffer-to-wav" {
  function toWav(buffer: AudioBuffer): ArrayBuffer;
  export default toWav;
}