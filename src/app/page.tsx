import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isDirectBookingHost } from "@/lib/direct-booking/hosts";
import { MadreHome, madreMetadata } from "@/components/direct-booking/madre-home";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host");
  if (isDirectBookingHost(host)) return madreMetadata();
  return { title: "Otatitan" };
}

export default async function Home() {
  const host = (await headers()).get("host");
  if (isDirectBookingHost(host)) {
    return <MadreHome homePath="/" />;
  }

  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");
  redirect("/login");
}
