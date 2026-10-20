"""On-demand, local MMS text-to-speech worker for AIPFA (non-commercial use)."""
import io
import json
import os
import re
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
from transformers import AutoTokenizer, VitsModel
try:
    from num2words import num2words
except ImportError:
    num2words = None

PORT = int(os.environ.get("AIPFA_TTS_PORT", "39173"))
LANGUAGE_MODELS = {
    "en-us": "eng", "en-gb": "eng", "en-in": "eng", "en": "eng",
    "bn-bd": "ben", "bn-in": "ben", "bn": "ben",
    "zh-cn": "cmn", "zh-tw": "cmn", "zh": "cmn",
    "es-es": "spa", "es": "spa", "fr-fr": "fra", "fr": "fra",
    "de-de": "deu", "de": "deu", "hi-in": "hin", "hi": "hin",
    "ar-sa": "ara", "ar": "ara", "pt-br": "por", "pt-pt": "por", "pt": "por",
    "ru-ru": "rus", "ru": "rus", "ja-jp": "jpn", "ja": "jpn",
    "ko-kr": "kor", "ko": "kor", "ur-pk": "urd", "ur": "urd",
    "it-it": "ita", "it": "ita", "id-id": "ind", "id": "ind",
    "tr-tr": "tur", "tr": "tur", "nl-nl": "nld", "nl": "nld",
    "vi-vn": "vie", "vi": "vie", "th-th": "tha", "th": "tha",
}
torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
model_lock = threading.Lock()
current_code = None
current_model = None
current_tokenizer = None
# Keep the requested South Asian and Turkish TTS models warm so switching
# between these languages does not reload large model weights on every turn.
priority_models = {}

NUMBER_WORD_LANGUAGES = {
    "eng": "en", "ben": "bn", "ara": "ar", "tur": "tr", "hin": "hi",
    "spa": "es", "fra": "fr", "deu": "de", "por": "pt", "rus": "ru",
    "ita": "it", "ind": "id", "nld": "nl", "vie": "vi", "tha": "th",
    "cmn": "zh_CN", "kor": "ko",
}


def normalize_numbers_for_speech(text, model_code):
    """Expand digits to spoken words for MMS; keep the visible chat text untouched."""
    if model_code == "urd":
        urdu_units = ["صفر", "ایک", "دو", "تین", "چار", "پانچ", "چھ", "سات", "آٹھ", "نو", "دس", "گیارہ", "بارہ", "تیرہ", "چودہ", "پندرہ", "سولہ", "سترہ", "اٹھارہ", "انیس"]
        urdu_tens = ["", "", "بیس", "تیس", "چالیس", "پچاس", "ساٹھ", "ستر", "اسی", "نوے"]

        def urdu_integer(number):
            if number < 20:
                return urdu_units[number]
            if number < 100:
                return urdu_tens[number // 10] + ((" " + urdu_units[number % 10]) if number % 10 else "")
            if number < 1000:
                return urdu_units[number // 100] + " سو" + ((" " + urdu_integer(number % 100)) if number % 100 else "")
            scale = 10000000 if number >= 10000000 else 100000 if number >= 100000 else 1000
            scale_word = "کروڑ" if scale == 10000000 else "لاکھ" if scale == 100000 else "ہزار"
            return urdu_integer(number // scale) + " " + scale_word + ((" " + urdu_integer(number % scale)) if number % scale else "")

        def expand_urdu(match):
            raw = match.group(0)
            value = raw.replace(",", "").replace("٬", "")
            if "." in value:
                return raw
            try:
                number = int(value)
                return ("منفی " if number < 0 else "") + urdu_integer(abs(number))
            except (ValueError, RecursionError):
                return raw

        return re.sub(r"(?<![\w])[-+]?\d[\d,٬]*(?:\.\d+)?(?![\w])", expand_urdu, text)
    if not num2words:
        return text
    language = NUMBER_WORD_LANGUAGES.get(model_code)
    if not language:
        return text

    def expand(match):
        raw = match.group(0)
        value = raw.replace(",", "").replace("٬", "")
        try:
            number = float(value) if "." in value else int(value)
            return num2words(number, lang=language)
        except (ValueError, TypeError, NotImplementedError, OverflowError):
            return raw

    return re.sub(r"(?<![\w])[-+]?\d[\d,٬]*(?:\.\d+)?(?![\w])", expand, text)


def json_response(handler, status, payload):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path == "/health":
            return json_response(self, 200, {"status": "ready"})
        return json_response(self, 404, {"error": "Not found."})

    def do_POST(self):
        global current_code, current_model, current_tokenizer
        if self.path != "/synthesize":
            return json_response(self, 404, {"error": "Not found."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 16000:
                return json_response(self, 400, {"error": "Text request is too large."})
            payload = json.loads(self.rfile.read(size))
            text = str(payload.get("text", "")).strip()
            language = str(payload.get("language", "en-US")).strip().lower()
            model_code = LANGUAGE_MODELS.get(language)
            if not model_code and re.fullmatch(r"[a-z]{3}(?:-[a-z0-9_]+)*", language):
                model_code = language
            if not model_code:
                return json_response(self, 400, {"error": "This language is not in the current AIPFA voice-language list."})
            if not text or len(text) > 900:
                return json_response(self, 400, {"error": "Speech text is empty or too long."})

            with model_lock:
                cached_model = priority_models.get(model_code)
                if cached_model:
                    current_tokenizer, current_model = cached_model
                    current_code = model_code
                elif current_code != model_code:
                    current_model = None
                    current_tokenizer = None
                    current_code = None
                    import gc
                    gc.collect()
                    model_id = "facebook/mms-tts-urd-script_arabic" if model_code == "urd" else "facebook/mms-tts-" + model_code
                    current_tokenizer = AutoTokenizer.from_pretrained(model_id)
                    current_model = VitsModel.from_pretrained(model_id).to("cpu").eval()
                    current_code = model_code
                    if model_code in {"ben", "tur", "urd", "ara"}:
                        priority_models[model_code] = (current_tokenizer, current_model)
                speech_text = normalize_numbers_for_speech(text, model_code)
                inputs = current_tokenizer(speech_text, return_tensors="pt")
                torch.manual_seed(42)
                with torch.inference_mode():
                    waveform = current_model(**inputs).waveform[0].cpu().numpy()
                pcm = (np.clip(waveform, -1.0, 1.0) * 32767).astype(np.int16)
                output = io.BytesIO()
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(current_model.config.sampling_rate)
                    wav.writeframes(pcm.tobytes())
                audio = output.getvalue()

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except Exception as error:
            print("[TTS] synthesis failed:", type(error).__name__, flush=True)
            json_response(self, 503, {"error": "The voice model could not be loaded or generated speech."})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("[TTS] local MMS service ready", flush=True)
    server.serve_forever()
