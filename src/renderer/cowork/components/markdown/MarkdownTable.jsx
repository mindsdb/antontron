// Plain styled HTML table for GFM tables. mdb-ai's full version has
// expand-to-modal + CSV export tied to its conversation API; we keep
// just the visual half here. Add the modal/export later if needed.

export function MarkdownTable(props) {
  return (
    <div className="my-3 overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-body" {...props} />
    </div>
  );
}

export const TableHead = (props) => (
  <th
    className="border-b border-line bg-surface-2 px-3 py-2 text-left font-display text-[11px] font-semibold uppercase tracking-wider text-ink-3"
    {...props}
  />
);

export const TableCell = (props) => (
  <td className="border-b border-line px-3 py-2 align-top text-ink" {...props} />
);

export const TableRow = (props) => <tr {...props} />;
export const TableHeader = (props) => <thead {...props} />;
export const TableBody = (props) => <tbody {...props} />;
