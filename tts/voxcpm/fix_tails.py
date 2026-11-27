"""
ตัด "เสียงเกินท้ายประโยค" ของ VoxCPM2 — พูดจบแล้วเงียบ แล้วมีคำต่อท้ายสั้นๆ ที่ไม่อยู่ในบท
  - พูดคำสุดท้ายซ้ำ: "ข้าได้ฟังเสียงของมันเสียที" → "…เสียที (เงียบ) เสียที"
  - คำมั่วต่อท้าย:   "ชาวบ้านต้องทิ้งบ้านเกิด"   → "…บ้านเกิด (เงียบ) เจน"
(พบในคลิปจริง 27 พ.ย. 2026 — 2 จาก 18 ประโยค · เกณฑ์ "ยาวเกิน 1.6 เท่า" ใน synth_voxcpm.py จับไม่ได้ เพราะเกินแค่ ~0.5 วิ)

ดูจากความดังอย่างเดียวแยกไม่ออก: คำท้ายที่ถูกต้องหลังช่องว่าง ("ค่อยๆ | เอียง") ยาวพอๆ กับเสียงเกิน
→ ถอดเสียงสองแบบ: ทั้งประโยค กับ ตัดก้อนเสียงท้ายออก · แบบตัดตรงกับบทมากกว่า = ก้อนนั้นเกิน → ตัดทิ้ง
   แบบตัดทำให้คำในบทหาย (ตรงน้อยลง) = คำจริง → เก็บไว้

job (ไฟล์เดียวกับ synth_voxcpm.py): {"segments": [{"text": "...", "out": "x.wav"}]}
ใช้:  <python ที่มี faster-whisper> tts/voxcpm/fix_tails.py job.json [--dry-run]
สถานะพิมพ์เป็น JSON ทีละบรรทัด: {"event":"trimmed","index":..,"seconds":..} / {"event":"done","trimmed":n}
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

GAP_S = 0.2  # ช่วงเงียบก่อนก้อนท้ายอย่างน้อยเท่านี้ (cap_pauses ย่อช่วงยาวเหลือ 0.3)
MAX_TAIL_S = 1.2  # ก้อนท้ายยาวกว่านี้ = เป็นวลีจริง ไม่ใช่เสียงเกิน
KEEP_S = 0.12  # เก็บความเงียบหลังคำสุดท้ายไว้เท่านี้ (2_tts ตัดหัวท้ายอีกรอบ)
_STRIP = re.compile(r"[\s.…,!?\"'“”‘’()\[\]\-–—:;ๆ]")


def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def speech_runs(wav, sr, hop_s=0.02, db=-40.0, join_s=0.12):
    """ช่วงที่มีเสียงพูด [(เริ่ม, จบ) วินาที] — รวมช่องว่างสั้นๆ ในคำเข้าด้วยกัน"""
    hop = max(1, int(sr * hop_s))
    n = len(wav) // hop
    if n < 3:
        return []
    rms = np.sqrt(np.mean(wav[: n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-9
    loud = 20 * np.log10(rms / (np.max(np.abs(wav)) + 1e-9)) > db
    runs, i = [], 0
    while i < n:
        if not loud[i]:
            i += 1
            continue
        j = i
        while j < n and loud[j]:
            j += 1
        if runs and i * hop_s - runs[-1][1] < join_s:
            runs[-1][1] = j * hop_s
        else:
            runs.append([i * hop_s, j * hop_s])
        i = j
    return runs


def tail_cut(wav, sr):
    """จุดตัดที่เป็นไปได้ (วินาที) = ต้นช่วงเงียบก่อนก้อนเสียงสุดท้าย · ไม่มี → None"""
    runs = speech_runs(wav, sr)
    if len(runs) < 2:
        return None
    gap = runs[-1][0] - runs[-2][1]
    tail = runs[-1][1] - runs[-1][0]
    if gap < GAP_S or tail > MAX_TAIL_S:
        return None
    return runs[-2][1]


def to16k(wav, sr):
    if sr == 16000:
        return wav.astype(np.float32)
    t = np.arange(int(len(wav) * 16000 / sr)) / 16000
    return np.interp(t, np.arange(len(wav)) / sr, wav).astype(np.float32)


def main():
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    dry = "--dry-run" in sys.argv
    from faster_whisper import WhisperModel

    try:
        model = WhisperModel(job.get("asr_model", "large-v3"), device="cuda", compute_type="float16")
    except Exception:
        model = WhisperModel(job.get("asr_model", "large-v3"), device="cpu", compute_type="int8")

    def heard(audio):
        parts, _ = model.transcribe(audio, language="th", beam_size=5, vad_filter=False, condition_on_previous_text=False)
        return _STRIP.sub("", "".join(p.text for p in parts))

    trimmed = 0
    for k, seg in enumerate(job["segments"]):
        out = Path(seg["out"])
        if not out.is_file():
            continue
        wav, sr = sf.read(str(out), dtype="float32")
        mono = wav.mean(axis=1) if wav.ndim > 1 else wav
        cut = tail_cut(mono, sr)
        if cut is None:
            continue
        ref = _STRIP.sub("", seg["text"])
        full = heard(to16k(mono, sr))
        head = heard(to16k(mono[: int((cut + KEEP_S) * sr)], sr))
        e_full, e_head = lev(ref, full), lev(ref, head)
        info = {"index": seg.get("index", k), "text": seg["text"], "full": full, "head": head, "err_full": e_full, "err_head": e_head}
        # ตัดแล้วตรงบทมากขึ้นจริง และไม่ใช่ถอดเสียงว่าง (เสียงเพี้ยนจน ASR ไม่ได้ยินอะไร)
        if head and e_head < e_full:
            seconds = round(len(mono) / sr - (cut + KEEP_S), 2)
            if not dry:
                n = int((cut + KEEP_S) * sr)
                fade = min(n, int(sr * 0.02))
                kept = np.array(wav[:n], copy=True)
                ramp = np.linspace(1.0, 0.0, fade, dtype=np.float32)
                kept[n - fade:] *= ramp[:, None] if kept.ndim > 1 else ramp
                sf.write(str(out), kept, sr)
            trimmed += 1
            print(json.dumps({"event": "trimmed", "seconds": seconds, **info}, ensure_ascii=False), flush=True)
        else:
            print(json.dumps({"event": "kept", **info}, ensure_ascii=False), flush=True)
    print(json.dumps({"event": "done", "trimmed": trimmed}), flush=True)


if __name__ == "__main__":
    main()
