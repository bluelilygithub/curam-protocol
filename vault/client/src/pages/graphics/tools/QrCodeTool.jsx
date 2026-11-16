import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput, VoiceInputProvider } from '../../../components/voiceInput/VoiceInput';
import useToastStore from '../../../store/toastStore';
import { useGraphics } from '../GraphicsContext';
import { downloadDataUrl, readFileAsDataUrl, loadImageEl } from '../shared';
import { encodeQr, buildQrPayload, qrToSvg, contrastRatio, isInverted, ECC_LEVELS } from '../qrEncode.mjs';
import { downloadBlob } from '../../../utils/exportHelpers';

// QR Code: make a scannable code for a link, text, Wi-Fi login, email, phone, text message or contact card.
// Entirely in the browser (graphics/qrEncode.mjs); nothing is uploaded.

const KINDS = [
  { id: 'link', label: 'Link', tip: 'A web address. Scanning opens it in the phone\'s browser.' },
  { id: 'text', label: 'Text', tip: 'Any plain text. Scanning shows the text.' },
  { id: 'wifi', label: 'Wi-Fi', tip: 'A Wi-Fi network name and password. Scanning offers to join the network (no typing the password).' },
  { id: 'email', label: 'Email', tip: 'An email address, with an optional subject and message. Scanning opens a new email.' },
  { id: 'phone', label: 'Phone', tip: 'A phone number. Scanning offers to call it.' },
  { id: 'sms', label: 'Text message', tip: 'A phone number and optional message. Scanning opens a new text message.' },
  { id: 'contact', label: 'Contact', tip: 'A contact card (vCard). Scanning offers to save the person to the phone\'s contacts.' },
];

const ECC_HELP = {
  L: 'Low (7%)',
  M: 'Medium (15%)',
  Q: 'Quartile (25%)',
  H: 'High (30%)',
};

const fieldStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const labelCls = 'block text-xs font-medium mb-1';
const labelStyle = { color: 'var(--color-muted)' };

function Field({ label, tip, children }) {
  return (
    <div>
      <label className={labelCls} style={labelStyle}>{label}</label>
      <Tooltip text={tip}><div>{children}</div></Tooltip>
    </div>
  );
}

// Draws the code (and an optional logo in the middle) onto a canvas. Every module is a whole number of pixels so
// the edges stay sharp; the canvas is therefore the nearest size at or below the one asked for.
function drawQr(canvas, qr, { sizePx, margin, dark, light, transparent, logoImg, logoPct }) {
  const dim = qr.size + margin * 2;
  const px = Math.max(1, Math.floor(sizePx / dim));
  const W = px * dim;
  canvas.width = W; canvas.height = W;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, W);
  if (!transparent) { ctx.fillStyle = light; ctx.fillRect(0, 0, W, W); }
  ctx.fillStyle = dark;
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect((x + margin) * px, (y + margin) * px, px, px);
  }
  if (logoImg) {
    const box = Math.round(qr.size * px * logoPct / 100);
    const pad = Math.max(2, Math.round(box * 0.08));
    const bx = Math.round((W - box) / 2);
    ctx.fillStyle = transparent ? '#ffffff' : light;
    const r = Math.round(box * 0.12);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx - pad, bx - pad, box + pad * 2, box + pad * 2, r); else ctx.rect(bx - pad, bx - pad, box + pad * 2, box + pad * 2);
    ctx.fill();
    const iw = logoImg.naturalWidth || logoImg.width;
    const ih = logoImg.naturalHeight || logoImg.height;
    const s = Math.min(box / iw, box / ih);
    const dw = iw * s; const dh = ih * s;
    ctx.drawImage(logoImg, bx + (box - dw) / 2, bx + (box - dh) / 2, dw, dh);
  }
  return W;
}

