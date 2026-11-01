import { categoryOf } from './prompts.js'

const semantic = {
  light: { ok:'#315e3f', warn:'#80531b', danger:'#a72d27', 'accent-ink':'#fff9ed' },
  dark: { ok:'#acd2a0', warn:'#edc47c', danger:'#ffb0a1', 'accent-ink':'#301d0e' },
}
const palette = (mode, values) => ({...semantic[mode], ...values})

export const CATEGORY_THEMES = {
  buddha: {
    title:'พุทธประวัติและพุทธพจน์', day:'agents/category-buddha-day.png', night:'agents/category-buddha-night.png', icon:'icons/category-buddha.svg',
    light:palette('light',{bg:'#f3df9e',panel:'#fff2c9',ink:'#382a0b',muted:'#68531e',accent:'#74500b',line:'#9c751e',pick:'#edd38a',wood:'#3b2c0e',gold:'#e5ba45',warn:'#785015',action:'#d8aa3c','action-ink':'#342303'}),
    dark:palette('dark',{bg:'#241c08',panel:'#35290d',ink:'#fff1c4',muted:'#d1be82',accent:'#f0cf70',line:'#b3923b',pick:'#4b3b0e',wood:'#231906',gold:'#efc857',action:'#e4b747','action-ink':'#2f2206'}),
  },
  monk: {
    title:'พระเกจิอาจารย์', day:'agents/category-monk-day.png', night:'agents/category-monk-night.png', icon:'icons/category-monk.svg',
    light:palette('light',{bg:'#eef0e7',panel:'#fafaf3',ink:'#27342a',muted:'#52654f',accent:'#375b40',line:'#85977a',pick:'#e0e8d6',wood:'#233025',gold:'#b9a46b'}),
    dark:palette('dark',{bg:'#141e17',panel:'#212d22',ink:'#eff3dd',muted:'#bcc8ad',accent:'#b7cf94',line:'#7e9773',pick:'#31442e',wood:'#152016',gold:'#b9c59b'}),
  },
  dhamma: {
    title:'ธรรมะสำหรับพุทธศาสนิกชน', day:'agents/category-dhamma-day.png', night:'agents/category-dhamma-night.png', icon:'icons/category-dhamma.svg',
    light:palette('light',{bg:'#f1ede5',panel:'#fffaf2',ink:'#34332a',muted:'#655f4e',accent:'#645c31',line:'#9b927b',pick:'#e8e4d3',wood:'#343326',gold:'#d3c28b'}),
    dark:palette('dark',{bg:'#1e1d17',panel:'#2b2a21',ink:'#f5efda',muted:'#c7c0a7',accent:'#d3c28b',line:'#9a8e70',pick:'#403c2b',wood:'#242319',gold:'#d3c28b'}),
  },
}
// โหมดพระสอนธรรม (ตัวเราเอง) — ใช้ฉากและสีโทนพระแบบหมวดพระเกจิ
CATEGORY_THEMES.self = { ...CATEGORY_THEMES.monk, title:'พระสอนธรรม (ตัวเราเอง)' }

export const themeKey = value => categoryOf(value)?.id ?? 'mix'
export const categoryGenre = value => categoryOf(value)?.name ?? 'mix'
export const themeForGenre = value => CATEGORY_THEMES[themeKey(value)] ?? CATEGORY_THEMES.dhamma

export function categoryThemeCss() {
  const rule = (id,theme,mode) => {
    const p=theme[mode]
    const selector=id==='dhamma' ? "html[data-category='dhamma'], html[data-category='mix']" : `html[data-category='${id}']`
    const colors=Object.entries(p).flatMap(([name,color])=>[`--${name}:${color}`,`--category-${name}:${color}`])
    const departments=['chatgpt','flow','meta','voice','edit'].flatMap(id=>[`--dept-${id}:${p.accent}`,`--dept-${id}-pick:${p.pick}`])
    return `${selector}{${colors.concat(departments,[`--world-image:url('${mode==='dark'?theme.night:theme.day}')`,`--temple-wood:${p.wood}`,`--temple-gold:${p.gold}`,`--hero-edge:${p.gold}`,`--temple-surface:${p.pick}`,`--sea-top:${p.pick}`,`--sand-deep:${p.gold}`]).join(';')}}`
  }
  return Object.entries(CATEGORY_THEMES).map(([id,t])=>rule(id,t,'light')).join('\n') + '\n@media(prefers-color-scheme: dark){\n' + Object.entries(CATEGORY_THEMES).map(([id,t])=>rule(id,t,'dark')).join('\n')+'\n}'
}

export function applyCategoryTheme(genre, doc=document) {
  const key=themeKey(genre),theme=themeForGenre(genre)
  let style=doc.getElementById('category-theme-tokens')
  if(!style) {
    style=doc.createElement('style')
    style.id='category-theme-tokens'
    style.textContent=categoryThemeCss()
    doc.head.append(style)
  }
  doc.documentElement.dataset.category=key
  doc.querySelectorAll('.brand-icon, .stickyLogo img').forEach(image=>{ if(image.getAttribute('src')!==theme.icon) image.setAttribute('src',theme.icon) })
  const favicon=doc.querySelector('link[rel="icon"]')
  if(favicon) favicon.setAttribute('href',theme.icon)
  return key
}
