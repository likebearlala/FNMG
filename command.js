const localPathInput = document.querySelector("#local-path-input");
const outputPathInput = document.querySelector("#output-path-input");
const formatSelect = document.querySelector("#format-select");
const bitrateSelect = document.querySelector("#bitrate-select");
const sampleRateSelect = document.querySelector("#sample-rate-select");
const transcriptLanguageSelect = document.querySelector("#transcript-language-select");
const generateAudioCommandButton = document.querySelector("#generate-audio-command-button");
const generateTranscriptCommandButton = document.querySelector("#generate-transcript-command-button");
const copyCommandButton = document.querySelector("#copy-command-button");
const commandOutput = document.querySelector("#command-output");
const statusText = document.querySelector("#status-text");

const powershellCodecByFormat = {
  mp3: "-codec:a libmp3lame",
  wav: "-codec:a pcm_s16le",
  aac: "-codec:a aac",
  ogg: "-codec:a libvorbis",
  flac: "-codec:a flac",
  m4a: "-codec:a aac",
};

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
}

function quotePowerShell(value) {
  return `"${value.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

function stripQuotes(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function getWindowsStem(path) {
  const name = stripQuotes(path).split(/[\\/]/).pop() || "output";
  return name.replace(/\.[^/.]+$/, "") || "output";
}

function getWindowsDirectory(path) {
  const cleanPath = stripQuotes(path);
  const lastSlash = Math.max(cleanPath.lastIndexOf("\\"), cleanPath.lastIndexOf("/"));
  return lastSlash >= 0 ? cleanPath.slice(0, lastSlash) : ".";
}

function resolveOutputPath(inputPath, extension) {
  const requested = stripQuotes(outputPathInput.value);
  const cleanInput = stripQuotes(inputPath);

  if (!requested) {
    return `${getWindowsDirectory(cleanInput)}\\${getWindowsStem(cleanInput)}.${extension}`;
  }

  if (/\.[A-Za-z0-9]{2,5}$/.test(requested)) {
    return requested;
  }

  return `${requested.replace(/[\\/]$/, "")}\\${getWindowsStem(cleanInput)}.${extension}`;
}

function resolveTranscriptOutputDirectory(inputPath) {
  const requested = stripQuotes(outputPathInput.value);
  if (!requested) return getWindowsDirectory(inputPath);

  if (/\.[A-Za-z0-9]{2,5}$/.test(requested)) {
    return getWindowsDirectory(requested);
  }

  return requested;
}

function requireLocalPath() {
  const inputPath = stripQuotes(localPathInput.value);
  if (!inputPath) {
    setStatus("請先輸入本機檔案完整路徑", true);
    localPathInput.focus();
    return "";
  }

  return inputPath;
}

function generateAudioCommand() {
  const inputPath = requireLocalPath();
  if (!inputPath) return;

  const format = formatSelect.value;
  const outputPath = resolveOutputPath(inputPath, format);
  const bitrate = format === "wav" || format === "flac" ? "" : ` -b:a ${bitrateSelect.value}`;
  commandOutput.value = [
    `$inputFile = ${quotePowerShell(inputPath)}`,
    `$outputFile = ${quotePowerShell(outputPath)}`,
    `ffmpeg -y -i $inputFile -vn ${powershellCodecByFormat[format]} -ar ${sampleRateSelect.value}${bitrate} $outputFile`,
  ].join("\n");

  setStatus("已產生轉音檔 PowerShell 指令");
}

function generateTranscriptCommand() {
  const inputPath = requireLocalPath();
  if (!inputPath) return;

  const outputDir = resolveTranscriptOutputDirectory(inputPath);
  const language = transcriptLanguageSelect.value;
  const languageOption = language === "auto" ? "" : ` --language ${language}`;
  commandOutput.value = [
    `$inputFile = ${quotePowerShell(inputPath)}`,
    `$outputDir = ${quotePowerShell(outputDir)}`,
    `python -m whisper $inputFile --model base --task transcribe${languageOption} --output_format txt --output_dir $outputDir --fp16 False`,
  ].join("\n");

  setStatus("已產生逐字稿 PowerShell 指令");
}

async function copyGeneratedCommand() {
  if (!commandOutput.value) {
    setStatus("請先產生 PowerShell 指令", true);
    return;
  }

  await navigator.clipboard.writeText(commandOutput.value);
  setStatus("PowerShell 指令已複製");
}

generateAudioCommandButton.addEventListener("click", generateAudioCommand);
generateTranscriptCommandButton.addEventListener("click", generateTranscriptCommand);
copyCommandButton.addEventListener("click", copyGeneratedCommand);
