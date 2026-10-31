---
name: ธรรมะ Auto
description: 'สตูดิโอทำคลิปธรรมะ: สามหมวดเปลี่ยนโลกทั้งแอป ภาพผู้ใหญ่สมจริง'
colors:
  buddha-light-ok: '#315e3f'
  buddha-light-warn: '#785015'
  buddha-light-danger: '#a72d27'
  buddha-light-accent-ink: '#fff9ed'
  buddha-light-bg: '#f3df9e'
  buddha-light-panel: '#fff2c9'
  buddha-light-ink: '#382a0b'
  buddha-light-muted: '#68531e'
  buddha-light-accent: '#74500b'
  buddha-light-line: '#9c751e'
  buddha-light-pick: '#edd38a'
  buddha-light-wood: '#3b2c0e'
  buddha-light-gold: '#e5ba45'
  buddha-dark-ok: '#acd2a0'
  buddha-dark-warn: '#edc47c'
  buddha-dark-danger: '#ffb0a1'
  buddha-dark-accent-ink: '#301d0e'
  buddha-dark-bg: '#241c08'
  buddha-dark-panel: '#35290d'
  buddha-dark-ink: '#fff1c4'
  buddha-dark-muted: '#d1be82'
  buddha-dark-accent: '#f0cf70'
  buddha-dark-line: '#b3923b'
  buddha-dark-pick: '#4b3b0e'
  buddha-dark-wood: '#231906'
  buddha-dark-gold: '#efc857'
  monk-light-ok: '#315e3f'
  monk-light-warn: '#80531b'
  monk-light-danger: '#a72d27'
  monk-light-accent-ink: '#fff9ed'
  monk-light-bg: '#eef0e7'
  monk-light-panel: '#fafaf3'
  monk-light-ink: '#27342a'
  monk-light-muted: '#52654f'
  monk-light-accent: '#375b40'
  monk-light-line: '#85977a'
  monk-light-pick: '#e0e8d6'
  monk-light-wood: '#233025'
  monk-light-gold: '#b9a46b'
  monk-dark-ok: '#acd2a0'
  monk-dark-warn: '#edc47c'
  monk-dark-danger: '#ffb0a1'
  monk-dark-accent-ink: '#301d0e'
  monk-dark-bg: '#141e17'
  monk-dark-panel: '#212d22'
  monk-dark-ink: '#eff3dd'
  monk-dark-muted: '#bcc8ad'
  monk-dark-accent: '#b7cf94'
  monk-dark-line: '#7e9773'
  monk-dark-pick: '#31442e'
  monk-dark-wood: '#152016'
  monk-dark-gold: '#b9c59b'
  dhamma-light-ok: '#315e3f'
  dhamma-light-warn: '#80531b'
  dhamma-light-danger: '#a72d27'
  dhamma-light-accent-ink: '#fff9ed'
  dhamma-light-bg: '#f1ede5'
  dhamma-light-panel: '#fffaf2'
  dhamma-light-ink: '#34332a'
  dhamma-light-muted: '#655f4e'
  dhamma-light-accent: '#645c31'
  dhamma-light-line: '#9b927b'
  dhamma-light-pick: '#e8e4d3'
  dhamma-light-wood: '#343326'
  dhamma-light-gold: '#d3c28b'
  dhamma-dark-ok: '#acd2a0'
  dhamma-dark-warn: '#edc47c'
  dhamma-dark-danger: '#ffb0a1'
  dhamma-dark-accent-ink: '#301d0e'
  dhamma-dark-bg: '#1e1d17'
  dhamma-dark-panel: '#2b2a21'
  dhamma-dark-ink: '#f5efda'
  dhamma-dark-muted: '#c7c0a7'
  dhamma-dark-accent: '#d3c28b'
  dhamma-dark-line: '#9a8e70'
  dhamma-dark-pick: '#403c2b'
  dhamma-dark-wood: '#242319'
  dhamma-dark-gold: '#d3c28b'
  icon-master-robe: '#8f301d'
  icon-master-gold: '#f4ca78'
  icon-master-ivory: '#fff5db'
  hero-ink: '#fff8e9'
  hero-muted: '#eee0ca'
  buddha-light-action: '#d8aa3c'
  buddha-light-action-ink: '#342303'
  buddha-dark-action: '#e4b747'
  buddha-dark-action-ink: '#2f2206'
