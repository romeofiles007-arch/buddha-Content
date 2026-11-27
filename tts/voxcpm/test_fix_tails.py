"""เทสต์ fix_tails — หาจุดตัดก่อน "ก้อนเสียงท้าย" (ไม่ต้องมี Whisper)

    python tts/voxcpm/test_fix_tails.py   (ต้องมี numpy + soundfile)
"""
import importlib.util
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("fix_tails", Path(__file__).with_name("fix_tails.py"))
ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)

SR = 24000
tone = lambda s: (0.5 * np.sin(np.linspace(0, 2 * np.pi * 220 * s, int(SR * s)))).astype(np.float32)
quiet = lambda s: np.zeros(int(SR * s), dtype=np.float32)
passed = 0


def check(name, cond):
    global passed
    assert cond, name
    passed += 1
    print(f"  ✓ {name}")


# เคสจริง: "…บ้านเกิด" (จบ 3.34 วิ) เงียบ 0.34 แล้ว "เจน" 0.34 วิ
wav = np.concatenate([quiet(0.3), tone(3.04), quiet(0.34), tone(0.34), quiet(0.2)])
cut = ft.tail_cut(wav, SR)
check("พูดจบ เงียบ 0.34 แล้วมีก้อนสั้น 0.34 วิ → จุดตัดอยู่ท้ายคำจริง (~3.34 วิ)", cut is not None and abs(cut - 3.34) < 0.03)

check("ไม่มีช่วงเงียบก่อนคำท้าย → ไม่มีอะไรให้ตัด", ft.tail_cut(np.concatenate([tone(2.0), quiet(0.05), tone(0.4), quiet(0.2)]), SR) is None)
check("ก้อนท้ายยาว 1.5 วิ = วลีจริง ไม่ตัด", ft.tail_cut(np.concatenate([tone(1.0), quiet(0.3), tone(1.5)]), SR) is None)
check("ทั้งประโยคต่อเนื่อง → None", ft.tail_cut(np.concatenate([quiet(0.2), tone(2.5), quiet(0.3)]), SR) is None)
check("เงียบทั้งไฟล์ → None", ft.tail_cut(quiet(2.0), SR) is None)
check("lev: นับคำเกินท้าย 'เจน' = 3", ft.lev("ทิ้งบ้านเกิด", "ทิ้งบ้านเกิดเจน") == 3)
check("ตัดเครื่องหมาย/ช่องว่าง/ไม้ยมกก่อนเทียบ", ft._STRIP.sub("", "“วันนี้... ข้า ค่อยๆ”") == "วันนี้ข้าค่อย")

print(f"\nผ่าน {passed} ข้อ")
