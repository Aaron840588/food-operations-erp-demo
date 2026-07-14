import React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "success" | "warning" | "danger" | "info" | "neutral";
}

export const Badge = ({ className = "", variant = "neutral", children, ...props }: BadgeProps) => {
  const baseStyles =
    "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold leading-none tracking-wide border select-none";

  const variants = {
    success: "bg-success-light text-success border-success/20",
    warning: "bg-warning-light text-warning border-warning/20",
    danger: "bg-danger-light text-danger border-danger/20",
    info: "bg-primary-light text-primary border-primary/20",
    neutral: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
};

Badge.displayName = "Badge";