typography:
  body:
    fontFamily: '"Noto Sans Thai", "Leelawadee UI", system-ui, sans-serif'
    fontSize: 15px
    lineHeight: 1.55
  brand:
    fontSize: 22px
    fontWeight: 650
    lineHeight: 1.4
  headline:
    fontSize: 18px
    fontWeight: 750
    lineHeight: 1.55
  hero-title:
    fontSize: 20px
    fontWeight: 650
    lineHeight: 1.55
  hero-sub:
    fontSize: 13px
    lineHeight: 1.65
  label:
    fontSize: 13px
  hint:
    fontSize: 12px
    lineHeight: 1.7
  meta:
    fontSize: 11px
  terminal:
    fontFamily: Consolas, "Courier New", monospace
    fontSize: 12.5px
    lineHeight: 1.6
rounded:
  field: 9px
  button: 7px
  crew: 8px
  section: 12px
  hero: 12px
  category-picker: 10px
  chip: 99px
spacing:
  compact: 8px
  control: 10px
  gap: 12px
  inset: 14px
  section: 16px
  step: 22px
components:
  button-primary:
    backgroundColor: '{colors.dhamma-light-accent}'
    textColor: '{colors.dhamma-light-accent-ink}'
    rounded: '{rounded.button}'
    padding: 10px 15px
    height: 44px
  button-primary-dark:
    backgroundColor: '{colors.dhamma-dark-accent}'
    textColor: '{colors.dhamma-dark-accent-ink}'
    rounded: '{rounded.button}'
    padding: 10px 15px
    height: 44px
  button-ghost:
    backgroundColor: '{colors.dhamma-light-panel}'
    textColor: '{colors.dhamma-light-ink}'
    rounded: '{rounded.button}'
    padding: 8px 12px
  button-danger:
    backgroundColor: '{colors.dhamma-light-panel}'
    textColor: '{colors.dhamma-light-danger}'
    rounded: '{rounded.button}'
    padding: 8px 12px
  input-topic:
    backgroundColor: '{colors.dhamma-light-panel}'
    textColor: '{colors.dhamma-light-ink}'
    rounded: '{rounded.field}'
    padding: 8px 10px
  card-section:
    backgroundColor: '{colors.dhamma-light-panel}'
    textColor: '{colors.dhamma-light-ink}'
    rounded: '{rounded.section}'
    padding: 16px 14px
  crew-selector:
    backgroundColor: '{colors.dhamma-light-panel}'
    rounded: '{rounded.crew}'
    width: 52px
    height: 52px
  chip-done:
    textColor: '{colors.dhamma-light-ok}'
    rounded: '{rounded.chip}'
    padding: 1px 7px
  category-picker:
    backgroundColor: '{colors.dhamma-light-panel}'
    textColor: '{colors.dhamma-light-muted}'
    rounded: '{rounded.category-picker}'
    padding: 13px 14px
  button-gold:
    backgroundColor: '{colors.buddha-light-action}'
    textColor: '{colors.buddha-light-action-ink}'
    rounded: '{rounded.button}'
    padding: 10px 15px
  button-gold-dark:
    backgroundColor: '{colors.buddha-dark-action}'
    textColor: '{colors.buddha-dark-action-ink}'
    rounded: '{rounded.button}'
    padding: 10px 15px
---

# Design System: ธรรมะ Auto

## Overview

**Creative North Star: "สามพื้นที่แห่งธรรมะสำหรับผู้ใหญ่"**

