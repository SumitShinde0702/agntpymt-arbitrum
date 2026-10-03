import { Link } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import {
  ArrowRight,
  Bot,
  Shield,
  Wallet,
  Zap,
  CheckCircle2,
  GitBranch,
  Lock,
} from "lucide-react";
import { AuthControls } from "../components/auth/AuthControls";
import { Logo } from "../components/brand/Logo";

const features = [
  {
    icon: Shield,
    title: "Policy-gated spending",
    description:
      "Per-agent auto-approve limits, negotiation rules, and human-in-the-loop approvals before funds move.",
  },
  {
    icon: Wallet,
    title: "Agent wallets & treasury",
    description:
      "Provision wallets per agent, fund from treasury, and track balances across your fleet.",
  },
  {
    icon: Zap,
    title: "x402 micropayments",
    description:
      "HTTP-native payments via x402 on Arbitrum — settle in USDC for API calls, data, and vendor services.",
  },
  {
    icon: Bot,
    title: "Autonomous negotiation",
    description:
      "Agents discover vendors, negotiate prices, and settle — with full audit trail and governance.",
  },
];

const demoFlows = [
  {
    title: "Auto-approve + negotiate",
    agent: "Research Agent",
    detail: "Buys sector data — seller quotes $0.02, agent counters $0.01, settles instantly.",
  },
  {
    title: "Instant micro-pay",
    agent: "Procurement Agent",
    detail: "Orders office supplies at $0.01 — under policy limit, no approval needed.",
  },
  {
    title: "Human approval",
    agent: "Cloud Ops Agent",
    detail: "AWS invoice negotiated to $0.08 — exceeds $0.05 limit → routed for approval.",
  },
];

const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Logo variant="dark" markClassName="h-9 w-9" />
          <div className="flex items-center gap-3">
            <AuthControls />
            {clerkEnabled ? (
              <>
                <SignedIn>
                  <Link
                    to="/dashboard"
                    className="btn-primary"
                  >
                    Dashboard
                  </Link>
                </SignedIn>
                <SignedOut>
                  <Link
                    to="/sign-in"
                    className="btn-primary"
                  >
                    Launch demo
                  </Link>
                </SignedOut>
              </>
            ) : (
              <Link
                to="/dashboard"
                className="btn-primary"
              >
                Launch demo
              </Link>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-6 pb-20 pt-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-500/20 via-transparent to-transparent" />
          <div className="relative mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-100">
              <GitBranch className="h-4 w-4" />
              Enterprise governance for autonomous AI agents
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Let agents spend money.
              <span className="mt-2 block bg-gradient-to-r from-brand-400 to-brand-200 bg-clip-text text-transparent">
                Keep humans in control.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
              AgntPymt is the payments and policy layer for AI agents — wallet provisioning,
              spending limits, approval workflows, and x402 payments on Arbitrum.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to="/dashboard"
                className="btn-primary-lg"
              >
                Try the live demo
                <ArrowRight className="h-5 w-5" />
              </Link>
              <a
                href="#how-it-works"
                className="rounded-xl border border-white/15 px-6 py-3 text-base font-medium text-slate-300 transition hover:border-white/30 hover:text-white"
              >
                See how it works
              </a>
            </div>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500">
              <span className="flex items-center gap-2">
                <Lock className="h-4 w-4" /> Policy-first architecture
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> x402 + Arbitrum
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Full audit trail
              </span>
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 bg-slate-900/50 px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">Why AgntPymt</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">
              As agents gain autonomy to purchase APIs, data, and services, enterprises need
              the same controls they expect from corporate cards — at machine speed.
            </p>
            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/10 bg-slate-900 p-6 transition hover:border-brand-500/30"
                >
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/20 text-brand-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">Demo flows</h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-slate-400">
              Three pre-seeded agents show auto-approve, instant micro-pay, and human approval paths.
            </p>
            <div className="mt-12 space-y-4">
              {demoFlows.map((flow, i) => (
                <div
                  key={flow.title}
                  className="flex gap-5 rounded-2xl border border-white/10 bg-slate-900/80 p-6"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-400">
                    {i + 1}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{flow.title}</h3>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                        {flow.agent}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{flow.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-10 text-center">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 text-brand-400 transition hover:text-brand-300"
              >
                Open the dashboard and run a flow
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">Ready to explore?</h2>
            <p className="mt-4 text-slate-400">
              The live demo runs in simulated payment mode with pre-seeded agents, vendors, and
              sample transactions. No wallet or API keys required.
            </p>
            <Link
              to="/dashboard"
              className="btn-primary-lg mt-8 px-8 py-3.5"
            >
              Launch demo dashboard
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} AgntPymt — MVP demo</span>
          <span>Built for agentic commerce on Arbitrum</span>
        </div>
      </footer>
    </div>
  );
}
