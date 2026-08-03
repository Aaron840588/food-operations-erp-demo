import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "glass" | "outline";
  isHoverable?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className = "", variant = "default", isHoverable = false, children, ...props }, ref) => {
    const baseStyles = "rounded-2xl transition-[box-shadow,border-color,transform] duration-200 overflow-hidden";
    
    const variants = {
      default: "modern-card",
      glass: "glass-card",
      outline: "border border-slate-200 bg-white",
    };

    const hoverStyles = isHoverable && variant !== "default"
      ? "hover:shadow-md hover:border-slate-300"
      : "";

    return (
      <div
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${hoverStyles} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = "Card";

export const CardHeader = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 flex flex-col gap-1.5 ${className}`} {...props}>
    {children}
  </div>
);
CardHeader.displayName = "CardHeader";

export const CardTitle = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={`font-heading font-bold text-lg leading-tight text-slate-900 ${className}`} {...props}>
    {children}
  </h3>
);
CardTitle.displayName = "CardTitle";

export const CardDescription = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={`text-sm text-slate-500 font-medium leading-relaxed ${className}`} {...props}>
    {children}
  </p>
);
CardDescription.displayName = "CardDescription";

export const CardContent = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`p-5 sm:p-6 ${className}`} {...props}>
    {children}
  </div>
);
CardContent.displayName = "CardContent";

export const CardFooter = ({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`px-5 py-4 sm:px-6 bg-slate-50/50 border-t border-slate-100 flex flex-wrap items-center justify-end gap-3 ${className}`} {...props}>
    {children}
  </div>
);
CardFooter.displayName = "CardFooter";