ธรรมะ Auto ใช้หมวดเนื้อหาเป็นโลกของแอป พุทธประวัติและพุทธพจน์อยู่ในพุทธสถานหินทรายใต้ต้นโพธิ์ พระเกจิอาจารย์อยู่ในวัดป่ากุฏิไม้ ธรรมะสำหรับพุทธศาสนิกชนอยู่ในลานปฏิบัติธรรมร่วมสมัย แต่ละหมวดมีภาพกลางวันและกลางคืน สี และตราประจำหมวดของตนเอง

ภาพสถานที่มีสัดส่วนจริงและวัสดุสมจริง ทีมงานทั้งห้าเป็นผู้ใหญ่วัยประมาณ 35–55 ปี สัดส่วนศีรษะและดวงตาธรรมชาติ บุคลิกสุขุม สำรวม และเป็นมืออาชีพ ข้อมูลและการเริ่มงานยังเป็นจุดสำคัญของหน้าจอ ใช้พื้นทึบรองข้อความไทย พร้อมเส้นขอบและสถานะจริง ทิศทางนี้แทนที่ตัวละครเด็ก เณรน้อย และความน่ารักของแบบก่อนหน้า ตามคำแก้ไขโดยตรงของผู้ใช้

**Key Characteristics:**
- หมวดเนื้อหาเปลี่ยนฉาก สี ตรา และหน้าต่างทั้งแอปทันที
- สามสถานที่ต่างกันจริง พร้อมภาพกลางวัน/กลางคืนหกใบ
- ทีมผู้ใหญ่ 3D สมจริงห้าคนร่วมกันทุกหมวด ไม่มีภาพเด็กหรือ chibi
- แบบฟอร์มบนพื้นทึบ สถานะจริง และการเคลื่อนไหวเฉพาะทำงาน

เอกสารนี้เป็น scan ของ source ที่ส่งมอบ ไม่ใช่ seed อำนาจด้านหมวดและความเป็นผู้ใหญ่คือคำแก้ไขล่าสุดของผู้ใช้ `extension/category-themes.js` เป็นแหล่งสี/ฉาก/ตราหมวดและสร้าง style `category-theme-tokens`; `category-themes.css` กำหนดรูปร่างสุดท้ายเหนือ `temple.css` ฟอนต์/โครงสร้างมาจาก `sidepanel.html` และ renderer จาก `agents.js`

## Colors

หมวดพุทธประวัติใช้ธีมทองชัด: พื้นทองอ่อน ปุ่มและตัวเลือกหลักทองสว่างพร้อมหมึกเข้ม `action/action-ink` แยกจาก `accent` ทองเข้มที่ใช้กับลิงก์และข้อความ เพื่อรักษาความชัดทั้งธีมสว่างและมืด

### Primary

Frontmatter เก็บค่าสีแยกตาม `{category}-{light|dark}-{role}` โดยคงค่า hex จาก source ทุกค่า ตัวอย่าง component ใช้ dhamma-light เป็นค่าอ้างอิงเริ่มต้น การใช้งานจริงผูก `var(--accent)` และตัวแปร runtime ที่หมวดปัจจุบันกำหนด ไม่ล็อกเป็นธีมเดียว

| หมวด | บุคลิกสีและสถานที่ | ฉาก / ตราประจำหมวด |
| --- | --- | --- |
| buddha — พุทธประวัติและพุทธพจน์ | หินทราย งาช้าง ทองเก่า พุทธสถานอินเดีย พระพุทธรูปและต้นโพธิ์ | category-buddha-day/night.png · category-buddha.svg |
| monk — พระเกจิอาจารย์ | เขียวป่า ไม้สักเก่าและคัมภีร์ วัดป่าไทย | category-monk-day/night.png · category-monk.svg |
| dhamma — ธรรมะสำหรับพุทธศาสนิกชน | งาช้าง เขียวมะกอกและหินครีม ลานปฏิบัติธรรม ธรรมจักรหินและบัว | category-dhamma-day/night.png · category-dhamma.svg |

`mix` ใช้ชุด dhamma โดยไม่สุ่มธีม ค่าที่ไม่รู้จักใช้ fallback เดียวกัน การรับทั้ง ID และชื่อเดิมผ่าน categoryOf รักษา genre payload ที่ระบบใช้อยู่

