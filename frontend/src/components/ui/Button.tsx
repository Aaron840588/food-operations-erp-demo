import React from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center whitespace-nowrap font-sans font-bold rounded-xl transition-[background-color,border-color,color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer active:translate-y-px";

    const variants = {
      primary:
        "bg-primary hover:bg-primary-hover text-white focus:ring-primary/40 shadow-sm border border-primary/20",
      secondary:
        "bg-accent hover:bg-accent/90 text-slate-900 focus:ring-accent/40 shadow-sm border border-accent/20",
      outline:
        "border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 focus:ring-slate-200",
      danger:
        "bg-danger hover:bg-danger/90 text-white focus:ring-danger/40 shadow-sm border border-danger/20",
      ghost:
        "text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:ring-slate-100",
    };

    const sizes = {
      sm: "px-3.5 text-xs gap-1.5 h-9",
      md: "px-5 text-sm gap-2 h-11",
      lg: "px-6 text-base gap-2.5 h-12",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {!isLoading && leftIcon && <span className="flex shrink-0">{leftIcon}</span>}
        {children}
        {!isLoading && rightIcon && <span className="flex shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = "Button";
