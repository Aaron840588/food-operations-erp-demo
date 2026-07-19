import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

type Alignment = "left" | "center" | "right";

const ALIGNMENT_CLASSES: Record<Alignment, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function DataTableShell({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
      {...props}
    />
  );
}

type DataTableHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function DataTableHeader({ title, description, actions, className = "" }: DataTableHeaderProps) {
  return (
    <div className={`flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${className}`}>
      <div className="min-w-0">
        <h2 className="font-heading text-lg font-black text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-xs font-semibold text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DataTableToolbar({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5 ${className}`}
      {...props}
    />
  );
}

type DataTableScrollProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
};

export function DataTableScroll({ label, className = "", ...props }: DataTableScrollProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`scroll-fade-x overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${className}`}
      {...props}
    />
  );
}

export function TableHeaderRow({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b border-slate-200 bg-slate-50 ${className}`} {...props} />;
}

type TableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  align?: Alignment;
};

export function TableHeaderCell({ align = "left", className = "", scope = "col", ...props }: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      className={`px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500 sm:px-5 ${ALIGNMENT_CLASSES[align]} ${className}`}
      {...props}
    />
  );
}

export function TableRow({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`h-14 border-b border-slate-100 transition-colors last:border-b-0 hover:bg-amber-50/35 ${className}`}
      {...props}
    />
  );
}

type TableCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  align?: Alignment;
};

export function TableCell({ align = "left", className = "", ...props }: TableCellProps) {
  return (
    <td
      className={`px-4 py-3 text-sm text-slate-700 sm:px-5 ${ALIGNMENT_CLASSES[align]} ${className}`}
      {...props}
    />
  );
}

type TableStateProps = {
  colSpan: number;
  title: string;
  description?: string;
};

type TableLoadingStateProps = Omit<TableStateProps, "title"> & {
  title?: string;
};

export function TableEmptyState({ colSpan, title, description }: TableStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center">
        <p className="text-sm font-black text-slate-700">{title}</p>
        {description && <p className="mt-1 text-xs font-semibold text-slate-400">{description}</p>}
      </td>
    </tr>
  );
}

export function TableLoadingState({ colSpan, title = "Loading records…", description }: TableLoadingStateProps) {
  return (
    <tr aria-live="polite" aria-busy="true">
      <td colSpan={colSpan} className="px-5 py-12 text-center">
        <span className="mx-auto mb-3 block h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="text-sm font-black text-slate-700">{title}</p>
        {description && <p className="mt-1 text-xs font-semibold text-slate-400">{description}</p>}
      </td>
    </tr>
  );
}

type TablePaginationProps = {
  label?: string;
  action?: ReactNode;
  className?: string;
};

export function TablePagination({ label, action, className = "" }: TablePaginationProps) {
  return (
    <div className={`flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${className}`}>
      {label ? <p className="text-xs font-semibold text-slate-500">{label}</p> : <span />}
      {action}
    </div>
  );
}
