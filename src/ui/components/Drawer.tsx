/**
 * Drawer：側滑面板（稿 v2.80、DESIGN §10.44.3，D176④）。
 * 只用在補考儀表板「看儀表板」一處；其餘一律用 Modal／ConfirmModal（D165）。
 * ≥768px 右側滑出，<768px 底部面板（把手、上緣圓角）。Esc／點遮罩／關閉鈕都關閉，關閉後焦點回到開啟前的元素。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Button } from './index';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Drawer(p: { title: string; onClose: () => void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(p.onClose);
  onClose.current = p.onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose.current(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); opener?.focus?.(); };
  }, []);
  return (
    <div class="dscrim" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="drawer-p" role="dialog" aria-modal="true" aria-label={p.title} ref={panel}>
        <div class="dr-grab" aria-hidden="true" />
        <div class="dr-head">
          <h3>{p.title}</h3>
          <Button small onClick={p.onClose} title="關閉">關閉</Button>
        </div>
        <div class="dr-body">{p.children}</div>
      </div>
    </div>
  );
}
