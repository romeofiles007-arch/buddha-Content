// Let the site's editor handle real browser editing events. Replacing its DOM
// children directly can detach React-owned nodes and crash the next render.
const EDITOR = `[...document.querySelectorAll('[contenteditable="true"]')].filter(e => e.getClientRects().length > 0)`

// เลือกข้อความทั้งช่องแล้วหรือยัง (ช่องว่าง = ถือว่าเลือกแล้ว)
const SELECTED_ALL = `(() => {
  const editors = ${EDITOR};
  if (editors.length !== 1) return false;
  const editor = editors[0];
  const all = (editor.innerText || '').replace(/\\s+/g, '');
  if (!all) return true;
  const sel = getSelection();
  if (!sel?.rangeCount || !editor.contains(sel.anchorNode) || !editor.contains(sel.focusNode)) return false;
  return sel.toString().replace(/\\s+/g, '') === all;
})()`

export async function insertTikTokCaption(command, caption) {
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, returnByValue: true })).result?.value
  const focused = await evaluate(`(() => {
    const editors = ${EDITOR};
    if (editors.length !== 1) return false;
    editors[0].focus();
    return document.activeElement === editors[0];
  })()`)
  if (focused !== true) throw new Error('ไม่พบช่องคำบรรยาย TikTok ที่แน่นอน — หยุดก่อนกรอกข้อความ')

  // Ctrl+A ที่ยิงผ่าน debugger ไม่เลือกข้อความในช่องของ TikTok (5 พ.ย. 2026: ข้อความใหม่ไปต่อท้ายชื่อไฟล์ทุกรอบ)
  // → สั่ง selectAll ตรงๆ ก่อน ไม่ได้ผลค่อยเลือกด้วย Range ของหน้าเว็บ แล้วตรวจว่าเลือกครบจริงก่อนพิมพ์ทับ
  const select = { key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 }
  await command('Input.dispatchKeyEvent', { type: 'keyDown', ...select, commands: ['selectAll'] })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', ...select })
  await new Promise(resolve => setTimeout(resolve, 150))
  if (await evaluate(SELECTED_ALL) !== true) {
    await evaluate(`(() => {
      const editor = (${EDITOR})[0];
      const range = document.createRange();
      range.selectNodeContents(editor);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    })()`)
    await new Promise(resolve => setTimeout(resolve, 300)) // ให้ editor ของ TikTok รับรู้ selection ใหม่
  }
  if (await evaluate(SELECTED_ALL) !== true) throw new Error('เลือกข้อความเดิมในช่องคำบรรยาย TikTok ไม่ได้ — หยุดก่อนกรอก เพื่อไม่ให้ข้อความต่อท้ายของเดิม')
  await command('Input.insertText', { text: caption })
}
