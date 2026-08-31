'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import { Sun, Moon, MonitorSmartphone, Check } from 'lucide-react';
import { SettingsShell, SettingsGroup, SettingsRow, Divider } from '@/components/layout/SettingsShell';
import { Switch } from '@/components/ui/Field';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { feedback, sounds } from '@/lib/sound';
import { BUBBLE_COLORS, WALLPAPERS, bubbleById, wallpaperClass } from '@/lib/theme';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: MonitorSmartphone },
];

export default function AppearancePage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const user = useAuth((s) => s.user);
  const updateSettings = useAuth((s) => s.updateSettings);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const settings = user?.settings || {};
  const isDark = resolvedTheme === 'dark';
  const bubble = bubbleById(settings.bubbleColor || 'green');
  const tone = isDark ? bubble.dark : bubble.light;

  return (
    <SettingsShell title="Appearance" subtitle="Make it feel like yours">
      {/* ── live preview ── */}
      <div
        className={cn(
          'chat-canvas mb-5 overflow-hidden rounded-2xl border border-line',
          wallpaperClass(settings.wallpaper || 'doodle')
        )}
      >
        <div className="relative z-[1] space-y-1.5 p-4">
          <div className="flex justify-start">
            <div className="bubble bubble-in bubble-tail-in max-w-[70%] px-2 py-[6px]">
              <p className="px-1 text-[14.6px] leading-[1.35]">
                How does this look?
                <span className="inline-block w-[52px]" />
              </p>
              <span className="absolute bottom-[5px] right-2 text-[11px] text-[var(--bubble-in-meta)]">
                09:41
              </span>
            </div>
          </div>
          <div className="flex justify-end">
            <div
              className="bubble bubble-tail-out relative max-w-[70%] px-2 py-[6px]"
              style={{ background: tone.bg, color: tone.ink }}
            >
              <p className="px-1 text-[14.6px] leading-[1.35]">
                Looks great.
                <span className="inline-block w-[52px]" />
              </p>
              <span className="absolute bottom-[5px] right-2 text-[11px]" style={{ color: tone.meta }}>
                09:41
              </span>
              <span
                className="absolute right-[-8px] top-0 h-[13px] w-2"
                style={{ background: tone.bg, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── theme ── */}
      <SettingsGroup title="Theme">
        <SettingsRow>
          <div className="grid grid-cols-3 gap-2.5">
            {THEMES.map((option) => {
              const active = mounted && theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    feedback('select');
                    setTheme(option.value);
                    updateSettings({ theme: option.value });
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 transition-colors',
                    active ? 'border-brand bg-brand-tint' : 'border-line hover:border-line-strong'
                  )}
                >
                  <option.icon
                    size={21}
                    strokeWidth={1.9}
                    className={active ? 'text-brand-strong' : 'text-ink-muted'}
                  />
                  <span className="text-[13px] font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── bubble colour ── */}
      <SettingsGroup
        title="Your bubble colour"
        footer="Only changes how your own messages look, on your devices."
      >
        <SettingsRow>
          <div className="flex flex-wrap gap-3">
            {BUBBLE_COLORS.map((option) => {
              const active = (settings.bubbleColor || 'green') === option.id;
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    feedback('select');
                    updateSettings({ bubbleColor: option.id });
                  }}
                  aria-label={option.name}
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-full transition-shadow',
                    active && 'ring-2 ring-brand ring-offset-2 ring-offset-surface'
                  )}
                  style={{ background: option.swatch }}
                >
                  {active && <Check size={19} strokeWidth={3} className="text-white" />}
                </motion.button>
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-ink-muted">{bubble.name}</p>
        </SettingsRow>
      </SettingsGroup>

      {/* ── wallpaper ── */}
      <SettingsGroup
        title="Chat wallpaper"
        footer="Applies to every conversation on this account."
      >
        <SettingsRow>
          <div className="grid grid-cols-4 gap-2.5">
            {WALLPAPERS.map((option) => {
              const active = (settings.wallpaper || 'doodle') === option.id;
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    feedback('select');
                    updateSettings({ wallpaper: option.id });
                  }}
                  className={cn(
                    'overflow-hidden rounded-xl border-2 transition-colors',
                    active ? 'border-brand' : 'border-line'
                  )}
                >
                  <span
                    className={cn('chat-canvas relative block h-16 w-full', wallpaperClass(option.id))}
                  >
                    {active && (
                      <span className="absolute inset-0 z-[2] grid place-items-center">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-brand-ink">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="block bg-surface-2 py-1.5 text-[11.5px] font-medium">
                    {option.name}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── text size ── */}
      <SettingsGroup title="Text size">
        <SettingsRow>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-ink-muted">A</span>
            <input
              type="range"
              min="0.85"
              max="1.25"
              step="0.05"
              value={settings.fontScale || 1}
              onChange={(e) => updateSettings({ fontScale: Number(e.target.value) })}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-brand"
            />
            <span className="text-[19px] text-ink-muted">A</span>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── feedback ── */}
      <SettingsGroup
        title="Sound and motion"
        footer="Sounds are synthesised in the browser — nothing is downloaded."
      >
        <SettingsRow>
          <Switch
            label="Sound effects"
            sublabel="Taps, sends, and message tones"
            checked={settings.sounds !== false}
            onChange={(v) => {
              updateSettings({ sounds: v });
              if (v) setTimeout(() => sounds.success(), 60);
            }}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Switch
            label="Haptics"
            sublabel="Vibration on supported devices"
            checked={settings.haptics !== false}
            onChange={(v) => updateSettings({ haptics: v })}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Switch
            label="Reduce motion"
            sublabel="Cuts animations back to the essentials"
            checked={!!settings.reduceMotion}
            onChange={(v) => updateSettings({ reduceMotion: v })}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Switch
            label="Message effects"
            sublabel="Confetti for a birthday, hearts for a heart — off if you would rather not"
            checked={settings.messageEffects !== false}
            onChange={(v) => updateSettings({ messageEffects: v })}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Switch
            label="Enter sends message"
            sublabel="Turn off to use Enter for a new line"
            checked={settings.enterToSend !== false}
            onChange={(v) => updateSettings({ enterToSend: v })}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsShell>
  );
}
