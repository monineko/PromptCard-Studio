import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn, categoryHue } from "../lib";
import { useStore } from "../store";

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg font-medium transition-all active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        variant === "primary" &&
          "text-white shadow-lg shadow-[color-mix(in_srgb,var(--accent)_35%,transparent)]",
        variant === "ghost" && "border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--text)]",
        variant === "danger" && "border border-red-500/40 text-red-400 hover:bg-red-500/10",
        className
      )}
      style={variant === "primary" ? { background: "var(--accent)" } : undefined}
    >
      {children}
    </button>
  );
}

export function IconBtn({
  children,
  onClick,
  title,
  danger,
  className,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]",
        danger && "hover:bg-red-500/15 hover:text-red-400",
        className
      )}
    >
      {children}
    </button>
  );
}

export function CategoryBadge({ name, className }: { name: string; className?: string }) {
  const hue = categoryHue(name);
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-[2px]", className)}
      style={{ background: `hsl(${hue} 68% 55%)`, boxShadow: `0 0 6px hsl(${hue} 68% 55% / .6)` }}
      title={name}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={cn(
              "glass w-full rounded-2xl p-5 shadow-2xl",
              wide ? "max-w-2xl" : "max-w-md"
            )}
            initial={{ scale: 0.86, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">{title}</h3>
              <IconBtn onClick={onClose} title="关闭">
                <X size={16} />
              </IconBtn>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  danger,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="mb-4 text-sm text-[var(--muted)]">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          确认
        </Button>
      </div>
    </Modal>
  );
}

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 30, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 30, scale: 0.95 }}
            className="glass pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm shadow-xl"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: t.kind === "ok" ? "#22c55e" : "#ef4444" }}
            />
            <span className="max-w-[320px] truncate">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Tilt({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 220, damping: 18 });
  const sry = useSpring(ry, { stiffness: 220, damping: 18 });

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d", perspective: 800 }}
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        rx.set(-py * 8);
        ry.set(px * 10);
      }}
      onMouseLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}
