import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, loadImageInto, UrlImportRow, readFileAsDataUrl } from '../shared';

export default function PrintReadyTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  // Print Ready state
  const [prSource, setPrSource] = useState(null);

  const [prDpi, setPrDpi] = useState(300);
  const [prFormat, setPrFormat] = useState('tiff');
  const [prBackground, setPrBackground] = useState('white');
  const [prBleedMm, setPrBleedMm] = useState(0);
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState(null);
  const [prError, setPrError] = useState('');

  // The printer's own CMYK colour profile (an admin uploads it once; everyone's TIFF/CMYK then uses it).
  const [profile, setProfile] = useState(null); // { builtin, custom, canEdit }
  const [profileNote, setProfileNote] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [confirmRemoveProfile, setConfirmRemoveProfile] = useState(false);
  const loadProfile = async () => {
    try {
      const res = await api.get('/api/graphics/print-profile');
      if (res.ok) setProfile(await res.json());
    } catch { /* the line just says the built-in one is used */ }
  };
  useEffect(() => { loadProfile(); }, []);
  const uploadProfile = async (file) => {
    if (!file) return;
    setProfileBusy(true);
    setProfileNote('');
    try {
      const dataBase64 = await readFileAsDataUrl(file);
      const res = await api.post('/api/graphics/print-profile', { dataBase64 });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the profile');
      setProfileNote(`Saved "${data.custom?.name || 'profile'}". New CMYK files will use it.`);
      await loadProfile();
    } catch (err) {
      setProfileNote(err.message || 'Could not save the profile');
    } finally {
      setProfileBusy(false);
    }
  };
  const removeProfile = async () => {
    setConfirmRemoveProfile(false);
    setProfileBusy(true);
    try {
      const res = await api.delete('/api/graphics/print-profile');
      if (!res.ok) throw new Error((await res.json()).error || 'Could not remove it');
      setProfileNote('Removed. New CMYK files use the built-in generic profile.');
      await loadProfile();
    } catch (err) {
      setProfileNote(err.message || 'Could not remove it');
    } finally {
      setProfileBusy(false);
    }
  };

  const runPrintReady = async () => {
    if (!prSource?.imageDataUrl) return;
    setPrBusy(true);
    setPrError('');
    setPrResult(null);
    try {
      const res = await api.post('/api/graphics/print-ready', {
        imageDataUrl: prSource.imageDataUrl,
        dpi: prDpi,
        format: prFormat,
        background: prBackground,
        bleedMm: prBleedMm,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Print-ready conversion failed');
      setPrResult(data);
    } catch (err) {
      setPrError(err.message || 'Print-ready conversion failed');
    } finally {
      setPrBusy(false);
    }
  };

  const downloadPrintReady = () => {
    if (!prResult?.imageDataUrl) return;
    const base = (prSource?.name || 'image').replace(/\.[^.]+$/, '');
    const cs = prResult.colorSpace === 'CMYK' ? '-cmyk' : '';
    const a = document.createElement('a');
    a.href = prResult.imageDataUrl;
    a.download = `${base}-print-ready-${prResult.dpi}dpi${cs}.${prResult.ext}`;
    a.click();
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Print Ready</h2>
            <button type="button" onClick={() => setHelpTool('printready')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Prepare any image for professional printing. Sets the target DPI in file metadata, optionally flattens transparency to white, adds bleed padding, and outputs as TIFF, PDF, or PNG. For offset printing always confirm the colour profile with your print provider.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image (PNG, JPG, WebP…)</label>
              <input type="file" accept="image/*" onChange={e => { setPrError(''); setPrResult(null); loadImageInto(setPrSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setPrError(err); } else { setPrResult(null); setPrSource(src); } })} />
            </div>
            {prSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={prSource.imageDataUrl} alt="source" className="max-h-32 mx-auto rounded object-contain" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Output format</label>
                <select value={prFormat} onChange={e => setPrFormat(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="tiff">TIFF/sRGB (recommended)</option>
                  <option value="tiff-cmyk">TIFF/CMYK (offset print)</option>
                  <option value="pdf">PDF</option>
                  <option value="png">PNG</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Resolution (DPI)</label>
                <select value={prDpi} onChange={e => setPrDpi(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value={150}>150 DPI — large format</option>
                  <option value={300}>300 DPI — standard print</option>
                  <option value={600}>600 DPI — high detail</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
                <select value={prBackground} onChange={e => setPrBackground(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="white">Flatten to white</option>
                  <option value="transparent">Keep transparent</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Bleed margin: {prBleedMm} mm</label>
                <input type="range" min="0" max="25" step="1" value={prBleedMm} onChange={e => setPrBleedMm(Number(e.target.value))} className="w-full mt-1" />
              </div>
            </div>
            {prFormat === 'tiff-cmyk' && (
              <div className="rounded-xl border p-3 space-y-2 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                <p>
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>Colour profile: </span>
                  {profile?.custom ? <>your printer's profile, <strong>{profile.custom.name}</strong></> : (profile?.builtin?.name || 'built-in generic profile')}
                </p>
                {!profile?.custom && (
                  <p>The built-in profile gives a sensible rough conversion, but it is not a press standard. For colour you can rely on, ask your printer for their CMYK profile (an .icc file, often FOGRA39 or GRACoL){profile?.canEdit ? ' and add it below.' : ' and ask an administrator to add it here.'}</p>
                )}
                {profile?.canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Tooltip text="Choose your printer's CMYK colour profile (.icc or .icm). It is checked, kept for everyone in this workspace, and used for every TIFF/CMYK."><input type="file" accept=".icc,.icm" disabled={profileBusy} onChange={e => { uploadProfile(e.target.files?.[0]); e.target.value = ''; }} className="text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
                    {profile?.custom && !confirmRemoveProfile && (
                      <Tooltip text="Stop using the printer's profile and go back to the built-in generic one."><button type="button" onClick={() => setConfirmRemoveProfile(true)} className="hover:opacity-60" style={{ color: '#ef4444' }}>Remove</button></Tooltip>
                    )}
                    {confirmRemoveProfile && (
                      <span className="flex items-center gap-2">Remove it?
                        <button type="button" className="font-medium hover:opacity-60" style={{ color: '#ef4444' }} onClick={removeProfile}>Yes</button>
                        <button type="button" className="font-medium hover:opacity-60" onClick={() => setConfirmRemoveProfile(false)}>No</button>
                      </span>
                    )}
                  </div>
                )}
                {profileNote && <p>{profileNote}</p>}
              </div>
            )}
            {prError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{prError}</div>}
            <button type="button" onClick={runPrintReady} disabled={prBusy || !prSource?.imageDataUrl} className="w-full px-4 py-2 rounded-xl font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {getIcon('printer', { size: 15 })} {prBusy ? 'Converting…' : 'Convert to Print Ready'}
            </button>
          </div>
          {prResult ? (
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              </div>
              <div className="p-4 space-y-4">
                {prResult.ext !== 'pdf' && !prResult.proofDataUrl && (
                  <img src={prResult.imageDataUrl} alt="print-ready preview" className="max-h-48 mx-auto rounded-lg object-contain" style={{ background: '#f5f5f5' }} />
                )}
                {prResult.proofDataUrl && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <figure className="text-center">
                        <img src={prSource?.imageDataUrl} alt="original on screen" className="max-h-40 mx-auto rounded-lg object-contain" style={{ background: '#f5f5f5' }} />
                        <figcaption className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>On screen (original)</figcaption>
                      </figure>
                      <figure className="text-center">
                        <img src={prResult.proofDataUrl} alt="soft proof of the printed colours" className="max-h-40 mx-auto rounded-lg object-contain" style={{ background: '#f5f5f5' }} />
                        <figcaption className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>As printed (soft proof)</figcaption>
                      </figure>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>The right-hand picture is the CMYK file shown back on screen through the {prResult.profileCustom ? "printer's" : 'built-in'} profile. It is a guide: your screen and the real press will still differ a little.</p>
                    {prResult.outOfGamutPct >= 3 && (
                      <div className="text-xs px-3 py-2 rounded-xl" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                        ⚠ About {Math.round(prResult.outOfGamutPct)}% of the picture has bright colours a printer cannot reproduce (often vivid blues, greens and oranges). They will print duller, as in the proof.
                      </div>
                    )}
                  </div>
                )}
                {prResult.colorSpace === 'CMYK' && prResult.colorManaged === false && (
                  <div className="text-xs px-3 py-2 rounded-xl" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                    ⚠ The colour profile conversion could not be used, so a plain mathematical conversion was used instead. The file has no profile embedded: check the colours with your printer.
                  </div>
                )}
                {prResult.ext === 'pdf' && (
                  <div className="flex items-center justify-center h-32 rounded-xl" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div className="text-center">
                      {getIcon('file-text', { size: 28, style: { color: 'var(--color-muted)', margin: '0 auto 6px' } })}
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>PDF — preview not available</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="px-3 py-2 rounded-xl text-center" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div className="font-semibold" style={{ color: 'var(--color-text)' }}>{prResult.dpi} DPI</div>
                    <div style={{ color: 'var(--color-muted)' }}>Resolution</div>
                  </div>
                  <div className="px-3 py-2 rounded-xl text-center" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div className="font-semibold" style={{ color: 'var(--color-text)' }}>{prResult.ext?.toUpperCase()}</div>
                    <div style={{ color: 'var(--color-muted)' }}>{prResult.colorSpace || 'sRGB'}</div>
                  </div>
                  <div className="col-span-2 px-3 py-2 rounded-xl text-center" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div className="font-semibold" style={{ color: 'var(--color-text)' }}>
                      {prResult.printWidthMm} × {prResult.printHeightMm} mm
                    </div>
                    <div style={{ color: 'var(--color-muted)' }}>
                      {prResult.printWidthIn} × {prResult.printHeightIn} in · {prResult.pixelWidth} × {prResult.pixelHeight} px
                    </div>
                  </div>
                  {prResult.bleedMm > 0 && (
                    <div className="col-span-2 px-3 py-2 rounded-xl text-center" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                      <div className="font-semibold" style={{ color: 'var(--color-text)' }}>{prResult.bleedMm} mm bleed</div>
                      <div style={{ color: 'var(--color-muted)' }}>Bleed padding added</div>
                    </div>
                  )}
                </div>
                {prResult.qualityNote && (
                  <div className="text-xs px-3 py-2 rounded-xl" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                    ⚠ {prResult.qualityNote}
                  </div>
                )}
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Tips for your printer</p>
                  {prResult.colorSpace === 'CMYK'
                    ? <p>• {prResult.colorManaged ? `Colour space is CMYK, converted through ${prResult.profileCustom ? 'your printer\'s profile' : 'the built-in generic profile'}${prResult.profileName ? ` (${prResult.profileName})` : ''} and embedded in the file. Tell your printer which profile you used.` : 'Colour space is CMYK, but without an embedded profile.'}</p>
                    : <p>• Colour space is sRGB — ask your printer if they need a CMYK conversion.</p>
                  }
                  <p>• TIFF and PDF are the most widely accepted print file formats.</p>
                  {prResult.bleedMm === 0 && <p>• Add {prFormat === 'pdf' ? '3–5' : '3'} mm bleed if your artwork goes edge-to-edge.</p>}
                </div>
                <button type="button" onClick={downloadPrintReady} className="w-full px-4 py-2 rounded-xl font-medium text-white flex items-center justify-center gap-2" style={{ background: 'var(--color-primary)' }}>
                  {getIcon('download', { size: 15 })} Download {prResult.ext?.toUpperCase()}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border flex items-center justify-center p-10" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="text-center space-y-2">
                {getIcon('printer', { size: 32, style: { color: 'var(--color-muted)', margin: '0 auto' } })}
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Your print-ready file will appear here.</p>
              </div>
            </div>
          )}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
          Runs locally — nothing is uploaded. TIFF/CMYK is converted through a colour (ICC) profile and the profile is embedded in the file. With only the built-in generic profile it is a rough guide; for colour-critical offset work use your printer's own profile (an administrator can add it here) and check a proof with them.
        </p>
      </section>
    </>
  );
}
