import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { kvGet } from "@/lib/store";
import type { SeasonPlan } from "@/lib/types";
import { SharedPlan } from "./shared-plan";

const ID = /^[0-9a-f-]{36}$/;

async function loadPlan(id: string) {
  return ID.test(id) ? kvGet<SeasonPlan>(`plan:${id}`) : null;
}

export async function generateMetadata(props: PageProps<"/plan/[id]">): Promise<Metadata> {
  const plan = await loadPlan((await props.params).id);
  if (!plan) return { title: "Plan not found — Theme Night GM" };
  return {
    title: `${plan.team.teamName}: ${plan.nights.length} theme nights — Theme Night GM`,
    description: plan.marketSummary.slice(0, 200),
  };
}

export default async function PlanPage(props: PageProps<"/plan/[id]">) {
  const plan = await loadPlan((await props.params).id);
  if (!plan) notFound();
  return (
    <>
      <SiteHeader mode={plan.mode} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <SharedPlan plan={plan} />
      </main>
    </>
  );
}
