import type { ReactNode } from "react";
import { Logo } from "../brand/Logo";

/** Shared Clerk appearance — AgntPymt navy/cyan branding. */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#00a8e8",
    colorText: "#0f172a",
    colorTextSecondary: "#64748b",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#0f172a",
    borderRadius: "0.75rem",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  elements: {
    rootBox: "mx-auto w-full",
    card: "shadow-xl border border-slate-200/80",
    headerTitle: "text-slate-900",
    headerSubtitle: "text-slate-500",
    socialButtonsBlockButton: "border-slate-200 hover:bg-slate-50",
    formButtonPrimary:
      "bg-[#00a8e8] hover:bg-[#0089be] text-white shadow-sm normal-case font-medium",
    footerActionLink: "text-[#00a8e8] hover:text-[#0089be]",
    identityPreviewEditButton: "text-[#00a8e8]",
    formFieldInput: "border-slate-200 focus:border-[#00a8e8] focus:ring-[#00a8e8]/30",
  },
} as const;

export function AuthShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#00a8e8]/20 via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-[#0b2d5c]/80 via-transparent to-transparent" />

      <div className="relative z-10 mb-8 flex flex-col items-center text-center">
        <Logo variant="dark" markClassName="h-11 w-11" />
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-400">{subtitle}</p>
      </div>

      <div className="relative z-10 w-full max-w-[400px]">{children}</div>

      <p className="relative z-10 mt-8 text-center text-xs text-slate-500">
        Policy-gated agent payments on Arbitrum · Secured by Clerk
      </p>
    </div>
  );
}
