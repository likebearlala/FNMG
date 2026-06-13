from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from email.parser import Parser


ROOT = Path(__file__).resolve().parent
WORK = ROOT / ".converter_tmp"
WORK.mkdir(exist_ok=True)
tempfile.tempdir = str(WORK)

CODECS = {
    "mp3": ["-codec:a", "libmp3lame"],
    "wav": ["-codec:a", "pcm_s16le"],
    "aac": ["-codec:a", "aac"],
    "ogg": ["-codec:a", "libvorbis"],
    "flac": ["-codec:a", "flac"],
    "m4a": ["-codec:a", "aac"],
}

MIMES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "aac": "audio/aac",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "m4a": "audio/mp4",
}

TRANSCRIBERS = ("whisper", "faster-whisper", "whisper-cli")
WHISPER_CPP_MODEL = ROOT / "models" / "ggml-base.bin"


def write_log(message):
    with (ROOT / "server-error.log").open("a", encoding="utf-8") as log:
        log.write(message.rstrip() + "\n")


def safe_name(name):
    stem = Path(name).stem or "audio"
    return re.sub(r"[^\w\u4e00-\u9fff-]+", "_", stem)


def find_transcriber():
    for command in TRANSCRIBERS:
        path = shutil.which(command)
        if path:
            return command

    try:
        import whisper  # noqa: F401
    except ImportError:
        return None

    return "python-whisper-module"


def run_command(command):
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    return None


def parse_boundary(content_type):
    match = re.search(r'boundary="?([^";]+)"?', content_type or "")
    return match.group(1).encode("utf-8") if match else None


def read_part_headers(stream):
    header_lines = []
    bytes_read = 0

    while True:
        line = stream.readline()
        bytes_read += len(line)
        if line in {b"", b"\r\n", b"\n"}:
            break
        header_lines.append(line.decode("utf-8", "replace"))

    return Parser().parsestr("".join(header_lines)), bytes_read


def stream_part_to_file(stream, output_path, boundary, remaining):
    delimiter = b"\r\n--" + boundary
    keep = len(delimiter) + 4
    pending = b""

    with output_path.open("wb") as target:
        while remaining > 0:
            chunk_size = min(1024 * 1024, remaining)
            chunk = stream.read(chunk_size)
            if not chunk:
                raise ValueError("上傳資料不完整")

            remaining -= len(chunk)
            data = pending + chunk
            marker = data.find(delimiter)

            if marker >= 0:
                target.write(data[:marker])
                return

            if len(data) > keep:
                target.write(data[:-keep])
                pending = data[-keep:]
            else:
                pending = data

    raise ValueError("找不到上傳檔案結尾")


def save_uploaded_file(handler, job_dir, field_names):
    boundary = parse_boundary(handler.headers.get("Content-Type"))
    if not boundary:
        raise ValueError("上傳格式不正確")

    content_length = int(handler.headers.get("Content-Length", "0"))
    first_line = handler.rfile.readline()
    consumed = len(first_line)
    if not first_line.startswith(b"--" + boundary):
        raise ValueError("沒有收到影片檔")

    headers, header_bytes = read_part_headers(handler.rfile)
    consumed += header_bytes
    disposition = headers.get("Content-Disposition", "")
    name_match = re.search(r'name="([^"]+)"', disposition)
    filename_match = re.search(r'filename="([^"]*)"', disposition)

    if not name_match or name_match.group(1) not in field_names or not filename_match:
        raise ValueError("沒有收到媒體檔")

    filename = Path(filename_match.group(1)).name
    input_path = job_dir / f"input{Path(filename).suffix or '.video'}"
    stream_part_to_file(handler.rfile, input_path, boundary, content_length - consumed)
    return filename, input_path


