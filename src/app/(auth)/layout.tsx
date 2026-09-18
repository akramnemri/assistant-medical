/**
 * Auth routes deliberately render outside the workspace shell: a visitor who is
 * not signed in has no workspace navigation to show.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
