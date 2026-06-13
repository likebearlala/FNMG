const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

const form = document.querySelector("#converter-form");
const dropZone = document.querySelector("#drop-zone");
const input = document.querySelector("#video-input");
const filePanel = document.querySelector("#file-panel");
const fileName = document.querySelector("#file-name");
const fileSize = document.querySelector("#file-size");
const fileType = document.querySelector("#file-type");
const formatSelect = document.querySelector("#format-select");
const bitrateSelect = document.querySelector("#bitrate-select");
const sampleRateSelect = document.querySelector("#sample-rate-select");
const transcriptLanguageSelect = document.querySelector("#transcript-language-select");
const convertButton = document.querySelector("#convert-button");
const transcribeButton = document.querySelector("#transcribe-button");
const downloadLink = document.querySelector("#download-link");
const transcriptPanel = document.querySelector("#transcript-panel");
const transcriptOutput = document.querySelector("#transcript-output");
const copyTranscriptButton = document.querySelector("#copy-transcript-button");
const downloadTranscriptButton = document.querySelector("#download-transcript-button");
const statusText = document.querySelector("#status-text");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const modeHelp = document.querySelector("#mode-help");

const ffmpeg = new FFmpeg();
let selectedFile = null;
let outputUrl = null;
let outputFileName = "";
let transcriptFileName = "";
let isLoaded = false;
let canUseServer = false;
let canTranscribe = false;

const mimeByFormat = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
};

const codecByFormat = {
  mp3: ["-codec:a", "libmp3lame"],
  wav: ["-codec:a", "pcm_s16le"],
  aac: ["-codec:a", "aac"],
  ogg: ["-codec:a", "libvorbis"],
  flac: ["-codec:a", "flac"],
  m4a: ["-codec:a", "aac"],
};

function setStatus(message, percent = null, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);

  if (percent !== null) {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    progressPercent.textContent = `${safePercent}%`;
    progressBar.style.width = `${safePercent}%`;
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function cleanName(name) {
  return name.replace(/\.[^/.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
}

function resetDownload() {
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }

  outputFileName = "";
  downloadLink.hidden = true;
  downloadLink.disabled = true;
  downloadLink.textContent = "下載音檔";
}

function resetTranscript() {
  transcriptFileName = "";
  transcriptOutput.value = "";
  transcriptPanel.hidden = true;
}

function prepareDownload(blob, fileName, format) {
  if (outputUrl) URL.revokeObjectURL(outputUrl);

  outputUrl = URL.createObjectURL(blob);
  outputFileName = fileName;
  downloadLink.textContent = `下載 ${format.toUpperCase()}`;
  downloadLink.disabled = false;
  downloadLink.hidden = false;
}

function downloadAudio() {
  if (!outputUrl || !outputFileName) {
    setStatus("還沒有可下載的音檔，請先完成轉檔", 0, true);
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = outputUrl;
  anchor.download = outputFileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setStatus("已送出下載，若沒有看到檔案請檢查瀏覽器下載列", 100);
}

function setSelectedFile(file) {
  selectedFile = file;
  resetDownload();
  resetTranscript();

  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileType.textContent = file.type || "未知格式";
  filePanel.hidden = false;
  convertButton.disabled = false;
  transcribeButton.disabled = false;
  if (!canUseServer && file.size > 900 * 1024 * 1024) {
    setStatus("這個檔案很大，瀏覽器模式可能會因記憶體限制失敗", 0, true);
    return;
  }

  setStatus("準備轉檔", 0);
}

async function detectServerMode() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    canUseServer = response.ok;
    if (response.ok) {
      const data = await response.json();
      canTranscribe = Boolean(data.transcription);
    }
  } catch {
    canUseServer = false;
    canTranscribe = false;
  }

  modeHelp.textContent = canUseServer
    ? canTranscribe
      ? "本機 FFmpeg + Whisper 模式，可轉音檔與逐字稿"
      : "本機 FFmpeg 模式，可轉音檔；逐字稿需安裝 Whisper"
    : "瀏覽器模式，建議使用 900 MB 以下影片";

  return canUseServer;
}

async function loadFFmpeg() {
  if (isLoaded) return;

  setStatus("正在載入轉檔引擎", 5);

  const baseUrl = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  ffmpeg.on("progress", ({ progress }) => {
    setStatus("正在處理影片音軌", progress * 100);
  });

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, "application/wasm"),
  });

  isLoaded = true;
}

function buildCommand(inputName, outputName, format) {
  const command = [
    "-i",
    inputName,
    "-vn",
    ...codecByFormat[format],
    "-ar",
    sampleRateSelect.value,
  ];

  if (format !== "wav" && format !== "flac") {
    command.push("-b:a", bitrateSelect.value);
  }

  command.push(outputName);
  return command;
}

