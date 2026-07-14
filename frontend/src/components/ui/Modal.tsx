import React, { useEffect, useId, useRef } from "react";
import { X, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { Button } from "./Button";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
}

export const Modal = ({ isOpen, onClose, title, children, size = "md" }: ModalProps) => {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Prevent scrolling on background when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  // Focus close button ONLY ONCE when modal is opened to avoid stealing focus on re-renders
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  // Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "3xl": "max-w-3xl",
    "4xl": "max-w-4xl",
    "5xl": "max-w-5xl",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in touch-optimize">
      {/* Backdrop click close */}
      <div className="fixed inset-0" onClick={onClose}></div>

      {/* Modal Container - Max height restricted with scroll auto-trigger (Phase 6 - Modal Responsiveness) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-white border border-slate-200 rounded-2xl w-full ${sizes[size]} max-h-[calc(100dvh-2rem)] relative z-10 shadow-xl overflow-hidden animate-fade-in flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-white">
          <h3 id={titleId} className="font-heading font-bold text-lg leading-tight text-slate-900">
            {title}
          </h3>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-500 hover:text-slate-800 p-2.5 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 text-sm text-slate-600 leading-relaxed font-medium">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- PRE-STYLED HELPERS ---

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: "danger" | "warning" | "success" | "info";
  isLoading?: boolean;
}

export const ConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  type = "info",
  isLoading = false,
}: ConfirmationModalProps) => {
  const icons = {
    danger: <AlertTriangle className="text-danger h-6 w-6" />,
    warning: <AlertTriangle className="text-warning h-6 w-6" />,
    success: <CheckCircle className="text-success h-6 w-6" />,
    info: <Info className="text-primary h-6 w-6" />,
  };

  const confirmVariants = {
    danger: "danger" as const,
    warning: "primary" as const, // Or accent
    success: "secondary" as const, // Gold or other
    info: "primary" as const,
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-6">
        <div className="flex gap-4 items-start">
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl shrink-0">
            {icons[type]}
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-500 font-semibold leading-relaxed">
              {message}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 mt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariants[type]}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  inputType?: string;
  confirmLabel?: string;
  isLoading?: boolean;
}

export const PromptModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  defaultValue = "",
  placeholder = "",
  inputType = "text",
  confirmLabel = "Submit",
  isLoading = false,
}: PromptModalProps) => {
  const [value, setValue] = React.useState(defaultValue);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(defaultValue);
    }
  }, [isOpen, defaultValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs text-slate-500 font-semibold">{message}</p>
          <input
            type={inputType}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            required
            className="w-full font-mono text-sm focus:ring-primary/20"
            disabled={isLoading}
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 mt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
