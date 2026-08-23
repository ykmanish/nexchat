'use client';

import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode2,
  Presentation,
  File as FileGeneric,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Extension → icon, colour and short label. */
const TYPES = [
  {
    match: /\.pdf$/i,
    icon: FileText,
    label: 'PDF',
    fg: '#E5484D',
    bg: 'rgba(229,72,77,.14)',
  },
  {
    match: /\.(docx?|odt|rtf|pages)$/i,
    icon: FileText,
    label: 'DOC',
    fg: '#2B7FFF',
    bg: 'rgba(43,127,255,.14)',
  },
  {
    match: /\.(xlsx?|xlsm|csv|tsv|ods|numbers)$/i,
    icon: FileSpreadsheet,
    label: 'XLS',
    fg: '#1A9E5E',
    bg: 'rgba(26,158,94,.14)',
  },
  {
    match: /\.(pptx?|odp|key)$/i,
    icon: Presentation,
    label: 'PPT',
    fg: '#E2683C',
    bg: 'rgba(226,104,60,.14)',
  },
  {
    match: /\.(zip|rar|7z|tar|gz|bz2)$/i,
    icon: FileArchive,
    label: 'ZIP',
    fg: '#C08A16',
    bg: 'rgba(192,138,22,.16)',
  },
  {
    match: /\.(png|jpe?g|gif|webp|avif|heic|svg|bmp)$/i,
    icon: FileImage,
    label: 'IMG',
    fg: '#0F9B8E',
    bg: 'rgba(15,155,142,.14)',
  },
  {
    match: /\.(mp4|mov|mkv|webm|avi|m4v)$/i,
    icon: FileVideo,
    label: 'VIDEO',
    fg: '#D6409F',
    bg: 'rgba(214,64,159,.14)',
  },
  {
    match: /\.(mp3|wav|ogg|m4a|flac|aac)$/i,
    icon: FileAudio,
    label: 'AUDIO',
    fg: '#8B5CF6',
    bg: 'rgba(139,92,246,.14)',
  },
  {
    match: /\.(js|jsx|ts|tsx|json|html?|css|py|java|rb|go|rs|c|cpp|sh|yml|yaml|xml)$/i,
    icon: FileCode2,
    label: 'CODE',
    fg: '#5B5BD6',
    bg: 'rgba(91,91,214,.14)',
  },
  {
    match: /\.(txt|md|log)$/i,
    icon: FileText,
    label: 'TXT',
    fg: '#64748B',
    bg: 'rgba(100,116,139,.16)',
  },
];

const FALLBACK = {
  icon: FileGeneric,
  label: 'FILE',
  fg: '#64748B',
  bg: 'rgba(100,116,139,.16)',
};

export function fileTypeOf(name = '') {
  return TYPES.find((t) => t.match.test(name)) || FALLBACK;
}

/** The extension, uppercased, for the badge under the icon. */
export function extensionOf(name = '') {
  const m = String(name).match(/\.([a-z0-9]{1,6})$/i);
  return m ? m[1].toUpperCase() : '';
}

export function FileIcon({ name, size = 'md', className }) {
  const type = fileTypeOf(name);
  const Icon = type.icon;

  const box = { sm: 'h-9 w-9 rounded-lg', md: 'h-11 w-11 rounded-xl', lg: 'h-14 w-14 rounded-2xl' }[size];
  const glyph = { sm: 17, md: 21, lg: 26 }[size];

  return (
    <span
      className={cn('grid shrink-0 place-items-center', box, className)}
      style={{ background: type.bg, color: type.fg }}
    >
      <Icon size={glyph} strokeWidth={1.9} />
    </span>
  );
}

/** Icon plus the extension chip — used on the larger document cards. */
export function FileBadge({ name, size = 'md', className }) {
  const ext = extensionOf(name);
  const type = fileTypeOf(name);

  return (
    <span className={cn('relative', className)}>
      <FileIcon name={name} size={size} />
      {ext && (
        <span
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded px-1 py-[1px] text-[8.5px] font-bold leading-none tracking-wide text-white"
          style={{ background: type.fg }}
        >
          {ext.slice(0, 4)}
        </span>
      )}
    </span>
  );
}