async function convertVideo(event) {
  event.preventDefault();

  if (!selectedFile) {
    setStatus("請先選擇影片檔", 0, true);
    return;
  }

  convertButton.disabled = true;
  resetDownload();

  try {
    const serverAvailable = await detectServerMode();
    if (serverAvailable) {
      await convertVideoOnServer();
      return;
    }

    if (selectedFile.size > 900 * 1024 * 1024) {
      setStatus("此檔案超過瀏覽器模式建議大小，請改用本機伺服器模式轉檔", 0, true);
      return;
    }

    await loadFFmpeg();

    const format = formatSelect.value;
    const inputName = `input-${Date.now()}.${selectedFile.name.split(".").pop() || "video"}`;
    const outputName = `${cleanName(selectedFile.name)}.${format}`;

    setStatus("正在讀取影片", 10);
    await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));

    await ffmpeg.exec(buildCommand(inputName, outputName, format));

    setStatus("正在產生下載檔", 96);
    const data = await ffmpeg.readFile(outputName);
    const audioBlob = new Blob([data.buffer], { type: mimeByFormat[format] });
    prepareDownload(audioBlob, outputName, format);

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    setStatus("轉檔完成", 100);
  } catch (error) {
    console.error(error);
    setStatus(getFriendlyError(error), 0, true);
  } finally {
    convertButton.disabled = false;
  }
}

function getFriendlyError(error) {
  const message = error?.message || String(error);

  if (message.includes("Failed to fetch")) {
    return "轉檔失敗：無法連到本機轉檔服務，請重新啟動 start-server.bat";
  }

  if (message.includes("Output file does not contain any stream")) {
    return "轉檔失敗：這個影片沒有可輸出的音軌";
  }

  if (message.includes("Invalid data found")) {
    return "轉檔失敗：影片格式無法被 FFmpeg 讀取";
  }

  if (message.includes("No space left")) {
    return "轉檔失敗：磁碟空間不足，請清出空間後再試";
  }

  const cleanMessage = message.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return cleanMessage
    ? `轉檔失敗：${cleanMessage.slice(0, 220)}`
    : "轉檔失敗，請確認影片格式或改用較小檔案再試一次";
}

async function convertVideoOnServer() {
  const format = formatSelect.value;
  const outputName = `${cleanName(selectedFile.name)}.${format}`;
  const formData = new FormData();
  const params = new URLSearchParams({
    format,
    bitrate: bitrateSelect.value,
    sample_rate: sampleRateSelect.value,
  });

  formData.append("media", selectedFile, selectedFile.name);
  setStatus("正在上傳到本機轉檔器", 12);

  const progressTimer = window.setInterval(() => {
    const current = Number.parseInt(progressPercent.textContent, 10) || 12;
    if (current < 88) setStatus("本機 FFmpeg 正在轉出音軌", current + 2);
  }, 1200);

  try {
    const response = await fetch(`/api/convert?${params.toString()}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `server conversion failed (${response.status})`);
    }

    setStatus("正在產生下載檔", 96);
    const audioBlob = await response.blob();
    prepareDownload(audioBlob, outputName, format);
    setStatus("轉檔完成", 100);
  } finally {
    window.clearInterval(progressTimer);
  }
}

async function transcribeVideo() {
  if (!selectedFile) {
    setStatus("請先選擇影片檔", 0, true);
    return;
  }

  transcribeButton.disabled = true;
  resetTranscript();

  try {
    const serverAvailable = await detectServerMode();
    if (!serverAvailable) {
      setStatus("逐字稿需要本機伺服器，請先啟動 start-server.bat", 0, true);
      return;
    }

    const formData = new FormData();
    const params = new URLSearchParams({
      language: transcriptLanguageSelect.value,
    });

    formData.append("media", selectedFile, selectedFile.name);
    setStatus("正在上傳到本機逐字稿服務", 12);

    const progressTimer = window.setInterval(() => {
      const current = Number.parseInt(progressPercent.textContent, 10) || 12;
      if (current < 92) setStatus("正在辨識語音並產生逐字稿", current + 1);
    }, 1800);

    try {
      const response = await fetch(`/api/transcribe?${params.toString()}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `transcription failed (${response.status})`);
      }

      const data = await response.json();
      transcriptOutput.value = data.text || "";
      transcriptFileName = `${cleanName(selectedFile.name)}.txt`;
      transcriptPanel.hidden = false;
      setStatus("逐字稿完成", 100);
    } finally {
      window.clearInterval(progressTimer);
    }
  } catch (error) {
    console.error(error);
    setStatus(getFriendlyError(error).replace("轉檔失敗", "逐字稿失敗"), 0, true);
  } finally {
    transcribeButton.disabled = false;
  }
}

async function copyTranscript() {
  if (!transcriptOutput.value) return;
  await navigator.clipboard.writeText(transcriptOutput.value);
  setStatus("逐字稿已複製", 100);
}

function downloadTranscript() {
  if (!transcriptOutput.value) return;

  const blob = new Blob([transcriptOutput.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = transcriptFileName || "transcript.txt";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus("已送出逐字稿下載", 100);
}

input.addEventListener("change", () => {
  const [file] = input.files;
  if (file) setSelectedFile(file);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("drag-over");

  const [file] = event.dataTransfer.files;
  if (file) {
    input.files = event.dataTransfer.files;
    setSelectedFile(file);
  }
});

form.addEventListener("submit", convertVideo);
downloadLink.addEventListener("click", downloadAudio);
transcribeButton.addEventListener("click", transcribeVideo);
copyTranscriptButton.addEventListener("click", copyTranscript);
downloadTranscriptButton.addEventListener("click", downloadTranscript);
detectServerMode();