### Secondary

`gold` ใช้ข้อความขั้นในแบนเนอร์และรายละเอียดหมวด `wood` ใช้พื้นที่รองเข้ม สีแผนกทั้งห้ารับ accent/pick ของหมวดเดียวกัน ไม่ใช้สีประจำสัตว์หรือเฉดแผนกเดิม ชื่อและภาพผู้ใหญ่แยกหน้าที่ของบริการ

### Neutral

`bg` รองพื้นที่รอบเนื้อหา `panel` เป็นพื้นข้อมูลทึบ `ink` / `muted` แสดงลำดับข้อความ `line` และ `pick` แสดงขอบและตัวเลือก ธีมมืดเปลี่ยนชุดสีตาม prefers-color-scheme; `ok`, `warn`, `danger` คงหน้าที่สำเร็จ/เตือน/ผิดพลาด ชุดหมวดมี --category-* aliases เพื่อให้หน้าโพสต์รับสีเดียวกับแอป

**The Category Owns the World Rule.** S.genre เป็นแหล่งค่าหมวดเดิม ใช้ได้ทั้ง ID และชื่อ เปลี่ยนหมวดแล้วเปลี่ยนธีมทั้งแอปทันทีและจำค่าข้ามการเปิดใหม่; การเลือกแผนกต้องไม่ทับหมวด

**The Readable Surface Rule.** ข้อมูล แบบฟอร์ม และปุ่มอยู่บนพื้น --panel ทึบ แบนเนอร์มีพื้นไล่สีเข้มรองข้อความเหนือภาพสถานที่ รักษา contrast อย่างน้อย 4.5:1 สำหรับข้อความและสีสถานะ/ปุ่มที่ใช้เป็นข้อความ

## Typography

**Display / Body Font:** "Noto Sans Thai", "Leelawadee UI", system-ui, sans-serif จากเครื่องผู้ใช้ ไม่โหลดฟอนต์เครือข่าย

**Label / Mono Font:** ป้ายใช้ชุดไทยเดียวกับเนื้อหา; log จริงใช้ Consolas, "Courier New", monospace ส่วน transcript/code ใช้ ui-monospace, Consolas, monospace

### Hierarchy

- **Brand:** ชื่อแอป (22px, 650, line-height 1.4) คู่ตราประจำหมวด 44px
- **Headline:** หัวส่วนงาน (18px, 750, line-height 1.55)
- **Hero title:** งานหรือสถานะหลัก (20px, 650, line-height 1.55) จำกัดสามบรรทัด; 18px ที่ไม่เกิน 380px และ 25px ตั้งแต่ 600px
- **Body:** ข้อความหลัก (15px, line-height 1.55)
- **Label:** ตัวเลือกและช่องกรอก (13–14px); ข้อความรองในแบนเนอร์ 13px, line-height 1.65
- **Hint / Meta:** คำแนะนำ 12px, line-height 1.7; สถานะย่อย 11px ตัวเลขค่าใช้จ่ายใช้ tabular-nums

**The Real State Rule.** ชื่อบริการ งาน สถานะ และเวลามาจากระบบจริง ไม่ใช้ภาพหรือตัวอย่างเพื่ออ้างว่าระบบพร้อม

## Layout

เป้าหมายแผงข้าง 360–450px และหน้าต่างที่กว้างกว่า `main` อยู่กลาง กว้างสูงสุด 760px เว้นขอบ 14px ด้านบน 16px และท้าย 108px กล่องส่วนงานห่าง 16px ขั้นทำเองห่าง 22px ใช้ระยะย่อย 8/10/12/14/16px ตามองค์ประกอบ

ตัวเลือกหมวดอยู่ใต้ตราแอปก่อนแบนเนอร์ เห็นได้ในทุกโหมดหัวข้อ ระยะใน 13px 14px ช่องห่าง 7px และ select สูงขั้นต่ำ 44px เมื่อเปลี่ยนเรียก applyCategoryTheme ทันทีพร้อมบันทึก S.genre เมื่อโหลดกลับเรียกธีมจากค่าที่บันทึกไว้