export default function QrCodeTool({ active }) {
  const getIcon = useIcon();
  const { brandKit, renderSendTo, setHelpTool, setPreviewImage } = useGraphics();
  const addToast = useToastStore((s) => s.addToast);

  const [kind, setKind] = useState('link');
  const [f, setF] = useState({ url: '', text: '', ssid: '', password: '', security: 'WPA', hidden: false, to: '', subject: '', body: '', number: '', message: '', name: '', org: '', phone: '', email: '', curl: '' });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const [ecc, setEcc] = useState('M');
  const [sizePx, setSizePx] = useState(1024);
  const [margin, setMargin] = useState(4);
  const [dark, setDark] = useState('#000000');
  const [light, setLight] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [logoMode, setLogoMode] = useState('none'); // 'none' | 'brand' | 'upload'
  const [logoUpload, setLogoUpload] = useState('');
  const [logoPct, setLogoPct] = useState(20);
  const [logoImg, setLogoImg] = useState(null);
  const [pngUrl, setPngUrl] = useState('');
  const [pixelSize, setPixelSize] = useState(0);
  const canvasRef = useRef(null);

  const payload = useMemo(() => {
    const fields = kind === 'contact' ? { ...f, url: f.curl } : f;
    return buildQrPayload(kind, fields);
  }, [kind, f]);

  const logoSrc = logoMode === 'brand' ? (brandKit?.logoDataUrl || '') : logoMode === 'upload' ? logoUpload : '';
  // A logo hides part of the code, so the highest level of error correction is used whenever one is on.
  const effectiveEcc = logoSrc ? 'H' : ecc;

  const { qr, error } = useMemo(() => {
    if (!payload) return { qr: null, error: '' };
    try { return { qr: encodeQr(payload, { ecc: effectiveEcc }), error: '' }; } catch (err) { return { qr: null, error: err.message }; }
  }, [payload, effectiveEcc]);

  useEffect(() => {
    if (!logoSrc) { setLogoImg(null); return undefined; }
    let off = false;
    loadImageEl(logoSrc).then((img) => { if (!off) setLogoImg(img); }).catch(() => { if (!off) setLogoImg(null); });
    return () => { off = true; };
  }, [logoSrc]);

  useEffect(() => {
    if (!active) return;
    const c = canvasRef.current;
    if (!c || !qr) { setPngUrl(''); setPixelSize(0); return; }
    const W = drawQr(c, qr, { sizePx, margin, dark, light, transparent, logoImg, logoPct });
    setPixelSize(W);
    setPngUrl(c.toDataURL('image/png'));
  }, [active, qr, sizePx, margin, dark, light, transparent, logoImg, logoPct]);

  const ratio = contrastRatio(dark, transparent ? '#ffffff' : light);
  const warnings = [];
  if (!transparent && isInverted(dark, light)) warnings.push('The code is lighter than its background. Many phone cameras cannot read a light-on-dark code; swap the two colours.');
  else if (ratio != null && ratio < 4) warnings.push(`The two colours are close (contrast ${ratio.toFixed(1)}:1). Aim for 4:1 or more so every phone can read it.`);
  if (transparent) warnings.push('See-through background: the code only scans if whatever it is placed on is light and plain.');
  if (margin < 2) warnings.push('A margin under 2 squares can stop it scanning when it sits next to other things. 4 is the standard.');
  if (logoSrc && logoPct > 25) warnings.push('A logo this big can cover too much of the code. Keep it at 25% or less.');
  if (qr && qr.version > 15) warnings.push('This is a dense code. Shorter text (or a short link) makes a code that scans more easily from further away.');

  const fileBase = `qr-${kind}`;
  const downloadSvg = () => {
    if (!qr) return;
    let svg = qrToSvg(qr, { margin, dark, light, transparent });
    if (logoSrc && logoImg) {
      // Same placement as the PNG, in module units.
      const dim = qr.size + margin * 2;
      const box = qr.size * logoPct / 100;
      const pad = Math.max(0.2, box * 0.08);
      const b = (dim - box) / 2;
      const bg = `<rect x="${b - pad}" y="${b - pad}" width="${box + pad * 2}" height="${box + pad * 2}" rx="${box * 0.12}" fill="${transparent ? '#ffffff' : light}"/>`;
      const img = `<image href="${logoSrc}" x="${b}" y="${b}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet"/>`;
      svg = svg.replace('</svg>', `${bg}${img}</svg>`);
    }
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase}.svg`);
  };
  const copyText = async () => {
    try { await navigator.clipboard.writeText(payload); addToast?.('What the code says is copied', 'success'); } catch { addToast?.('Could not copy', 'error'); }
  };

  const text = (key, label, tip, placeholder, extra = {}) => (
    <Field label={label} tip={tip}>
      <VoiceInput value={f[key]} onChange={set(key)} placeholder={placeholder} label={label} {...extra} />
    </Field>
  );

  return (
    <VoiceInputProvider lang="en-AU">
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>QR Code</h2>
            <button type="button" onClick={() => setHelpTool('qrcode')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs in browser · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Make a QR code for a poster, flyer, menu, sign or product. Choose what it should do when scanned, fill in the details, then download it. Nothing is uploaded.</p>
            <div>
              <label className={labelCls} style={labelStyle}>What should it do?</label>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <Tooltip key={k.id} text={k.tip}>
                    <button type="button" onClick={() => setKind(k.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70" style={{ background: kind === k.id ? 'var(--color-primary)' : 'transparent', color: kind === k.id ? 'var(--color-on-primary, #fff)' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>{k.label}</button>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {kind === 'link' && text('url', 'Web address', 'The page to open. https:// is added if you leave it off.', 'e.g. www.example.com/menu')}
              {kind === 'text' && text('text', 'Text', 'The words shown when the code is scanned.', 'Type the text', { type: 'textarea', append: true, rows: 3 })}
              {kind === 'wifi' && (
                <>
                  {text('ssid', 'Network name', 'The Wi-Fi network name exactly as it appears on a phone, including capitals.', 'e.g. Cafe Guest')}
                  <Field label="Security" tip="Most home and business networks use WPA/WPA2/WPA3. Choose None for an open network.">
                    <select value={f.security} onChange={(e) => set('security')(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={fieldStyle}>
                      <option value="WPA">WPA / WPA2 / WPA3</option>
                      <option value="WEP">WEP (old)</option>
                      <option value="nopass">None (open network)</option>
                    </select>
                  </Field>
                  {f.security !== 'nopass' && text('password', 'Password', 'The Wi-Fi password. It is stored inside the code, so anyone who can scan it can join.', 'Wi-Fi password')}
                  <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                    <Tooltip text="Tick if the network does not show up in the list of networks (a hidden network)."><input type="checkbox" checked={f.hidden} onChange={(e) => set('hidden')(e.target.checked)} /></Tooltip>
                    Hidden network
                  </label>
                </>
              )}
              {kind === 'email' && (
                <>
                  {text('to', 'Email address', 'Who the email goes to.', 'e.g. hello@example.com')}
                  {text('subject', 'Subject (optional)', 'Filled in as the email subject.', 'e.g. Booking enquiry')}
                  {text('body', 'Message (optional)', 'Filled in as the start of the email. The person can change it before sending.', 'Type a message', { type: 'textarea', append: true, rows: 2 })}
                </>
              )}
              {kind === 'phone' && text('number', 'Phone number', 'The number to call. Include the country code (such as +61) if it will be scanned overseas.', 'e.g. +61 2 9999 0000')}
              {kind === 'sms' && (
                <>
                  {text('number', 'Phone number', 'The number the text message goes to.', 'e.g. 0400 000 000')}
                  {text('message', 'Message (optional)', 'Filled in as the text message. The person can change it before sending.', 'e.g. Book me in', { type: 'textarea', append: true, rows: 2 })}
                </>
              )}
              {kind === 'contact' && (
                <>
                  {text('name', 'Name', 'The name saved to the contact.', 'e.g. Sam Lee')}
                  {text('org', 'Business (optional)', 'The business or organisation.', 'e.g. Example Pty Ltd')}
                  {text('phone', 'Phone (optional)', 'The contact phone number.', 'e.g. +61 400 000 000')}
                  {text('email', 'Email (optional)', 'The contact email address.', 'e.g. sam@example.com')}
                  {text('curl', 'Website (optional)', 'The contact website.', 'e.g. www.example.com')}
                </>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Error correction" tip="How much of the code can be dirty, torn or covered and still scan: Low about 7% (smallest code), Medium about 15% (a good default), Quartile about 25%, High about 30%. Higher makes a denser code. A logo always uses High.">
                <select value={effectiveEcc} disabled={!!logoSrc} onChange={(e) => setEcc(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm disabled:opacity-60" style={fieldStyle}>
                  {ECC_LEVELS.map((l) => <option key={l} value={l}>{ECC_HELP[l]}</option>)}
                </select>
              </Field>
              <Field label={`Size: ${sizePx}px`} tip="Width and height of the PNG. 1024px prints sharply up to about 9 cm at 300 DPI; the SVG download scales to any size.">
                <input type="range" min="256" max="3000" step="16" value={sizePx} onChange={(e) => setSizePx(Number(e.target.value))} className="w-full" />
              </Field>
              <Field label={`Margin: ${margin} squares`} tip="The plain border around the code, in code squares. Scanners need it; 4 is the standard.">
                <input type="range" min="0" max="10" value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full" />
              </Field>
              <div>
                <label className={labelCls} style={labelStyle}>Colours</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Tooltip text="Colour of the code squares. Keep it dark."><input type="color" value={dark} onChange={(e) => setDark(e.target.value)} className="h-8 w-10 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                  {brandKit?.colors?.filter(Boolean).map((c, i) => (
                    <Tooltip key={i} text={`Use brand colour ${i + 1} for the code squares.`}>
                      <button type="button" onClick={() => setDark(c)} className="h-6 w-6 rounded-full border flex-shrink-0" style={{ background: c, borderColor: 'var(--color-border)' }} />
                    </Tooltip>
                  ))}
                  {!transparent && <Tooltip text="Colour behind the code. Keep it light."><input type="color" value={light} onChange={(e) => setLight(e.target.value)} className="h-8 w-10 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>}
                  <Tooltip text="Swap the two colours."><button type="button" onClick={() => { setDark(light); setLight(dark); }} disabled={transparent} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Swap</button></Tooltip>
                </div>
                <label className="flex items-center gap-2 text-xs mt-2" style={{ color: 'var(--color-text)' }}>
                  <Tooltip text="Leave the background see-through (PNG and SVG), to place the code on your own design."><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /></Tooltip>
                  See-through background
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelCls} style={labelStyle}>Logo in the middle</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'none', label: 'None', tip: 'No logo. The easiest code to scan.' },
                  { id: 'brand', label: 'Brand Kit logo', tip: brandKit?.logoDataUrl ? 'Put the logo saved in your Brand Kit in the middle.' : 'Save a logo in the Brand Kit (button above the tool list) to use it here.', disabled: !brandKit?.logoDataUrl },
                  { id: 'upload', label: 'Choose a picture', tip: 'Put a picture of your choice in the middle.' },
                ].map((o) => (
                  <Tooltip key={o.id} text={o.tip}>
                    <button type="button" disabled={o.disabled} onClick={() => setLogoMode(o.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={{ background: logoMode === o.id ? 'var(--color-primary)' : 'transparent', color: logoMode === o.id ? 'var(--color-on-primary, #fff)' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>{o.label}</button>
                  </Tooltip>
                ))}
              </div>
              {logoMode === 'upload' && (
                <Tooltip text="Choose the picture to put in the middle of the code. A square logo works best.">
                  <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setLogoUpload(await readFileAsDataUrl(file)); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
                </Tooltip>
              )}
              {logoSrc && (
                <Field label={`Logo size: ${logoPct}% of the code`} tip="How wide the logo is. Bigger logos cover more of the code; 20% is safe with High error correction.">
                  <input type="range" min="10" max="30" value={logoPct} onChange={(e) => setLogoPct(Number(e.target.value))} className="w-full" />
                </Field>
              )}
              {logoSrc && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>With a logo the code uses High error correction, so it still scans with the middle covered.</p>}
            </div>

            {error && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>}
            {warnings.map((w) => <p key={w} className="text-xs" style={{ color: '#f59e0b' }}>{w}</p>)}
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {pngUrl && qr && (
                <div className="flex items-center gap-2 flex-wrap">
                  {renderSendTo(pngUrl, `${fileBase}.png`, 'qrcode')}
                  <Tooltip text="Save the code as a PNG picture at the size above."><button type="button" onClick={() => downloadDataUrl(pngUrl, `${fileBase}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>PNG</button></Tooltip>
                  <Tooltip text="Save the code as an SVG, which stays sharp at any size. Best for print."><button type="button" onClick={downloadSvg} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>SVG</button></Tooltip>
                  <Tooltip text="Copy exactly what the code contains, to check it or paste it elsewhere."><button type="button" onClick={copyText} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Copy text</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {pngUrl && qr ? (
                <>
                  <button type="button" onClick={() => setPreviewImage({ imageDataUrl: pngUrl, width: pixelSize, height: pixelSize })} className="block w-full rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                    <img src={pngUrl} alt="QR code" className="w-full" style={{ imageRendering: 'pixelated' }} />
                  </button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{pixelSize}×{pixelSize}px · version {qr.version} ({qr.size}×{qr.size} squares) · error correction {qr.ecc}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Scan it with your own phone before you print or share it.</p>
                  <p className="text-[11px] mt-2 break-all" style={{ color: 'var(--color-muted)' }}>Contains: {payload.length > 160 ? `${payload.slice(0, 160)}…` : payload}</p>
                </>
              ) : (
                <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Fill in the details and the code appears here.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </VoiceInputProvider>
  );
}