def run_transcription(transcriber, input_path, output_dir, language):
    if transcriber in {"whisper", "python-whisper-module"}:
        command = [
            *(["whisper"] if transcriber == "whisper" else [sys.executable, "-m", "whisper"]),
            str(input_path),
            "--model",
            "base",
            "--task",
            "transcribe",
            "--output_format",
            "txt",
            "--output_dir",
            str(output_dir),
            "--fp16",
            "False",
        ]
        if language != "auto":
            command.extend(["--language", language])
    elif transcriber == "faster-whisper":
        command = [
            "faster-whisper",
            str(input_path),
            "--model",
            "base",
            "--output_dir",
            str(output_dir),
            "--output_format",
            "txt",
        ]
        if language != "auto":
            command.extend(["--language", language])
    elif transcriber == "whisper-cli":
        if not WHISPER_CPP_MODEL.exists():
            raise RuntimeError(
                f"找不到 whisper.cpp 模型檔：{WHISPER_CPP_MODEL}。請放入 ggml-base.bin。"
            )

        wav_path = output_dir / "transcribe.wav"
        extract = run_command(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(input_path),
                "-vn",
                "-ar",
                "16000",
                "-ac",
                "1",
                str(wav_path),
            ],
        )
        if extract.returncode != 0:
            detail = extract.stderr[-1600:] if extract.stderr else "無法抽出音軌"
            write_log(detail)
            raise RuntimeError("無法抽出音軌：" + detail)

        output_prefix = output_dir / "transcript"
        command = [
            "whisper-cli",
            "-m",
            str(WHISPER_CPP_MODEL),
            "-f",
            str(wav_path),
            "-otxt",
            "-of",
            str(output_prefix),
        ]
        if language != "auto":
            command.extend(["-l", language])
    else:
        raise RuntimeError("不支援的逐字稿工具")

    result = run_command(command)
    if result.returncode != 0:
        detail = result.stderr[-2000:] or result.stdout[-2000:] or "語音辨識失敗"
        write_log(detail)
        raise RuntimeError("語音辨識失敗：" + detail)

    candidates = sorted(output_dir.glob("*.txt"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        detail = result.stdout[-1200:] or "語音辨識沒有產生 TXT 檔"
        write_log(detail)
        raise RuntimeError("語音辨識沒有產生逐字稿")

    return candidates[0].read_text(encoding="utf-8", errors="replace").strip()


class ConverterHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/health"):
            payload = json.dumps(
                {
                    "ok": True,
                    "transcription": find_transcriber() is not None,
                }
            ).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        super().do_GET()

    def do_POST(self):
        try:
            if self.path.startswith("/api/transcribe"):
                self.handle_transcribe()
            else:
                self.handle_convert()
        except Exception:
            detail = traceback.format_exc()
            write_log(detail)
            self.send_plain_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "轉檔服務發生錯誤，請查看 server-error.log",
            )

    def send_plain_error(self, status, message):
        payload = message.encode("utf-8", "replace")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_convert(self):
        if not self.path.startswith("/api/convert"):
            self.send_plain_error(HTTPStatus.NOT_FOUND, "找不到轉檔 API")
            return

        query = parse_qs(urlparse(self.path).query)
        fmt = query.get("format", ["mp3"])[0]
        bitrate = query.get("bitrate", ["192k"])[0]
        sample_rate = query.get("sample_rate", ["44100"])[0]

        if fmt not in CODECS:
            self.send_plain_error(HTTPStatus.BAD_REQUEST, "不支援的輸出格式")
            return

        if not re.fullmatch(r"\d{2,4}k", bitrate):
            self.send_plain_error(HTTPStatus.BAD_REQUEST, "位元率格式不正確")
            return

        if sample_rate not in {"44100", "48000", "96000"}:
            self.send_plain_error(HTTPStatus.BAD_REQUEST, "取樣率不正確")
            return

        job_dir = Path(tempfile.mkdtemp(prefix="job-", dir=WORK))

        try:
            try:
                original_name, input_path = save_uploaded_file(self, job_dir, {"media", "video"})
            except ValueError as error:
                self.send_plain_error(HTTPStatus.BAD_REQUEST, str(error))
                return

            output_path = job_dir / f"{safe_name(original_name)}.{fmt}"

            command = [
                "ffmpeg",
                "-y",
                "-i",
                str(input_path),
                "-vn",
                *CODECS[fmt],
                "-ar",
                sample_rate,
            ]

            if fmt not in {"wav", "flac"}:
                command.extend(["-b:a", bitrate])

            command.append(str(output_path))
            try:
                result = subprocess.run(command, capture_output=True, text=True)
            except FileNotFoundError:
                self.send_plain_error(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "找不到 ffmpeg，請確認已安裝 FFmpeg 並加入 PATH",
                )
                return

            if result.returncode != 0 or not output_path.exists():
                detail = result.stderr[-1600:] if result.stderr else "FFmpeg 轉檔失敗"
                write_log(detail)
                self.send_plain_error(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "FFmpeg 轉檔失敗：" + detail,
                )
                return

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", MIMES[fmt])
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{output_path.name.encode("ascii", "ignore").decode() or "audio." + fmt}"',
            )
            self.send_header("Content-Length", str(output_path.stat().st_size))
            self.end_headers()

            with output_path.open("rb") as source:
                shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    def handle_transcribe(self):
        if not self.path.startswith("/api/transcribe"):
            self.send_plain_error(HTTPStatus.NOT_FOUND, "找不到逐字稿 API")
            return

        transcriber = find_transcriber()
        if not transcriber:
            self.send_plain_error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "尚未安裝語音辨識工具。請安裝 OpenAI Whisper：python -m pip install -U openai-whisper，並確認 whisper 指令可用。",
            )
            return

        query = parse_qs(urlparse(self.path).query)
        language = query.get("language", ["auto"])[0]
        if language not in {"auto", "zh", "en", "ja", "ko"}:
            self.send_plain_error(HTTPStatus.BAD_REQUEST, "逐字稿語言設定不正確")
            return

        job_dir = Path(tempfile.mkdtemp(prefix="transcript-", dir=WORK))

        try:
            try:
                original_name, input_path = save_uploaded_file(self, job_dir, {"media", "video"})
            except ValueError as error:
                self.send_plain_error(HTTPStatus.BAD_REQUEST, str(error))
                return

            try:
                transcript_text = run_transcription(
                    transcriber=transcriber,
                    input_path=input_path,
                    output_dir=job_dir,
                    language=language,
                )
            except RuntimeError as error:
                self.send_plain_error(HTTPStatus.UNPROCESSABLE_ENTITY, str(error))
                return

            payload = json.dumps(
                {
                    "file": original_name,
                    "text": transcript_text,
                    "engine": transcriber,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)


if __name__ == "__main__":
    os.chdir(ROOT)
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), ConverterHandler)
    print(f"影片轉音檔工具已啟動：http://127.0.0.1:{port}/")
    server.serve_forever()