ภาพหมวด 1024×1536px อยู่บน `body::before` แบบ fixed/cover ไม่รับ pointer ไม่เพิ่มความสูงเอกสาร แบนเนอร์ใช้ภาพเดียวกับหมวดปัจจุบันและพื้นไล่สี wood เข้ม แถวลูกทีมอยู่ใต้แบนเนอร์ ปุ่ม 52×52px ห่าง 8px แถบทีมติดด้านบนเมื่อเลื่อนมีปุ่ม 40×42px และผู้ช่วยลอยขนาด 102px

ที่ไม่เกิน 380px ขอบ main ลดเป็น 11px ตัวละครหลัก 142px แทน 160px แถบทีมใช้ปุ่ม 36×40px ตั้งแต่ 600px แบนเนอร์สูงคงที่ 300px ตัวละครหลัก 210px เครื่องมือโปรเจกต์เปลี่ยนจากสองเป็นสามคอลัมน์ ค่าเริ่มต้นแบนเนอร์สูงคงที่ 260px เครื่องมือโปรเจกต์สองคอลัมน์โดยปุ่มสุดท้ายเต็มแถว

## Elevation & Depth

ข้อมูลหลักใช้พื้นทึบและเส้นขอบโดยไม่มีเงา เงาเฉพาะแบนเนอร์ แถบทีม tooltip หน้าต่าง และ alpha ของภาพผู้ใหญ่ วัสดุในภาพต้องมีน้ำหนักและสัดส่วนจริง ไม่เป็นฉากของเล่นหรือโมเดลจิ๋ว

### Shadow Vocabulary

- **Hero:** `0 8px 24px rgba(48, 25, 10, .16)`
- **Sticky team:** `0 3px 14px rgba(44, 22, 8, .12)`
- **Tooltip:** `0 6px 18px rgba(35, 18, 6, .2)`
- **Modal:** `0 18px 48px rgba(26, 12, 3, .25)` พร้อมฉากบัง `rgba(26, 17, 10, .65)`
- **Hero portrait:** `drop-shadow(0 6px 10px rgba(32, 15, 3, .25))` ตาม alpha ตัวละคร

## Shapes

ทิศทางล่าสุดลดความป่องมน: ส่วนงาน แบนเนอร์ และ modal มุม 12px ตราและตัวเลือกหมวด 10px ปุ่มทั่วไปกับแถบตัวเลือก 7px ปุ่มลูกทีม 8px ช่องกรอกยังเป็น 9px เลขขั้น 6px ป้ายสถานะ pill 99px ขอบข้อมูล 1px และ focus/การเลือกใช้ outline 2px

## Components

### Category Picker

หมวดเนื้อหาเป็นตัวเลือกเดิมที่ย้ายมาอยู่ใต้ตราแอป เห็นได้ทุกโหมดและเปลี่ยนโลกทันที ไม่เพิ่มเมนูธีมแยกซึ่งอาจขัดกับหมวดที่ใช้ ช่อง select รองรับค่า ID/ชื่อเดิมผ่าน categoryGenre และการบันทึก S.genre ชุด `mix` ใช้ dhamma

### Buttons / Inputs

ปุ่มหลัก accent/accent-ink สูงขั้นต่ำ 44px ระยะใน 10px 15px น้ำหนัก 750 มุม 7px Hover ใช้ `color-mix(in srgb, var(--accent) 88%, var(--ink))`; active ลง 1px เปลี่ยนใน .18s ease ปุ่มรองพื้น panel ขอบ line สูงขั้นต่ำ 40px Hover ใช้ pick และขอบ accent ปุ่มหยุด/อันตรายใช้ danger Disabled จาง .55 พร้อม cursor not-allowed Focus-visible เป็น accent 2px ห่าง 3px

