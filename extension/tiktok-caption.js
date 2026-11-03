// Let the site's editor handle real browser editing events. Replacing its DOM
// children directly can detach React-owned nodes and crash the next render.
export async function insertTikTokCaption(command, caption) {
  const focused = await command('Runtime.evaluate', {
    expression: `(() => {
      const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(e => e.getClientRects().length > 0);
      if (editors.length !== 1) return false;
      editors[0].focus();
      return document.activeElement === editors[0];
    })()`, returnByValue: true,
  })
  if (focused.result?.value !== true) throw new Error('ไม่พบช่องคำบรรยาย TikTok ที่แน่นอน — หยุดก่อนกรอกข้อความ')
  const select = { key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 }
  await command('Input.dispatchKeyEvent', { type: 'keyDown', ...select })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', ...select })
  await command('Input.insertText', { text: caption })
}
