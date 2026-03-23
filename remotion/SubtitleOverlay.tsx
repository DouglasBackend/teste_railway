// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// SubtitleOverlay.tsx — REDESIGN COMPLETO
// Substitui remotion/SubtitleOverlay.tsx
// Presets redesenhados: highlight (Hormozi), tiktok, karaoke, instagram, capcut
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export const SubtitleOverlay: React.FC<{
  words: { text: string; start: number; end: number }[];
  style: any;
}> = ({ words, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const validWords = words.filter(w => w.text.trim().length > 0);
  const activeWordIdx = validWords.findIndex(w => currentTime >= w.start && currentTime <= w.end);
  if (activeWordIdx === -1) return null;

  const preset      = (style?.preset || 'tiktok').toLowerCase();
  const maxWords    = style?.max_words !== undefined ? Number(style.max_words) : 1;
  const fontFamily  = style?.fontFamily || style?.font_family || 'Montserrat, sans-serif';
  const fontColor   = style?.font_color || '#FFFFFF';
  const highlightColor = style?.highlight_color || '#f7c204';
  const outlineColor   = style?.outline_color || '#000000';
  const outlineWidth   = style?.outline_width !== undefined ? Number(style.outline_width) : 4;
  const bgColor        = style?.background_color || 'transparent';
  const shadowDepth    = style?.shadow_depth !== undefined ? Number(style.shadow_depth) : 0;
  const fontSizePx     = style?.font_size !== undefined ? Number(style.font_size) : 90;
  const posY           = style?.posY !== undefined ? Number(style.posY) : 82;

  const groupSize      = maxWords;
  const currentGroupIdx = Math.floor(activeWordIdx / groupSize);
  const wordsToShow    = validWords.filter((_, i) => Math.floor(i / groupSize) === currentGroupIdx);

  // ── Layout wrapper por preset ──────────────────────────────────────────────
  // instagram usa layout diferente (slide de baixo, texto centrado sem flex-wrap)
  const isInstagram = preset === 'instagram';
  const isTicker    = preset === 'newsticker';

  return (
    <div style={{
      position: 'absolute',
      top: `${posY}%`,
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'auto',
      maxWidth: '88%',
      display: 'flex',
      flexWrap: isInstagram ? 'nowrap' : 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      gap: preset === 'capcut' ? '10px 14px'
        : preset === 'karaoke' ? '0px'
        : '12px 20px',
      zIndex: 9999,
    }}>
      {wordsToShow.map((w, i) => {
        const isActive = currentTime >= w.start && currentTime <= w.end;
        const isPast   = currentTime > w.end;
        const elapsed  = isActive ? frame - (w.start * fps) : 0;
        return (
          <WordRenderer
            key={`${w.text}-${i}`}
            text={w.text}
            isActive={isActive}
            isPast={isPast}
            elapsed={elapsed}
            frame={frame}
            fps={fps}
            preset={preset}
            fontFamily={fontFamily}
            fontColor={fontColor}
            highlightColor={highlightColor}
            outlineColor={outlineColor}
            outlineWidth={outlineWidth}
            bgColor={bgColor}
            shadowDepth={shadowDepth}
            fontSizePx={fontSizePx}
            words={words} // Passando as palavras originais para cálculo de duração
          />
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const WordRenderer: React.FC<{
  text: string; isActive: boolean; isPast: boolean; elapsed: number; frame: number; fps: number;
  preset: string; fontFamily: string; fontColor: string; highlightColor: string;
  outlineColor: string; outlineWidth: number; bgColor: string;
  shadowDepth: number; fontSizePx: number; words: any[];
}> = ({
  text, isActive, isPast, elapsed, frame, fps, preset,
  fontFamily, fontColor, highlightColor,
  outlineColor, outlineWidth, bgColor, shadowDepth, fontSizePx, words,
}) => {

  const anim = preset.toLowerCase();

  // ── Base style ─────────────────────────────────────────────────────────────
  let style: React.CSSProperties = {
    fontFamily,
    fontSize: `${fontSizePx}px`,
    fontWeight: 900,
    textAlign: 'center',
    textTransform: 'uppercase',
    display: 'inline-block',
    lineHeight: 1.05,
    position: 'relative',
    letterSpacing: '-0.01em',
  };

  // ── Switch ─────────────────────────────────────────────────────────────────
  switch (anim) {

    // ══════════════════════════════════════════════════════════════════════════
    // HIGHLIGHT — Estilo Hormozi: palavra ativa vira amarela (#f7c204)
    // Fonte: Montserrat 900, MAIÚSCULA, sombra preta embaixo
    // Palavra ativa: amarela, scale up spring + sombra amarela glow
    // Palavra inativa: branca, menor
    // ══════════════════════════════════════════════════════════════════════════
    case 'highlight': {
      const sp = spring({ frame: elapsed, fps, config: { damping: 10, stiffness: 380, mass: 0.7 } });
      const sc = isActive ? interpolate(sp, [0, 1], [0.75, 1.08]) : 0.92;
      const rot = isActive ? interpolate(sp, [0, 0.4, 1], [-3, 2, 0]) : 0;

      style.color = isActive ? highlightColor : fontColor;   // #f7c204 vs #FFFFFF
      style.transform = `scale(${sc}) rotate(${rot}deg)`;
      style.transformOrigin = 'bottom center';
      style.fontFamily = "'Montserrat', 'Arial Black', sans-serif";

      // Sombra preta dura — estilo Hormozi (não glow, shadow offset)
      style.textShadow = isActive
        ? `2px 3px 0px rgba(0,0,0,0.9), 0 0 ${8 + Math.sin(frame * 0.4) * 3}px rgba(247,194,4,0.4)`
        : '2px 3px 0px rgba(0,0,0,0.8)';

      // Sem WebkitTextStroke (Hormozi não usa outline, só shadow)
      style.WebkitTextStroke = '0px transparent';

      // Palavra ativa levemente maior
      style.fontSize = isActive ? `${fontSizePx * 1.12}px` : `${fontSizePx}px`;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TIKTOK — Estilo TikTok nativo / Karaokê branco
    // Fonte: Montserrat 900, branco, outline PRETO GROSSO (4-5px)
    // Palavra ativa: scale spring com bounce, outline preto nítido
    // Sem cor mudando — só escala e posição mudam
    // Igual ao preset "Classic" do TikTok e Proxima Nova do CapCut
    // ══════════════════════════════════════════════════════════════════════════
    case 'tiktok': {
      // TikTok: Amarelo (#FFFF00), Estático e LISO.
      const sc = 1.0; const yOff = 0;
      const o = outlineWidth > 0 ? outlineWidth : 4;

      style.color = '#FFFF00';
      style.fontFamily = "'Montserrat', 'Arial Black', sans-serif";
      style.fontWeight = '900';
      style.textTransform = 'uppercase';
      
      style.transform = `scale(${sc}) translateY(${yOff}px)`;
      style.transformOrigin = 'bottom center';
      style.WebkitTextStroke = '0px transparent';
      // Outline liso via text-shadow (8 direções para cobertura total)
      style.textShadow = `
        ${o}px ${o}px 0 #000, ${-o}px ${-o}px 0 #000, 
        ${o}px ${-o}px 0 #000, ${-o}px ${o}px 0 #000,
        ${o}px 0 0 #000, ${-o}px 0 0 #000, 
        0 ${o}px 0 #000, 0 ${-o}px 0 #000
      `.replace(/\s+/g, ' ');
      style.opacity = 1;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // KARAOKE — Karaokê real (CapCut / TikTok karaoke mode)
    // Todas as palavras visíveis, inativas em branco 50% opacidade
    // Palavra ativa: branca 100%, scale leve
    // Background pill semitransparente escuro atrás de tudo
    // ══════════════════════════════════════════════════════════════════════════
    case 'karaoke': {
      const currentWordInWords = words.find(w => Math.abs(w.start - (frame/fps)) < 0.5 && text.includes(w.text));
      const duration = (currentWordInWords?.end - currentWordInWords?.start) || 0.35;
      const progress = isActive ? Math.min(1, elapsed / (duration * fps)) : 0;
      
      style.fontFamily = "'Montserrat', 'Arial Black', sans-serif";
      style.fontWeight = '900';
      style.fontSize = `${fontSizePx}px`;
      style.WebkitTextStroke = '0px transparent';
      style.padding = '4px 10px';
      
      style.color = 'transparent';
      // Se a palavra já passou, fica 100% verde. Se é a atual, segue o progress. Se é futura, 0%.
      const fillPercent = isPast ? 100 : (isActive ? progress * 100 : 0);
      
      style.backgroundImage = `linear-gradient(to right, #00FF00 ${fillPercent}%, rgba(255,255,255,0.3) ${fillPercent}%)`;
      style.WebkitBackgroundClip = 'text';
      style.display = 'inline-block';
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INSTAGRAM — Gradiente oficial: #f58529 → #dd2a7b → #8134af → #515bd4
    // Slide de baixo para cima com spring
    // Fonte: Helvetica Neue / Montserrat, weight 800, letterSpacing -1px
    // Drop shadow sutil (não outline)
    // ══════════════════════════════════════════════════════════════════════════
    case 'instagram': {
      const sp = spring({ frame: elapsed, fps, config: { damping: 14, stiffness: 280 } });
      const yOff = isActive
        ? interpolate(sp, [0, 1], [40, 0])
        : 0;
      const opac = isActive
        ? interpolate(sp, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' })
        : 0.65;

      // Gradiente oficial Instagram
      style.backgroundImage = 'linear-gradient(90deg, #f58529, #dd2a7b, #8134af, #515bd4)';
      style.WebkitBackgroundClip = 'text';
      style.WebkitTextFillColor = 'transparent';
      style.color = 'transparent';
      style.WebkitTextStroke = '0px transparent';

      style.transform = `translateY(${yOff}px)`;
      style.opacity = opac;
      style.fontFamily = "'Montserrat', 'Helvetica Neue', Helvetica, sans-serif";
      style.fontWeight = 800;
      style.letterSpacing = '-0.02em';
      style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))';

      // Quando inativa: gradiente apagado (cinza)
      if (!isActive) {
        style.backgroundImage = 'linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.4))';
      }
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CAPCUT — CapCut AI Captions (pill colorido por palavra)
    // Cada palavra tem fundo pill arredondado, cor rotativa vibrante
    // Sem outline. Texto preto sobre fundo colorido.
    // Palavra ativa: escala spring com bounce, cor brilhante
    // Palavra inativa: pill cinza escuro
    // ══════════════════════════════════════════════════════════════════════════
    case 'capcut': {
      // Cores fixas por palavra (hash do texto) — não mudam com o tempo
      const CAPCUT_COLORS = ['#FFE500', '#FFFFFF', '#00CFFF', '#FF4DCF', '#44FF88'];
      const hash = text.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
      const pillColor = isActive ? CAPCUT_COLORS[hash % CAPCUT_COLORS.length] : 'rgba(35,35,35,0.88)';
      const isLightPill = pillColor === '#FFE500' || pillColor === '#FFFFFF' || pillColor === '#44FF88';
      const textCol = isActive ? (isLightPill ? '#000000' : '#FFFFFF') : 'rgba(255,255,255,0.5)';

      const sp = spring({ frame: elapsed, fps, config: { damping: 8, stiffness: 500, mass: 0.5 } });
      const sc = isActive ? interpolate(sp, [0, 0.5, 0.8, 1], [0.5, 1.2, 0.95, 1.0]) : 1.0;
      const rot = isActive ? interpolate(sp, [0, 0.3, 1], [0, -3, 0]) : 0;
      // Leve stretch inicial (CapCut characteristic)
      const scX = isActive ? 1 + Math.max(0, 1 - (elapsed / fps) * 4) * 0.06 : 1;

      style.color = textCol;
      style.backgroundColor = pillColor;
      style.padding = `${fontSizePx * 0.1}px ${fontSizePx * 0.22}px`;
      style.borderRadius = `${fontSizePx * 0.25}px`;
      style.transform = `scale(${sc}) scaleX(${scX}) rotate(${rot}deg)`;
      style.WebkitTextStroke = '0px transparent';
      style.textShadow = 'none';
      style.fontFamily = "'Montserrat', 'Arial Black', sans-serif";
      style.fontWeight = '900';
      if (isActive) style.boxShadow = `0 4px 14px rgba(0,0,0,0.3), 0 0 16px ${pillColor}55`;
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Todos os outros presets — mantém lógica anterior
    // ══════════════════════════════════════════════════════════════════════════

    case 'impact': {
      const sp = spring({ frame: elapsed, fps, config: { damping: 5, stiffness: 600 } });
      style.color = isActive ? highlightColor : fontColor;
      style.transform = `scale(${isActive ? interpolate(sp,[0,1],[1.5,1.2]) : 1}) rotate(${isActive ? Math.sin(frame*0.3)*3 : 0}deg)`;
      style.WebkitTextStroke = `${outlineWidth}px ${outlineColor}`;
      style.textShadow = isActive ? `0 0 ${10+Math.sin(frame*0.4)*4}px ${fontColor}` : 'none';
      break;
    }
    case 'gradient':
    case 'gradientorig': {
      const sp = spring({ frame: elapsed, fps, config: { damping: 10, stiffness: 350 } });
      const hue = (frame*2)%360;
      style.backgroundImage = `linear-gradient(135deg,hsl(${hue},100%,60%),hsl(${(hue+120)%360},100%,60%),hsl(${(hue+240)%360},100%,60%))`;
      style.WebkitBackgroundClip = 'text'; style.WebkitTextFillColor = 'transparent';
      style.color = 'transparent'; style.WebkitTextStroke = '0px transparent';
      style.transform = `scale(${isActive ? interpolate(sp,[0,1],[0.8,1.0]) : 0.9})`;
      break;
    }
    case 'cinematic': {
      const sp = spring({ frame: elapsed, fps, config: { damping: 20, stiffness: 200 } });
      style.color = fontColor;
      style.opacity = isActive ? interpolate(sp,[0,1],[0,1]) : 0.7;
      style.backgroundColor = bgColor !== 'transparent' ? bgColor : `rgba(0,0,0,${0.7+Math.sin(frame*0.2)*0.05})`;
      style.padding = '12px 28px'; style.borderRadius = '0px'; style.letterSpacing = '0.12em';
      style.WebkitTextStroke = '0px transparent';
      if (isActive) style.textShadow = `0 0 ${8+Math.sin(frame*0.4)*3}px ${highlightColor}`;
      break;
    }
    case 'neon': {
      const oX = isActive?Math.sin(frame*0.5)*3:0, oY = isActive?Math.cos(frame*0.4)*2:0;
      style.color = fontColor; style.WebkitTextStroke = `${outlineWidth}px ${outlineColor}`;
      style.transform = `translate(${oX}px,${oY}px) skewX(${isActive?oX*2:0}deg)`;
      style.textShadow = isActive ? `-2px 0 0 #ff00ff,2px 0 0 #00ffff,0 0 ${18+Math.sin(frame*0.6)*6}px ${highlightColor}` : `0 0 8px ${highlightColor}`;
      break;
    }
    case 'matrix': {
      const a = isActive?0.5+Math.sin(frame*0.5)*0.5:0.4;
      style.color = isActive?`rgba(0,255,0,${a})`:'rgba(0,255,0,0.5)';
      style.fontFamily = "'Press Start 2P',monospace"; style.WebkitTextStroke = '0px transparent';
      style.textShadow = isActive?`0 0 ${10+Math.sin(frame*0.4)*4}px #00FF00,0 0 20px #00AA00`:'0 0 6px #00FF00';
      style.backgroundColor = `rgba(0,255,0,${isActive?0.15:0.05})`;
      style.padding = '8px 20px'; style.borderRadius = '4px';
      style.transform = `scale(${isActive?1+Math.sin(frame*0.4)*0.02:1})`;
      break;
    }
    case 'pop3d': {
      const sp = spring({frame:elapsed,fps,config:{damping:7,stiffness:500}});
      style.color = isActive?highlightColor:fontColor; style.WebkitTextStroke = `${outlineWidth}px ${outlineColor}`;
      style.textShadow = isActive?Array.from({length:5},(_,i)=>`${i+1}px ${i+1}px 0px ${outlineColor}`).join(','):`2px 2px 0px ${outlineColor}`;
      style.transform = `scale(${isActive?interpolate(sp,[0,1],[0.5,1.15]):1})`;
      break;
    }
    case 'liquid': {
      const w=isActive?Math.sin(frame*0.3)*4:0,w2=isActive?Math.cos(frame*0.25)*3:0,hue=(frame*1.5)%360;
      style.backgroundImage = isActive?`linear-gradient(${90+w*5}deg,#ccc,#fff,hsl(${hue},60%,80%),#999)`:'linear-gradient(90deg,#ccc,#fff,#999)';
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent';
      style.WebkitTextStroke=`${outlineWidth}px rgba(180,180,255,0.5)`;
      style.transform=`translate(${w2}px,${w*0.5}px)`;
      style.filter=isActive?'drop-shadow(0 0 6px rgba(180,180,255,0.6))':'none';
      break;
    }
    case 'explosive': {
      const sp=spring({frame:elapsed,fps,config:{damping:4,stiffness:700}});
      const hue=(frame*3)%360;
      style.color=isActive?`hsl(${hue},100%,60%)`:fontColor;
      style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`scale(${isActive?interpolate(sp,[0,0.5,1],[0.5,1.4,1.15]):1}) rotate(${isActive?Math.sin(frame*0.4)*4:0}deg)`;
      style.textShadow=isActive?`0 0 ${20+Math.sin(frame*0.5)*8}px hsl(${hue},100%,70%)`:'none';
      break;
    }
    case 'neonglow': {
      const sp=spring({frame:elapsed,fps,config:{damping:10,stiffness:400}}),hue=(frame*2)%360,g=isActive?20+Math.sin(frame*0.5)*8:10;
      style.color=isActive?`hsl(${hue},100%,70%)`:fontColor; style.WebkitTextStroke='0px transparent';
      style.textShadow=isActive?`0 0 ${g}px hsl(${hue},100%,70%),0 0 ${g*1.8}px hsl(${hue},100%,50%),0 0 ${g*2.5}px hsl(${hue},100%,30%)`:`0 0 10px ${highlightColor}`;
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      break;
    }
    case 'glitch': {
      const gX=isActive?Math.sin(frame*0.9)*4:0,gY=isActive?Math.cos(frame*0.7)*2:0,sk=isActive?Math.sin(frame*1.2)*5:0;
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`translate(${gX}px,${gY}px) skewX(${sk}deg)`;
      style.textShadow=isActive?`${-gX*0.8}px 0 0 #ff00ff,${gX*0.8}px 0 0 #00ffff,0 0 15px ${highlightColor}`:`0 0 8px ${highlightColor}`;
      break;
    }
    case 'fire': {
      const fl=isActive?Math.sin(frame*1.2)*3:0,fl2=isActive?Math.cos(frame*0.9)*2:0,hue=isActive?30+Math.sin(frame*0.4)*15:30;
      style.backgroundImage=isActive?`linear-gradient(0deg,hsl(${hue-10},100%,40%),hsl(${hue+10},100%,60%),#ffeeaa)`:'linear-gradient(0deg,#ff6600,#ffaa00)';
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent';
      style.WebkitTextStroke=`${outlineWidth}px rgba(255,80,0,0.5)`;
      style.transform=`translateY(${fl}px) skewX(${fl2}deg)`;
      style.textShadow=isActive?`0 0 ${20+fl*2}px #ff6600,0 0 ${35+fl}px #ff4400,0 0 50px rgba(255,0,0,0.5)`:'0 0 12px #ff6600';
      break;
    }
    case 'water': {
      const wv=isActive?Math.sin(frame*0.25)*6:0,wv2=isActive?Math.cos(frame*0.2)*3:0,hue=isActive?190+Math.sin(frame*0.15)*20:190;
      style.backgroundImage=isActive?`linear-gradient(${180+wv*3}deg,#00ffff,hsl(${hue},100%,60%),#0055ff)`:'linear-gradient(180deg,#00ffff,#00aaff)';
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent';
      style.WebkitTextStroke=`${outlineWidth}px rgba(0,150,255,0.4)`;
      style.transform=`translateY(${wv}px) translateX(${wv2}px)`;
      style.textShadow=isActive?`0 0 ${15+Math.sin(frame*0.3)*5}px rgba(0,170,255,0.8),0 ${wv}px 10px rgba(0,100,200,0.5)`:'0 0 10px #00aaff';
      break;
    }
    case 'rainbow': {
      const hue=(frame*4)%360;
      style.backgroundImage=`linear-gradient(135deg,hsl(${hue},100%,60%),hsl(${(hue+60)%360},100%,60%),hsl(${(hue+120)%360},100%,60%),hsl(${(hue+180)%360},100%,60%))`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.transform=`scale(${isActive?1.05+Math.sin(frame*0.4)*0.05:1})`;
      style.textShadow=`0 0 ${12+Math.sin(frame*0.5)*4}px hsl(${hue},100%,70%)`;
      break;
    }
    case 'shadow': {
      const sp=spring({frame:elapsed,fps,config:{damping:8,stiffness:400}});
      style.color=isActive?highlightColor:fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.textShadow=Array.from({length:5},(_,i)=>{const o=(i+1)+(isActive?Math.sin(frame*0.3+i)*1:0);return `${o}px ${o}px 0px rgba(100,100,255,${0.4-i*0.06})`;}).join(',');
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.7,1.1]):1})`;
      break;
    }
    case 'pixel': {
      style.color=isActive?highlightColor:fontColor; style.fontFamily="'Press Start 2P',monospace";
      style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.textShadow=isActive?`-2px -2px 0 ${outlineColor},2px 2px 0 ${outlineColor},0 0 10px ${highlightColor}`:`-1px -1px 0 ${outlineColor},1px 1px 0 ${outlineColor}`;
      style.transform=`scale(${isActive?1+Math.sin(frame*0.5)*0.05:1})`;
      style.opacity=isActive?0.8+Math.sin(frame*1.5)*0.2:1;
      break;
    }
    case 'retro': {
      const sw=isActive?Math.sin(frame*0.3)*8:0,sw2=isActive?Math.cos(frame*0.25)*6:0;
      style.color=isActive?highlightColor:fontColor; style.WebkitTextStroke='0px transparent';
      style.textShadow=isActive?`${sw2*0.4}px ${3+Math.sin(frame*0.2)*2}px 0px rgba(255,68,170,0.8),0 0 ${15+Math.sin(frame*0.5)*5}px rgba(255,136,204,0.6)`:'2px 2px 0px rgba(255,68,170,0.6)';
      style.transform=`rotate(${sw*0.3}deg) translateX(${sw2*0.2}px)`;
      break;
    }
    case 'gradientcup': {
      const sp=spring({frame:elapsed,fps,config:{damping:8,stiffness:400}}),hue=(frame*2.5)%360;
      style.backgroundImage=`linear-gradient(${135+Math.sin(frame*0.2)*20}deg,hsl(${hue},100%,60%),hsl(${(hue+150)%360},100%,60%),hsl(${(hue+270)%360},100%,60%))`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.7,1.05]):1})`;
      style.textShadow=`0 0 ${15+Math.sin(frame*0.4)*5}px hsl(${hue},100%,70%)`;
      break;
    }
    case 'outline': {
      const sp=spring({frame:elapsed,fps,config:{damping:10,stiffness:350}}),outHue=(frame*2)%360;
      style.color=fontColor;
      style.WebkitTextStroke=`${isActive?outlineWidth+Math.sin(frame*0.5)*1.5:outlineWidth}px hsl(${outHue},100%,60%)`;
      style.textShadow=isActive?`0 0 ${8+Math.sin(frame*0.4)*4}px hsl(${outHue},100%,70%)`:'none';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      break;
    }
    case 'chrome': {
      const sp=spring({frame:elapsed,fps,config:{damping:12,stiffness:380}}),angle=(frame*1.5)%360;
      style.backgroundImage=`linear-gradient(${angle}deg,#aaa,#fff,#eee,#fff,#bbb,#888,#fff,#ccc)`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent';
      style.WebkitTextStroke=`${outlineWidth}px rgba(255,255,255,0.3)`;
      style.textShadow=`0 0 ${10+Math.sin(frame*0.3)*4}px rgba(255,255,0,0.5),2px 2px 4px rgba(0,0,0,0.5)`;
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.85,1.0]):1})`;
      break;
    }
    case 'glass': {
      const sp=spring({frame:elapsed,fps,config:{damping:15,stiffness:280}});
      style.color=isActive?`rgba(255,255,255,${0.55+Math.sin(frame*0.3)*0.2})`:'rgba(255,255,255,0.4)';
      style.WebkitTextStroke=`${outlineWidth}px rgba(255,255,255,${0.6+Math.sin(frame*0.25)*0.2})`;
      style.textShadow=isActive?`0 0 ${12+Math.sin(frame*0.35)*5}px rgba(255,255,255,0.8)`:'0 0 8px rgba(255,255,255,0.5)';
      style.backgroundColor=`rgba(255,255,255,${isActive?0.08+Math.sin(frame*0.2)*0.03:0.05})`;
      style.padding='10px 24px'; style.borderRadius='12px';
      style.border=`1px solid rgba(255,255,255,${0.2+Math.sin(frame*0.3)*0.1})`;
      style.opacity=isActive?interpolate(sp,[0,1],[0,1]):0.8;
      break;
    }
    // ── Novos 2025 (mantidos da versão anterior) ────────────────────────────
    case 'wordbyword': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:200}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`translateY(${isActive?(1-sp)*40:0}px) scale(${isActive?sp:0.7})`;
      style.textShadow='0 3px 12px rgba(0,0,0,0.8)';
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.15)):0.7;
      break;
    }
    case 'highlightbox': {
      const pillColors=['#FF6B6B','#FFE66D','#4ECDC4','#A855F7','#F97316'];
      const hash=text.split('').reduce((a:number,c:string)=>a+c.charCodeAt(0),0);
      const sp=spring({frame:elapsed,fps,config:{damping:13,stiffness:180}});
      style.color='#000'; style.backgroundColor=pillColors[hash%pillColors.length];
      style.padding='6px 18px'; style.borderRadius='10px'; style.WebkitTextStroke='0px transparent';
      style.transform=`scale(${isActive?sp:1}) rotate(${isActive?(1-sp)*-8:0}deg)`;
      if(isActive) style.boxShadow=`0 4px 12px rgba(0,0,0,0.25)`;
      break;
    }
    case 'splitflap': {
      const sp=spring({frame:elapsed,fps,config:{damping:12,stiffness:200}});
      style.color=isActive?'#FFE500':'#555'; style.backgroundColor='#111';
      style.padding='8px 20px'; style.borderRadius='8px';
      style.border=`2px solid ${isActive?'#FFE500':'#333'}`;
      style.textShadow=isActive?'0 0 14px #FFE500':'none';
      style.fontFamily="'Courier New',monospace"; style.letterSpacing='0.14em';
      style.transform=`scale(${isActive?sp:1})`;
      break;
    }
    case 'firetext': {
      const hueF=isActive?30+Math.sin(frame*0.4)*15:30;
      style.backgroundImage=isActive?`linear-gradient(0deg,hsl(${hueF-10},100%,40%),hsl(${hueF+10},100%,65%),#fff)`:'linear-gradient(0deg,#FF4500,#FFAA00)';
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent';
      style.WebkitTextStroke=`${outlineWidth}px rgba(255,80,0,0.4)`;
      style.transform=`translateY(${isActive?Math.sin(frame*1.2)*3:0}px) skewX(${isActive?Math.cos(frame*0.9)*2:0}deg)`;
      style.textShadow=isActive?`0 0 ${20+Math.sin(frame*0.8)*6}px #FF4500,0 0 40px #FF2200`:'0 0 12px #FF4500';
      break;
    }
    case 'rainbowwave': {
      const hue=(frame*4)%360;
      style.backgroundImage=`linear-gradient(135deg,hsl(${hue},100%,60%),hsl(${(hue+60)%360},100%,60%),hsl(${(hue+120)%360},100%,60%),hsl(${(hue+180)%360},100%,60%))`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.textShadow=`0 0 ${14+Math.sin(frame*0.5)*5}px hsl(${hue},100%,70%)`;
      style.transform=`scale(${isActive?1.02+Math.sin(frame*0.3)*0.04:1}) translateY(${isActive?Math.sin(frame*0.4)*6:0}px)`;
      break;
    }
    case 'threed': {
      const sp=spring({frame:elapsed,fps,config:{damping:12,stiffness:150}});
      style.color=fontColor; style.letterSpacing='0.06em';
      style.textShadow=Array.from({length:6},(_,i)=>`${i+1}px ${i+1}px 0px rgba(136,136,136,${0.3-i*0.04})`).join(',');
      style.transform=`perspective(400px) rotateY(${isActive?Math.sin(frame*0.15)*12:0}deg) scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      break;
    }
    case 'bubble': {
      const sp=spring({frame:elapsed,fps,config:{damping:7,stiffness:280,mass:0.6}});
      style.color='#111'; style.backgroundColor='#FFFFFF'; style.padding='12px 28px';
      style.borderRadius='20px';
      style.boxShadow=isActive?'0 8px 30px rgba(0,0,0,0.35)':'0 4px 16px rgba(0,0,0,0.2)';
      style.WebkitTextStroke='0px transparent';
      style.transform=`scale(${isActive?sp:0.8})`; style.transformOrigin='bottom center';
      // Cauda triangular via CSS border trick (pseudo-element via inline after)
      style.position='relative';
      // Note: the tail div is rendered in the SubtitleOverlay wrapper below
      break;
    }
    case 'countdown': {
      const sp=spring({frame:elapsed,fps,config:{damping:6,stiffness:400,mass:0.4}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`scale(${isActive?2-sp:1})`;
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.1)):0.7;
      style.textShadow=isActive?`0 0 ${30+Math.sin(frame*0.4)*10}px rgba(255,107,107,0.8)`:'none';
      break;
    }
    case 'slideinleft': {
      const sp=spring({frame:elapsed,fps,config:{damping:16,stiffness:160}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`translateX(${isActive?(1-sp)*-400:-8}px)`;
      style.textShadow='0 3px 12px rgba(0,0,0,0.8)';
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.1)):0.7;
      break;
    }
    case 'stamp': {
      const sp=spring({frame:elapsed,fps,config:{damping:5,stiffness:500,mass:0.8}});
      style.color=highlightColor; style.border=`3px solid ${highlightColor}`; style.borderRadius='8px'; style.padding='8px 24px';
      style.transform=`scale(${isActive?Math.max(1,3-sp*2):1}) rotate(${isActive?-4+Math.sin(frame*0.3)*1:-3}deg)`;
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.1)):0.7;
      style.textShadow=isActive?`0 0 20px ${highlightColor}88`:'none';
      style.letterSpacing='0.16em'; style.WebkitTextStroke='0px transparent';
      break;
    }
    case 'holographic': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:140}}),hue=(frame*2)%360;
      style.backgroundImage=`linear-gradient(${hue*3}deg,hsl(${hue},100%,70%),hsl(${(hue+120)%360},100%,70%),hsl(${(hue+240)%360},100%,70%))`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.filter=isActive?`drop-shadow(0 0 8px hsl(${hue},100%,70%))`:'none';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      break;
    }
    case 'gradshift': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:160}});
      const hueBase=280;
      const hueShift=Math.sin((frame/30)*0.8)*30;
      const h1=hueBase+hueShift;
      const h2=(hueBase+60+hueShift)%360;
      const angle=120+Math.sin((frame/30)*0.5)*15;
      style.backgroundImage=`linear-gradient(${angle}deg,hsl(${h1},90%,65%),hsl(${h2},100%,55%))`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.filter=isActive?'drop-shadow(0 3px 10px rgba(150,80,255,0.45))':'none';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):0.95})`;
      style.fontWeight='900';
      break;
    }
    case 'shadowdepth': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:140}});
      const sx=isActive?Math.sin(frame*0.2)*8:4,sy=isActive?Math.cos(frame*0.15)*6+5:5;
      style.color=fontColor;
      style.textShadow=`${sx}px ${sy}px 0 rgba(100,100,255,0.7),${sx*1.5}px ${sy*1.5}px 0 rgba(200,0,200,0.4),${sx*2}px ${sy*2}px 10px rgba(0,0,0,0.4)`;
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      break;
    }
    case 'zoombeat': {
      const pulse=Math.max(0,1-(elapsed/fps)*3.5);
      const sc=1+pulse*0.22;
      const glow=pulse*28;
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.fontWeight='900';
      style.transform=`scale(${isActive?sc:1})`;
      style.textShadow=isActive?`0 0 ${glow}px rgba(255,255,255,0.95),0 0 ${glow*1.8}px rgba(255,160,0,0.6)`:'none';
      break;
    }
    case 'outlineflash': {
      const sp=spring({frame:elapsed,fps,config:{damping:12,stiffness:200}});
      const fc=Math.sin(frame*0.8)>0?'#FFE500':'#FF3B3B';
      style.color='transparent'; style.WebkitTextStroke=`${outlineWidth}px ${fc}`;
      style.textShadow=isActive?`0 0 ${14+Math.sin(frame*0.5)*5}px ${fc}`:'none';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      break;
    }
    case 'sticker': {
      const sp=spring({frame:elapsed,fps,config:{damping:6,stiffness:300,mass:0.5}});
      style.color='#000'; style.backgroundColor='#FFE500'; style.padding='10px 26px'; style.borderRadius='16px';
      style.border='3px solid #000'; style.boxShadow='3px 3px 0 #000';
      style.transform=`scale(${isActive?sp:0.9}) rotate(${isActive?Math.sin(frame*0.4)*4:0}deg)`;
      style.WebkitTextStroke='0px transparent';
      break;
    }
    case 'morph': {
      const sp=spring({frame:elapsed,fps,config:{damping:20,stiffness:80}});
      const skew=isActive?Math.sin((frame/30)*2.5)*4:0;
      const scX=isActive?1+Math.sin((frame/30)*3)*0.04:1;
      style.backgroundImage='linear-gradient(90deg,#4ECDC4,#A855F7)';
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.fontWeight='900';
      style.transform=`skewX(${skew}deg) scaleX(${scX}) scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):0.92})`;
      style.opacity=isActive?1:0.75;
      break;
    }
    case 'stackreveal': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:150}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.textShadow='0 3px 12px rgba(0,0,0,0.8)';
      style.transform=`translateY(${isActive?(1-sp)*30:0}px) scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1})`;
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.1)):0.7;
      break;
    }
    case 'liquidflow': {
      const w=isActive?Math.sin(frame*0.3)*4:0,hue=(frame*1.5)%360;
      style.backgroundImage=`linear-gradient(${90+w*5}deg,#4ECDC4,#44CF6C,hsl(${hue},80%,65%),#4ECDC4)`;
      style.WebkitBackgroundClip='text'; style.WebkitTextFillColor='transparent'; style.color='transparent'; style.WebkitTextStroke='0px transparent';
      style.transform=`translate(${isActive?Math.sin(frame*0.25)*3:0}px,${isActive?Math.cos(frame*0.2)*2:0}px)`;
      style.filter=isActive?'drop-shadow(0 0 8px rgba(78,205,196,0.7))':'none';
      break;
    }
    case 'pixelreveal': {
      const prog=isActive?Math.min(1,elapsed/(fps*0.8)):0;
      const pixelScale=1+(1-prog)*1.2;
      const crisp=prog>0.85;
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`scale(${isActive?pixelScale:1.2})`;
      style.imageRendering=crisp?'auto':'pixelated';
      style.filter=crisp?'none':`blur(${(1-prog)*1.5}px)`;
      style.opacity=isActive?Math.min(1,prog*3):0.5;
      style.letterSpacing=crisp?'inherit':`${(1-prog)*4}px`;
      break;
    }
    case 'cassette': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:160}});
      style.color='#2D2D2D'; style.backgroundColor='#F5F0E8'; style.padding='10px 26px'; style.borderRadius='10px';
      style.border='3px solid #2D2D2D'; style.boxShadow='2px 2px 0 #2D2D2D';
      style.fontFamily="'Courier New',monospace"; style.letterSpacing='0.18em'; style.WebkitTextStroke='0px transparent';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.8,1.0]):1}) rotate(${isActive?Math.sin(frame*0.2)*1:-1}deg)`;
      break;
    }
    case 'bouncywords': {
      const sp=spring({frame:elapsed,fps,config:{damping:5,stiffness:300,mass:0.6}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`translateY(${isActive?(1-sp)*-60:0}px) scale(${isActive?sp:0.9})`;
      style.textShadow='0 4px 0 rgba(0,0,0,0.4)';
      break;
    }
    case 'terminal': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:160}});
      style.color=fontColor; style.backgroundColor='rgba(30,30,30,0.95)'; style.padding='10px 26px';
      style.borderRadius='10px'; style.border='1px solid #444';
      style.fontFamily="'Courier New',monospace"; style.letterSpacing='0.06em';
      style.textTransform='none'; style.WebkitTextStroke='0px transparent';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.9,1.0]):1})`;
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.1)):0.8;
      break;
    }
    case 'slicereveal': {
      const prog=isActive?Math.min(1,elapsed/(fps*0.5)):0;
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.clipPath=`inset(0 ${Math.max(0,100-prog*100)}% 0 0)`;
      style.textShadow=isActive?'0 0 20px rgba(255,255,255,0.4)':'none';
      break;
    }
    case 'chalkboard': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:160}});
      const jitter=isActive?Math.sin((frame/30)*22)*0.5:0;
      style.color=`rgba(240,236,220,${0.82+Math.sin((frame/30)*12)*0.04})`;
      style.backgroundColor='rgba(45,90,61,0.92)';
      style.padding='12px 28px'; style.borderRadius='6px'; style.border='4px solid #8B6914';
      style.fontFamily="'Patrick Hand','Segoe Print',cursive"; style.fontWeight='normal';
      style.letterSpacing='0.04em';
      style.textTransform='none'; style.WebkitTextStroke='0px transparent';
      style.textShadow=isActive
        ?`${jitter}px ${jitter*0.5}px 0 rgba(255,255,255,0.07),${-jitter*0.8}px ${jitter*0.3}px 0 rgba(255,255,255,0.05),0 1px 2px rgba(0,0,0,0.4)`
        :'0 1px 2px rgba(0,0,0,0.4)';
      style.opacity=isActive?interpolate(sp,[0,1],[0,1]):0.7;
      break;
    }
    case 'punchtext': {
      const sp=spring({frame:elapsed,fps,config:{damping:4,stiffness:600,mass:0.3}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.textShadow=`4px 4px 0 ${outlineColor},6px 6px 0 rgba(0,0,0,0.3)`;
      style.transform=`scale(${isActive?interpolate(sp,[0,0.6,0.8,1],[0,1.35,0.9,1]):1})`;
      break;
    }
    case 'newsticker': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:150}});
      style.color=fontColor; style.backgroundColor='#E63946'; style.padding='10px 26px';
      style.borderTop='3px solid #fff'; style.borderBottom='3px solid #fff';
      style.letterSpacing='0.14em'; style.WebkitTextStroke='0px transparent';
      style.fontSize=`${fontSizePx*0.85}px`;
      style.transform=`translateY(${isActive?(1-sp)*30:0}px)`;
      style.opacity=isActive?Math.min(1,elapsed/(fps*0.1)):0.8;
      break;
    }
    case 'particles': {
      const sp=spring({frame:elapsed,fps,config:{damping:12,stiffness:200}});
      style.color=fontColor; style.WebkitTextStroke=`${outlineWidth}px ${outlineColor}`;
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.7,1.1]):1})`;
      style.textShadow=isActive?'0 0 20px rgba(255,229,0,0.6)':'none';
      break;
    }
    case 'noise': {
      const sp=spring({frame:elapsed,fps,config:{damping:14,stiffness:160}});
      style.color=fontColor; style.WebkitTextStroke='0px transparent';
      style.textShadow=isActive?'0 0 40px rgba(255,255,255,0.3)':'none';
      style.opacity=isActive?interpolate(sp,[0,1],[0,1]):0.5;
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0.9,1.0]):1})`;
      style.filter=(isActive&&elapsed<fps*0.3)?`blur(${(1-elapsed/(fps*0.3))*8}px)`:'none';
      style.letterSpacing='0.1em';
      break;
    }
    case 'strokepop': {
      const sp=spring({frame:elapsed,fps,config:{damping:6,stiffness:300,mass:0.5}});
      style.color='#111'; style.WebkitTextStroke=`${outlineWidth}px #fff`;
      style.textShadow=isActive?`0 0 ${12+Math.sin(frame*0.5)*4}px rgba(255,255,255,0.5)`:'none';
      style.transform=`scale(${isActive?interpolate(sp,[0,1],[0,1.08])*0.93+0.07:1})`;
      break;
    }
    case 'scramble': {
      const GLYPHS='!@#$%&ABCDEFabcdef0123456789?*';
      const revealProgress=isActive?Math.min(1,(elapsed/fps)*2.2):0;
      const charsRevealed=Math.floor(revealProgress*text.length);
      const scrambled=text.split('').map((char:string,i:number)=>{
        if(i<charsRevealed) return char;
        return char===' '?' ':GLYPHS[Math.floor(((frame/30)*18+i*7.3))%GLYPHS.length];
      }).join('');
      style.color=revealProgress>=1?'#FFFFFF':'#00FFFF';
      style.WebkitTextStroke='0px transparent';
      style.textShadow=revealProgress>=1
        ?'0 2px 8px rgba(0,0,0,0.8)'
        :`0 0 ${10+Math.sin((frame/30)*8)*4}px #0ff,0 0 20px rgba(0,255,255,0.4)`;
      style.fontFamily="'Courier New',monospace";
      const sp=spring({frame:elapsed,fps,config:{damping:12,stiffness:200}});
      style.transform=`scale(${isActive?sp:1})`;
      return <div style={style}>{scrambled}</div>;
    }

    default: {
      const sp = spring({ frame: elapsed, fps, config: { damping: 10, stiffness: 400 } });
      style.color = isActive ? highlightColor : fontColor;
      if (outlineWidth > 0) style.WebkitTextStroke = `${outlineWidth}px ${outlineColor}`;
      style.transform = `scale(${isActive ? interpolate(sp, [0, 1], [0.7, 1.1]) : 1})`;
      break;
    }
  }

  return <div style={style}>{text}</div>;
};