ช่องกรอกกับ select พื้น panel ขอบ line มุม 9px ระยะใน 8px 10px สูงขั้นต่ำ 42px (select หมวด 44px) ข้อความ ink; placeholder muted เต็มความทึบ caret accent และ focus เหมือนปุ่ม

### Navigation / Chips

แถบตัวเลือกห่อบรรทัดได้ สูงปุ่มขั้นต่ำ 38px `aria-pressed=true` ใช้ accent/accent-ink ปุ่มลูกทีมมีชื่อบริการใน accessible label และ tooltip หน้าที่/สถานะ `aria-current=true` เพิ่มขอบ/outline กับ pick ป้ายความสำเร็จ 11px ขอบและข้อความ ok ระยะใน 1px 7px

### Cards / Overlays / Live Log

โปรเจกต์ คลังวิดีโอ ตรวจความพร้อม ตั้งค่าแผนก modal และโพสต์รับ panel/ink/line/accent ของหมวดเดียวกัน กล่องแผนกมีหัวพื้น pick สีเน้นเหมือนหมวด ไม่เปลี่ยนเป็นโลกแผนก กล่องควบคุมคงสถานะ เปอร์เซ็นต์ ค่าใช้จ่าย รายแผนก log และปุ่มงานเดิม

log จริงคง terminal พื้น #030906 ตัวอักษร #72ffa0 และ severity เดิม กรอบหัว/ท้ายใช้ไม้เข้มจาก temple.css คงปุ่มเต็มจอ (Esc ย่อ) และตามล่าสุด; เลื่อนขึ้นอ่านหยุดตาม ไม่เปลี่ยนข้อมูลค่าใช้จ่ายหรือสถานะเพื่อการตกแต่ง

### Adult Team / Motion

**The Adult Proportions Rule.** ใช้ผู้ใหญ่สัดส่วนจริง วัยประมาณ 35–55 ปี ศีรษะและดวงตาธรรมชาติ ไม่มีเด็ก เณรน้อย หัวโต ตาโต ตุ๊กตา หรือ chibi

| Service ID | ตัวละคร | Atlas / ขนาด native |
| --- | --- | --- |
| chatgpt | พระภิกษุนักเรียบเรียง | adult-chatgpt.png · 1447×1087px |
| flow | ช่างศิลป์ | adult-flow.png · 1448×1086px |
| meta | ผู้ช่วยจัดฉาก | adult-meta.png · 1447×1087px |
| voice | นักพากย์ | adult-voice.png · 1448×1086px |
| edit | ผู้ช่วยตัดต่อ | adult-edit.png · 1447×1087px |

ใช้ทีมเดียวกันทั้งสามหมวด ทุก atlas เป็น native RGBA โปร่งใส 4×3 รวม 12 ท่าจริงต่อคน เรียงซ้ายไปขวาบนลงล่าง Renderer ใช้ขนาดภาพจริงหาร 4/3 เพื่อหา aspect ratio และตำแหน่ง normalized x = 0/33.333/66.667/100%, y = 0/50/100%; background-size 400% 300% ไม่ hardcode ช่อง 362px เพราะบางภาพมีขนาดต่างหนึ่งพิกเซล

**The Fixed Actor Rule.** ตัวละครอยู่บน stage ตำแหน่งคงที่ ไม่ใช้ความสูงข้อความสถานะเป็นตัวกำหนดตำแหน่ง ความสูงแบนเนอร์ 260px (300px เมื่อกว้างตั้งแต่ 600px) ยึดภาพที่ขอบล่าง 18px ข้อความยาว การแสดงขั้น หรือ progress ไม่ดันตัวละคร

**The Registered Pose Rule.** `.sea-frame` เป็น viewport คงที่และ `.sprite-pose` เป็นชั้นภาพข้างใน ใช้ค่าชดเชย translate/scale รายคนรายเฟรมจาก `sprite-registration.js` เพื่อล็อกฐานโต๊ะ เก้าอี้ และตัวละคร โดยไม่แก้พิกเซลภาพต้นฉบับ ค่าคาลิเบรตพร้อม SHA256 อยู่ใน `sprite-registration.json`; เมื่อเปลี่ยน PNG ต้องคำนวณใหม่ด้วย `.impeccable/review/analyze-sprite-lock.mjs` และตรวจ `scripts/test-sprite-registration.mjs`

