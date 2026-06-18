# FNMG

FNMG 是一個本機影片處理工具，可以在瀏覽器中上傳影片，將影片音軌轉成可下載的音檔，也可以把語音內容轉成逐字稿。

## 功能

- 上傳常見影片格式，例如 MP4、MOV、MKV、AVI、WEBM。
- 轉出音檔格式：MP3、WAV、AAC、OGG、FLAC、M4A。
- 可調整音訊位元率與取樣率。
- 支援大型影片，透過本機 FFmpeg 後端處理。
- 支援語音轉逐字稿，可選自動偵測、中文、英文、日文、韓文。
- 逐字稿可直接複製或下載成 TXT。

## 系統需求

- Windows、macOS 或 Linux。
- Python 3.10 以上。
- FFmpeg，且 `ffmpeg` 指令需要能在終端機中執行。
- 語音轉逐字稿需要安裝 Whisper，以下任一種即可：
  - OpenAI Whisper：`python -m pip install -U openai-whisper`
  - faster-whisper CLI
  - whisper.cpp 的 `whisper-cli`

目前專案會優先尋找 `whisper`、`faster-whisper`、`whisper-cli` 指令；如果找不到，也會嘗試用 `python -m whisper` 執行 OpenAI Whisper。

## 安裝

1. 下載或 clone 專案：

```powershell
git clone https://github.com/likebearlala/FNMG.git
cd FNMG
```

2. 確認 FFmpeg 可用：

```powershell
ffmpeg -version
```

3. 如需逐字稿功能，安裝 Whisper：

```powershell
python -m pip install -U openai-whisper
```

第一次產生逐字稿時，Whisper 可能會下載模型檔，需要一點時間。

## 啟動

Windows 可直接執行：

```powershell
.\start-server.bat
```

或手動啟動：

```powershell
python server.py
```

啟動後開啟：

```text
http://127.0.0.1:8080/
```

如果要使用其他 port：

```powershell
$env:PORT="8099"
python server.py
```

## 使用方式

1. 開啟網頁後，點選或拖放影片檔。
2. 選擇輸出音檔格式、位元率與取樣率。
3. 按「開始轉檔」產生音檔。
4. 轉檔完成後按「下載音檔」。
5. 若要產生逐字稿，選擇逐字稿語言後按「產生逐字稿」。
6. 逐字稿完成後可按「複製」或「下載 TXT」。

## PowerShell 指令產生器

如果只是想在自己的電腦直接執行 FFmpeg 或 Whisper，也可以使用頁面內的「PowerShell 指令產生器」。

這個功能是純靜態頁面，可以直接放在 GitHub Pages 使用：

```text
https://likebearlala.github.io/FNMG/command.html
```

GitHub Pages 版本只會產生 PowerShell 指令，不會上傳檔案，也不會替使用者執行指令。使用者仍需要在自己的電腦安裝 FFmpeg；如果要產生逐字稿，也需要安裝 Whisper。

1. 在「影片或音訊完整路徑」輸入本機檔案路徑，例如：

```text
C:\Users\Me\Videos\meeting.mp4
```

2. 選擇輸出格式、位元率、取樣率或逐字稿語言。
3. 按「產生轉音檔指令」或「產生逐字稿指令」。
4. 按「複製指令」。
5. 將指令貼到 PowerShell 執行。

也可以輸入 Google Drive 分享連結，產生「下載 Drive 影片並轉逐字稿」的 PowerShell 指令。Drive 檔案需要設定為知道連結的人可檢視，或使用者本機已具備可存取該檔案的權限。

轉音檔範例：

```powershell
$inputFile = "C:\Users\Me\Videos\meeting.mp4"
$outputFile = "C:\Users\Me\Videos\meeting.mp3"
ffmpeg -y -i $inputFile -vn -codec:a libmp3lame -ar 44100 -b:a 192k $outputFile
```

逐字稿範例：

```powershell
$inputFile = "C:\Users\Me\Videos\meeting.mp4"
$outputDir = "C:\Users\Me\Videos"
python -m whisper $inputFile --model base --task transcribe --language zh --output_format txt --output_dir $outputDir --fp16 False
```

Google Drive 逐字稿範例：

```powershell
$driveUrl = "https://drive.google.com/file/d/FILE_ID/view"
$outputDir = "."
$videoFile = Join-Path $outputDir "drive-video.mp4"
python -m pip install -U gdown openai-whisper
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
python -m gdown $driveUrl -O $videoFile
python -m whisper $videoFile --model base --task transcribe --language zh --output_format txt --output_dir $outputDir --fp16 False
```

## API

健康檢查：

```http
GET /api/health
```

回傳範例：

```json
{
  "ok": true,
  "transcription": true
}
```

轉音檔：

```http
POST /api/convert?format=mp3&bitrate=192k&sample_rate=44100
```

表單欄位：

- `media`：影片或音訊檔案。

產生逐字稿：

```http
POST /api/transcribe?language=auto
```

表單欄位：

- `media`：影片或音訊檔案。

語言選項：

- `auto`：自動偵測
- `zh`：中文
- `en`：英文
- `ja`：日文
- `ko`：韓文

## 常見問題

### 頁面顯示瀏覽器模式

代表本機後端沒有啟動，請執行：

```powershell
.\start-server.bat
```

然後重新整理頁面。

### 大影片轉檔失敗

請確認頁面顯示「本機 FFmpeg 模式」。如果不是，代表正在使用瀏覽器模式，瀏覽器模式不適合處理大型影片。

### 顯示找不到 FFmpeg

請安裝 FFmpeg，並確認可以在終端機執行：

```powershell
ffmpeg -version
```

### 逐字稿功能不可用

請安裝 Whisper：

```powershell
python -m pip install -U openai-whisper
```

安裝後重啟伺服器，再重新整理頁面。

### 轉檔或逐字稿失敗但原因不清楚

後端錯誤會寫入：

```text
server-error.log
```

可以查看該檔案取得 FFmpeg 或 Whisper 的詳細錯誤。

## 專案檔案

- `index.html`：頁面結構。
- `command.html`：可部署到 GitHub Pages 的 PowerShell 指令產生器。
- `styles.css`：介面樣式。
- `app.js`：前端互動、上傳、下載與逐字稿操作。
- `command.js`：PowerShell 指令產生器邏輯。
- `server.py`：本機 HTTP 伺服器、FFmpeg 轉檔與 Whisper 逐字稿 API。
- `start-server.bat`：Windows 啟動腳本。

## 注意事項

- 檔案會傳到本機伺服器處理，不會上傳到第三方服務。
- 轉檔暫存資料會放在 `.converter_tmp/`，處理完成後會自動清除。
- 大型影片需要足夠磁碟空間與處理時間。
- Whisper 逐字稿品質會受到音訊清晰度、語言、背景噪音與模型大小影響。
