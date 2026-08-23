'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Renders a fenced or heuristically-detected code block: monospace, its own
 * dark ground so it reads as code in both themes, and a copy button — the only
 * thing anyone actually wants to do with a pasted snippet.
 */
export function CodeBlock({ code, language, inline = false }) {
  const [copied, setCopied] = useState(false);

  async function copy(e) {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    feedback('tap');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  if (inline) {
    return (
      <code className="rounded bg-black/[.12] px-1.5 py-[1px] font-mono text-[13px] dark:bg-white/[.14]">
        {code}
      </code>
    );
  }

  const lines = code.split('\n');

  return (
    <div className="my-1 overflow-hidden rounded-[6px] bg-[#0d1117] text-[#c9d1d9] ring-1 ring-white/10">
      <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-white/45">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre className="scroll-soft max-h-[320px] overflow-auto px-3 py-2.5">
        <code className="block font-mono text-[12.5px] leading-[1.55]">
          {lines.map((line, i) => (
            <span key={i} className="flex">
              <span className="mr-3 inline-block w-[1.6em] shrink-0 select-none text-right text-white/25">
                {i + 1}
              </span>
              <span className="whitespace-pre">{line || ' '}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
