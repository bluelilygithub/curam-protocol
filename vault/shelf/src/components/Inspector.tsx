import type { ActionId, ClipContent, ClipMeta, DispatchResult } from '../bridge/types';
import type { Described } from '../lib/describe';
import type { ActionState } from '../lib/settings';
import { formatBytes, timeAgo } from '../lib/time';
import ActionBar from './ActionBar';
import Icon from './Icon';
import { HtmlView, ImageView, PlainText, RedactionView, SvgView, TextClipView } from './Preview';

export interface RedactState { clipId: string; result: DispatchResult }

interface Props {
  meta: ClipMeta | null;
  desc: Described | null;
  /** undefined = loading, null = gone */
  content: ClipContent | null | undefined;
  actions: ActionState[];
  busy: ActionId | null;
  redact: RedactState | null;
  onAction: (a: ActionId) => void;
  onCloseRedact: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

function Empty({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-sm text-shelf-muted text-center px-6">{text}</div>;
}

function Body({ meta, content, redact, onCloseRedact }: Pick<Props, 'content' | 'redact' | 'onCloseRedact'> & { meta: ClipMeta }) {
  if (content === undefined) return <div className="h-full rounded-card bg-shelf-text/[0.05] animate-pulse" aria-busy="true" />;
  if (content === null) return <Empty text="That copy is no longer on the shelf." />;
  if (redact && redact.clipId === meta.id && (content.kind === 'text' || content.kind === 'html' || content.kind === 'svg')) {
    return <RedactionView text={content.text} findings={redact.result.findings ?? []} {...(redact.result.note ? { note: redact.result.note } : {})} {...(redact.result.truncated ? { truncated: true } : {})} onBack={onCloseRedact} />;
  }
  if (content.kind === 'image') return <ImageView src={content.dataUrl} caption={`${content.width} × ${content.height} preview`} />;
  if (content.kind === 'svg') return <SvgView svg={content.text} />;
  if (content.kind === 'html') return <HtmlView html={content.text} />;
  return meta.masked ? <PlainText text={content.text} /> : <TextClipView text={content.text} />;
}

/** The right half: what the chosen copy looks like, its details, and what you can do with it. */
export default function Inspector(p: Props) {
  const { meta, desc } = p;
  if (!meta || !desc) return <Empty text="Copy something and it appears on the shelf. Pick a card to see it here." />;
  const dims = meta.width && meta.height ? ` · ${meta.width} × ${meta.height}` : '';
  return (
    <div className="h-full flex flex-col min-h-0 gap-2.5">
      <div className="flex items-center gap-2 text-xs text-shelf-muted min-h-[24px]">
        <Icon name={desc.type === 'color' ? 'color' : desc.type} size={14} />
        <span className="font-semibold text-shelf-text">{desc.label}</span>
        <span className="truncate">{timeAgo(meta.createdAt)}{meta.sourceApp ? ` · ${meta.sourceApp}` : ''} · {formatBytes(meta.sizeBytes)}{dims}</span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button type="button" onClick={p.onCopy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-shelf-text hover:opacity-70 transition-colors" title="Copy again (Enter copies and closes)"><Icon name="copy" size={14} /> Copy</button>
          <button type="button" onClick={p.onDelete} className="inline-flex items-center px-1.5 py-1 rounded-lg text-shelf-muted hover:opacity-70 transition-colors" title="Remove from the shelf (Delete)" aria-label="Remove from the shelf"><Icon name="trash" size={14} /></button>
        </div>
      </div>
      {meta.masked && (
        <div className="flex items-center gap-2 rounded-card bg-shelf-danger/10 text-shelf-danger text-xs px-3 py-2" role="note">
          <Icon name="lock" size={14} /> A secret was found in this copy and hidden. It can be read here but is never sent to Vault.
        </div>
      )}
      <div className="flex-1 min-h-0"><Body meta={meta} content={p.content} redact={p.redact} onCloseRedact={p.onCloseRedact} /></div>
      <ActionBar actions={meta.masked ? p.actions.map((a) => ({ ...a, enabled: false, reason: 'This copy had a secret in it, so it is never sent.' })) : p.actions} busy={p.busy} onAction={p.onAction} />
    </div>
  );
}
