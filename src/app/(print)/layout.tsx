import "./print.css";

/**
 * The layout for printable documents.
 *
 * DELIBERATELY OUTSIDE THE APPLICATION SHELL. `(app)/layout.tsx` renders a
 * sidebar, a top bar and a theme, none of which belongs on a sheet of A4, and
 * hiding all of it with print-only overrides would mean every future change to
 * the shell has to remember this page exists.
 *
 * It is NOT outside the auth boundary: middleware still requires a session,
 * and each printable page guards itself with requireAccess() exactly like a
 * screen does.
 *
 * `bg-white text-black` is set here rather than inherited, because the root
 * layout's theme provider may have put the browser in dark mode — and a job
 * card printed from a dark-mode session would otherwise be white text on
 * nothing.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full bg-white p-6 text-black print:p-0">{children}</div>;
}