**The Working Frames Rule.** แต่ละคนมี 12 เฟรมจริงใน atlas 4×3 เล่นรอบ 1.8 วินาทีเฉพาะ working; idle/waiting/offline ใช้ภาพนิ่ง และหยุดภาพเมื่อซ่อน พ้นจอ หรือผู้ใช้ลดการเคลื่อนไหว

Hero ใช้ IntersectionObserver ระบุ data-offscreen; visibilitychange ระบุ data-hidden ให้ hero ผู้ช่วยลอย และแถบทีม Reduced-motion ปิดการเล่นภาพและ transition คงสถานะ/เวลา ฉากใหญ่ไม่เคลื่อนไหว ไม่เพิ่ม requestAnimationFrame

### Assets / Provenance

ฉากหมวดหกใบใน `extension/agents/category-{buddha,monk,dhamma}-{day,night}.png` และ atlas ผู้ใหญ่ห้าชุดใน `extension/agents/adult-{chatgpt,flow,meta,voice,edit}.png` เป็นสินทรัพย์ที่ใช้งานปัจจุบัน ทุก PNG มี prompt ฝัง บันทึกขนาด ที่มา และ prompt ใน `docs/design/category-background-manifest.json` และ `docs/design/adult-atlas-manifest.json` ไม่ใช้เงื่อนไขภาพเจ็ดใบหรือ atlas เณรของแบบเก่า

ตราในแอปและ favicon ใช้ SVG สามไฟล์ `extension/icons/category-{buddha,monk,dhamma}.svg` เปลี่ยนพร้อมหมวด ไอคอนหลักวัด–ธรรมจักร SVG/PNG/ICO เดิมไม่มีภาพเด็กและคงใช้ได้ สร้างจาก `scripts/build-dhamma-icons.ps1` (ผ่าน `scripts/build-icons.ps1` ได้) `extension/icons/dhamma-auto.ico` รวม 16/24/32/48/64/128/256px

## Do's and Don'ts

### Do:
- Do ใช้ category-themes.js เป็นแหล่งค่าสีหมวด และคง category-themes.css ไว้หลัง temple.css
- Do ให้ตัวเลือกหมวดมองเห็นและใช้ได้ทั้งพิมพ์เอง เสนอหัวข้อ และเลือกอัตโนมัติ
- Do เก็บภาพ สคริปต์ สไตล์ และฟอนต์ระบบไว้ในเครื่อง พร้อม prompt ฝังและ manifest ของสินทรัพย์
- Do แสดงชื่อบริการและสถานะเป็นข้อความพร้อมขอบหรือ outline เพื่อไม่พึ่งสีอย่างเดียว
- Do คง polling 3 วินาทีและหยุดถามเมื่อ document.hidden โดยไม่เพิ่มวง JavaScript เพื่อขยับภาพ

### Don't:
- Don't ใช้ภาพเด็ก เณรน้อย ตุ๊กตา chibi หัวโต ตาโต หรือความน่ารักแบบการ์ตูนเด็กในส่วนใดของแอป
- Don't ให้การเปลี่ยนแผนกเปลี่ยนฉาก สีพื้น หรือหมวดที่ผู้ใช้เลือกไว้
- Don't ใช้ฉากวัดไทยเดียวแทนทั้งสามหมวด หรือแค่ย้อมสีฉากเดิมเพื่ออ้างว่าเป็นคนละสถานที่
- Don't hardcode ว่าทุก atlas มีช่อง 362×362px หรือสร้างจำนวนเฟรมด้วยการทำสำเนาภาพเดิม
- Don't เปลี่ยน bridge, pipeline, prompt เนื้อหา บัญชี ราคา หรือเปิดเครดิต API เพื่อการตกแต่ง
