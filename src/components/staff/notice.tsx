/** The result of the last staff action: a confirmation, or what went wrong. Read from the page's query string. */
export function Notice({ notice, error }: { notice?: string | string[]; error?: string | string[] }) {
  const n = Array.isArray(notice) ? notice[0] : notice;
  const e = Array.isArray(error) ? error[0] : error;
  if (!n && !e) return null;
  return e ? (
    <p className="rounded-lg bg-bad-soft p-3 font-semibold text-bad" role="alert">
      <span aria-hidden="true">&#9888; </span>
      {e}
    </p>
  ) : (
    <p className="rounded-lg bg-ok-soft p-3 font-semibold text-ok" role="status">
      <span aria-hidden="true">&#10003; </span>
      {n}
    </p>
  );
}
